import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { pbCall } from '../pb.js';
import { chatbotReply } from '../integrations/gemini.js';
import { findNearestCenter, distanceKm } from '../integrations/evacCenters.js';
import { getCurrentConditions, getCondition } from '../utils/conditionsCache.js';
import type { OpenMeteoData } from '../integrations/openmeteo.js';

import type { AlertLevel, AlertRecord, ChatMessage, Locale, RiskContext } from '../types/index.js';

const router = Router();

const sessionHistory = new Map<string, ChatMessage[]>();

const ChatSchema = z.object({
  message: z.string().min(1).max(500),
  sessionId: z.string().min(1),
  locale: z.enum(['en', 'tl', 'vi']).default('en'),
});

router.post('/api/chat/message', authMiddleware, async (req, res) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed' });
    return;
  }

  const { message, sessionId, locale } = parsed.data;
  const user = req.user!;

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

  const nearest = (user.lat && user.lng) ? findNearestCenter(user.lat, user.lng) : null;
  const evacCenter = nearest && user.lat && user.lng ? {
    name: nearest.name,
    address: nearest.address,
    distKm: distanceKm(user.lat, user.lng, nearest.lat, nearest.lng).toFixed(1),
  } : null;

  const [liveConditions, weather] = await Promise.all([
    getCurrentConditions(),
    getCondition<OpenMeteoData>('weather'),
  ]);

  const forecast7day = (weather?.forecast7day ?? []).map(d => ({
    day: d.day,
    riskLevel: d.precipSum > 50 ? 'critical' : d.precipSum > 30 ? 'high' : d.precipSum > 10 ? 'medium' : 'low',
    temp: Math.round(d.tempMax),
  }));

  const context: RiskContext = {
    alertLevel,
    trigger: alertType,
    location: user.address || 'Philippines',
    evacCenter,
    conditions: {
      heatIndex: liveConditions.heatIndex,
      airQuality: liveConditions.airQuality,
      riverLevel: liveConditions.riverLevel,
      rainfall: liveConditions.rainfall,
      forecast7day,
    },
  };

  const sessionKey = `${user.id}:${sessionId}`;
  let history: ChatMessage[] = sessionHistory.get(sessionKey) ?? [];

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
