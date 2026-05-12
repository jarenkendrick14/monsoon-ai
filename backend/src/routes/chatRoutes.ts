import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { pbCall } from '../pb.js';
import { chatbotReply } from '../integrations/gemini.js';
import { findNearestCenterNear, distanceKm } from '../integrations/evacCenters.js';
import { getLocalWeather, getLocalizedConditions, toForecastPreview } from '../utils/localConditions.js';
import { applyDisasterContext, isDisasterMode } from '../utils/disasterMode.js';

import type { AlertLevel, AlertRecord, ChatMessage, Locale, RiskContext } from '../types/index.js';

const router = Router();

const sessionHistory = new Map<string, ChatMessage[]>();

function readSituationContext(req: { get(name: string): string | undefined }): RiskContext['situation'] {
  const raw = req.get('x-monsoon-situation-context');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8')) as RiskContext['situation'];
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      companions: Array.isArray(parsed.companions) ? parsed.companions.filter(v => typeof v === 'string').slice(0, 6) : [],
      needs: Array.isArray(parsed.needs) ? parsed.needs.filter(v => typeof v === 'string').slice(0, 8) : [],
      waterLevel: typeof parsed.waterLevel === 'string' ? parsed.waterLevel : null,
      canLeaveSafely: typeof parsed.canLeaveSafely === 'string' ? parsed.canLeaveSafely : null,
      notes: Array.isArray(parsed.notes) ? parsed.notes.filter(v => typeof v === 'string').slice(0, 6) : [],
    };
  } catch {
    return null;
  }
}

const ChatSchema = z.object({
  message: z.string().min(1).max(500),
  sessionId: z.string().min(1),
  locale: z.enum(['en', 'tl', 'vi']).default('en'),
  disasterMode: z.enum(['critical', 'off']).optional(),
});

router.post('/api/chat/message', authMiddleware, async (req, res) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed' });
    return;
  }

  const { message, sessionId, locale } = parsed.data;
  const user = req.user!;
  const disasterMode = isDisasterMode(req);

  let alertLevel: AlertLevel = 'none';
  let alertType: AlertRecord['type'] | null = null;
  try {
    const activeAlert = await pbCall(c => c.collection('alerts').getList<AlertRecord>(1, 1, {
      filter: `userId="${user.id}" && resolved=false`,
      sort: '-created',
    }));
    alertLevel = activeAlert.items[0]?.level ?? 'none';
    alertType = activeAlert.items[0]?.type ?? null;
  } catch { /* alerts collection may not exist yet */ }

  const nearest = (user.lat && user.lng) ? await findNearestCenterNear(user.lat, user.lng) : null;
  const evacCenter = nearest && user.lat && user.lng ? {
    name: nearest.name,
    address: nearest.address,
    distKm: distanceKm(user.lat, user.lng, nearest.lat, nearest.lng).toFixed(1),
  } : null;

  const [liveConditions, weather] = await Promise.all([
    getLocalizedConditions(user.lat, user.lng),
    getLocalWeather(user.lat, user.lng),
  ]);

  const forecast7day = toForecastPreview(weather);

  let context: RiskContext = {
    alertLevel,
    trigger: alertType,
    location: user.address || 'Philippines',
    situation: readSituationContext(req),
    household: {
      homeType: user.homeType,
      floor: user.floor,
      householdSize: user.householdSize,
      hasPWD: user.hasPWD,
      hasElderly: user.hasElderly,
      hasInfant: user.hasInfant,
      hasPregnant: user.hasPregnant,
      riskTier: user.riskTier,
      isOnRescueList: user.isOnRescueList,
    },
    evacCenter,
    conditions: {
      heatIndex: liveConditions.heatIndex,
      airQuality: liveConditions.airQuality,
      riverLevel: liveConditions.riverLevel,
      rainfall: liveConditions.rainfall,
      forecast7day,
    },
  };

  if (disasterMode) context = applyDisasterContext(context);

  const sessionKey = `${user.id}:${sessionId}`;
  let history: ChatMessage[] = sessionHistory.get(sessionKey) ?? [];
  if (history.length === 0) {
    try {
      const session = await pbCall(c => c.collection('chat_sessions').getList(1, 1, {
        filter: `sessionId="${sessionId}" && userId="${user.id}"`,
      }));
      history = session.items.length
        ? ((session.items[0] as Record<string, unknown>)['history'] as ChatMessage[] ?? [])
        : [];
      if (history.length > 0) sessionHistory.set(sessionKey, history.slice(-12));
    } catch { /* best-effort history hydration */ }
  }

  let reply;
  try {
    reply = await chatbotReply(message, locale as Locale, context, history);
  } catch {
    res.status(503).json({ reply: 'The AI engine is temporarily unavailable. Try texting STATUS to MonsoonAI.', suggestedCommands: ['STATUS', 'EVAC', 'HELP'] });
    return;
  }

  const newHistory: ChatMessage[] = [
    ...history.slice(-10),
    { role: 'user', content: message },
    { role: 'assistant', content: reply.reply },
  ];
  sessionHistory.set(sessionKey, newHistory);

  try {
    const existing = await pbCall(c => c.collection('chat_sessions').getList(1, 1, {
      filter: `sessionId="${sessionId}" && userId="${user.id}"`,
    }));
    if (existing.items.length > 0) {
      await pbCall(c => c.collection('chat_sessions').update(existing.items[0].id, { history: newHistory }));
    } else {
      await pbCall(c => c.collection('chat_sessions').create({ userId: user.id, sessionId, locale, history: newHistory }));
    }
  } catch { /* best-effort */ }

  res.json(reply);
});

router.get('/api/chat/history', authMiddleware, async (req, res) => {
  const { sessionId } = req.query as { sessionId?: string };
  if (!sessionId) { res.status(400).json({ error: 'sessionId required' }); return; }
  const user = req.user!;
  try {
    const session = await pbCall(c => c.collection('chat_sessions').getList(1, 1, {
      filter: `sessionId="${sessionId}" && userId="${user.id}"`,
    }));
    const history: ChatMessage[] = session.items.length
      ? ((session.items[0] as Record<string, unknown>)['history'] as ChatMessage[] ?? [])
      : [];
    res.json({ history });
  } catch {
    res.json({ history: [] });
  }
});

export default router;
