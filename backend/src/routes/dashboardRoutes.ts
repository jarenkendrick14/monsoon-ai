import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getPb } from '../pb.js';
import { getCondition, getCurrentConditions } from '../utils/conditionsCache.js';
import type { OpenMeteoData } from '../integrations/openmeteo.js';
import type { PagasaData } from '../integrations/pagasa.js';
import type { AlertRecord } from '../types/index.js';

const router = Router();

router.get('/api/dashboard', authMiddleware, async (req, res) => {
  const user = req.user!;
  const pb = getPb();

  const weather = await getCondition<OpenMeteoData>('weather');
  const conditions = await getCurrentConditions();

  let alertLevel = 'none';
  try {
    const activeAlert = await pb.collection('alerts').getList<AlertRecord>(1, 1, {
      filter: `userId="${user.id}" && resolved=false`,
      sort: '-created',
    });
    alertLevel = activeAlert.items[0]?.level ?? 'none';
  } catch {
    // alerts collection may not exist yet or field missing — treat as no alert
  }

  const forecast7day = (weather?.forecast7day ?? []).map(day => ({
    day: day.day,
    riskLevel: day.precipSum > 50 ? 'critical' : day.precipSum > 30 ? 'high' : day.precipSum > 10 ? 'medium' : 'low',
    temp: Math.round(day.tempMax),
  }));

  res.json({
    user: {
      firstName: user.name?.split(' ')[0] ?? user.name ?? '',
      address: user.address ?? '',
    },
    alertLevel,
    forecast7day,
    conditions: {
      riverLevel: conditions.riverLevel,
      airQuality: conditions.airQuality,
      heatIndex: conditions.heatIndex,
    },
  });
});

router.get('/api/alerts/active', authMiddleware, async (req, res) => {
  const user = req.user!;
  const pb = getPb();

  let result;
  try {
    result = await pb.collection('alerts').getList<AlertRecord>(1, 1, {
      filter: `userId="${user.id}" && resolved=false`,
      sort: '-created',
    });
  } catch {
    res.status(404).json({ error: 'No active alert' });
    return;
  }

  if (!result.items.length) {
    res.status(404).json({ error: 'No active alert' });
    return;
  }

  const alert = result.items[0];
  res.json({
    alertId: alert.id,
    level: alert.level,
    evacuateWithin: alert.evacuateWithin,
    rainfall: alert.rainfall,
    floodZone: alert.floodZone,
    riverDischarge: alert.riverDischarge,
    issuedAt: alert.issuedAt,
    reEvalAt: alert.reEvalAt,
  });
});

router.get('/api/alerts/active-storm', async (_req, res) => {
  const pagasa = await getCondition<PagasaData>('pagasa');
  res.json({
    signal: pagasa?.signal ?? 0,
    bulletinTitle: pagasa?.bulletinTitle ?? 'No active storm',
    issuedAt: pagasa?.issuedAt ?? new Date().toISOString(),
  });
});

export default router;
