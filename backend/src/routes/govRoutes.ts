import { Router } from 'express';
import { z } from 'zod';
import PocketBase from 'pocketbase';
import { authLimiter } from '../middleware/rateLimiter.js';
import { govAuthMiddleware } from '../middleware/govAuth.js';
import { getPb } from '../pb.js';
import { config } from '../config.js';
import { computeInaSAFEScore } from '../engine/inasafeScore.js';
import { broadcastGov } from '../ws.js';
import type { UserRecord } from '../types/index.js';

const router = Router();

router.post('/api/gov/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  if (!email || !password) {
    res.status(400).json({ error: 'email and password required' });
    return;
  }

  const pb = new PocketBase(config.pb.url);
  try {
    const auth = await pb.collection('users').authWithPassword(email, password);
    const user = auth.record;

    res.json({
      token: auth.token,
      officer: {
        id: user.id,
        name: user['name'],
        email: user['email'],
      },
    });
  } catch {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

router.get('/api/gov/manifest', govAuthMiddleware, async (req, res) => {
  const tier = req.query['tier'] as string | undefined;
  const page = parseInt((req.query['page'] as string) ?? '1', 10);
  const perPage = 20;

  const pb = getPb();

  const listOptions: Record<string, unknown> = { sort: '-riskScore' };
  if (tier) listOptions['filter'] = `tier="${tier}"`;

  const users = await pb.collection('users').getList<UserRecord>(page, perPage, listOptions);

  const reScoreAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const households = await Promise.all(
    users.items.map(async (user, idx) => {
      const { score, tier: computedTier, riskFactors } = computeInaSAFEScore(user);

      let govRecord: Record<string, unknown> = {};
      try {
        const existing = await pb.collection('gov_households').getList(1, 1, {
          filter: `userId="${user.id}"`,
          requestKey: `govhh_${user.id}`,
        });
        govRecord = (existing.items[0] as Record<string, unknown>) ?? {};
      } catch { /* no record yet */ }

      const phone = user.mobile
        ? user.mobile.slice(0, 4) + '****' + user.mobile.slice(-2)
        : '***';

      return {
        rank: (page - 1) * perPage + idx + 1,
        id: user.id,
        name: user.name,
        address: user.address,
        score,
        tier: computedTier,
        riskFactors,
        phone,
        status: (govRecord['status'] as string) ?? 'pending',
        assignedTeam: (govRecord['assignedTeam'] as string) ?? '',
      };
    })
  );

  res.json({
    totalCount: users.totalItems,
    households,
    reScoreAt,
    page,
    totalPages: users.totalPages,
  });
});

const DispatchSchema = z.object({
  householdId: z.string(),
  teamId: z.string(),
  teamName: z.string().optional(),
});

router.post('/api/gov/teams/dispatch', govAuthMiddleware, async (req, res) => {
  const parsed = DispatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'householdId and teamId required' });
    return;
  }

  const { householdId, teamId, teamName } = parsed.data;
  const pb = getPb();

  const existing = await pb.collection('gov_households').getList(1, 1, {
    filter: `userId="${householdId}"`,
  });

  if (existing.items.length > 0) {
    await pb.collection('gov_households').update(existing.items[0].id, {
      assignedTeam: teamName ?? teamId,
      status: 'dispatched',
    });
  } else {
    await pb.collection('gov_households').create({
      userId: householdId,
      assignedTeam: teamName ?? teamId,
      status: 'dispatched',
    });
  }

  await pb.collection('dispatch_log').create({
    householdId,
    teamId,
    officerId: req.user!.id,
    action: 'dispatch',
  });

  broadcastGov({ type: 'MANIFEST_UPDATE', payload: { householdId, status: 'dispatched', teamId } });

  res.json({ success: true });
});

router.patch('/api/gov/households/:id/status', govAuthMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body as { status: string };

  if (!['pending', 'dispatched', 'evacuated', 'safe'].includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  const pb = getPb();

  const existing = await pb.collection('gov_households').getList(1, 1, {
    filter: `userId="${id}"`,
  });

  if (existing.items.length > 0) {
    await pb.collection('gov_households').update(existing.items[0].id, { status });
  } else {
    await pb.collection('gov_households').create({ userId: id, status });
  }

  broadcastGov({ type: 'MANIFEST_UPDATE', payload: { householdId: id, status } });

  res.json({ success: true });
});

router.get('/api/gov/stats', govAuthMiddleware, async (_req, res) => {
  const pb = getPb();
  const [totalUsers, criticalAlerts, highAlerts, dispatched] = await Promise.all([
    pb.collection('users').getList(1, 1),
    pb.collection('alerts').getList(1, 1, { filter: 'level="critical" && resolved=false' }),
    pb.collection('alerts').getList(1, 1, { filter: 'level="high" && resolved=false' }),
    pb.collection('gov_households').getList(1, 1, { filter: 'status="dispatched"' }),
  ]);
  res.json({
    totalRegistered: totalUsers.totalItems,
    critical: criticalAlerts.totalItems,
    high: highAlerts.totalItems,
    teamsDeployed: dispatched.totalItems,
  });
});

router.get('/api/gov/manifest/export', govAuthMiddleware, async (req, res) => {
  const format = (req.query['format'] as string) ?? 'csv';
  const pb = getPb();

  const users = await pb.collection('users').getFullList<UserRecord>({ sort: '-riskScore' });

  if (format === 'csv') {
    const rows = [
      ['Rank', 'Name', 'Address', 'Score', 'Tier', 'Status', 'Phone'].join(','),
    ];

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const { score, tier } = computeInaSAFEScore(user);
      const phone = user.mobile ? user.mobile.slice(0, 4) + '****' + user.mobile.slice(-2) : '***';
      rows.push([i + 1, user.name, `"${user.address}"`, score, tier, 'pending', phone].join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=manifest.csv');
    res.send(rows.join('\n'));
  } else {
    res.status(400).json({ error: 'Only format=csv supported' });
  }
});

export default router;
