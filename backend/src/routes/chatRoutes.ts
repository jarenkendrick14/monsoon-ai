import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { getPb } from '../pb.js';
import { chatbotReply } from '../integrations/openai.js';
import { getPb as getPocketBase } from '../pb.js';
import type { AlertLevel, AlertRecord, ChatMessage, Locale, RiskContext } from '../types/index.js';

const router = Router();

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
  const pb = getPb();

  let alertLevel: AlertLevel = 'none';
  let alertType: AlertRecord['type'] | null = null;
  try {
    const activeAlert = await pb.collection('alerts').getList<AlertRecord>(1, 1, {
      filter: `userId="${user.id}" && resolved=false`,
      sort: '-created',
    });
    alertLevel = activeAlert.items[0]?.level ?? 'none';
    alertType = activeAlert.items[0]?.type ?? null;
  } catch { /* alerts collection may not exist yet */ }

  const context: RiskContext = {
    alertLevel,
    trigger: alertType,
    location: user.address || 'Philippines',
  };

  let history: ChatMessage[] = [];
  try {
    const session = await pb.collection('chat_sessions').getList(1, 1, {
      filter: `sessionId="${sessionId}" && userId="${user.id}"`,
    });
    if (session.items.length > 0) {
      history = (session.items[0] as Record<string, unknown>)['history'] as ChatMessage[] ?? [];
    }
  } catch { /* new session */ }

  let reply;
  try {
    reply = await chatbotReply(message, locale as Locale, context, history);
  } catch (err) {
    res.status(503).json({ reply: 'The AI engine is temporarily unavailable. Try texting STATUS to MonsoonAI.', suggestedCommands: ['STATUS', 'EVAC', 'HELP'] });
    return;
  }

  const newHistory: ChatMessage[] = [
    ...history.slice(-10),
    { role: 'user', content: message },
    { role: 'assistant', content: reply.reply },
  ];

  try {
    const existing = await pb.collection('chat_sessions').getList(1, 1, {
      filter: `sessionId="${sessionId}" && userId="${user.id}"`,
    });
    if (existing.items.length > 0) {
      await pb.collection('chat_sessions').update(existing.items[0].id, { history: newHistory });
    } else {
      await pb.collection('chat_sessions').create({
        userId: user.id,
        sessionId,
        locale,
        history: newHistory,
      });
    }
  } catch { /* best-effort */ }

  res.json(reply);
});

export default router;
