import { Router } from 'express';
import { z } from 'zod';
import PocketBase from 'pocketbase';
import { getPb } from '../pb.js';
import { config } from '../config.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { logger } from '../utils/logger.js';

const router = Router();

const RegisterSchema = z.object({
  username: z.string().min(3).max(30),
  email: z.string().email(),
  mobile: z.string().min(7).max(20),
  password: z.string().min(8),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/api/auth/register', authLimiter, async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const { username, email, mobile, password } = parsed.data;
  const pb = new PocketBase(config.pb.url);

  try {
    const user = await pb.collection('users').create({
      name: username,
      email,
      mobile,
      password,
      passwordConfirm: password,
      role: 'citizen',
      locale: 'en',
      riskScore: 0,
      riskTier: 'low',
      isOnRescueList: false,
      alertOptIn: true,
      smsOptIn: false,
      householdSize: 1,
      hasPWD: false,
      hasElderly: false,
      hasInfant: false,
      hasPregnant: false,
      homeType: 'standalone',
      floor: 1,
    });

    const auth = await pb.collection('users').authWithPassword(email, password);

    res.status(201).json({
      token: auth.token,
      user: {
        id: user.id,
        name: user['name'],
        riskLevel: 'low',
      },
    });
  } catch (err: unknown) {
    logger.debug('Register error', err);
    const msg = (err as Record<string, unknown>)?.['message'] ?? 'Registration failed';
    res.status(400).json({ error: msg });
  }
});

router.post('/api/auth/login', authLimiter, async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed' });
    return;
  }

  const { email, password } = parsed.data;
  const pb = new PocketBase(config.pb.url);

  try {
    const auth = await pb.collection('users').authWithPassword(email, password);
    const user = auth.record;

    res.json({
      token: auth.token,
      user: {
        id: user.id,
        name: user['name'],
        riskLevel: (user['riskTier'] as string) ?? 'low',
      },
    });
  } catch {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

router.delete('/api/auth/session', (_req, res) => {
  res.json({ message: 'Session cleared' });
});

router.get('/api/auth/check-username', async (req, res) => {
  const q = (req.query['q'] as string)?.trim();
  if (!q) {
    res.json({ available: false });
    return;
  }

  const pb = getPb();
  try {
    const result = await pb.collection('users').getList(1, 1, {
      filter: `name="${q}"`,
    });
    res.json({ available: result.totalItems === 0 });
  } catch {
    res.json({ available: true });
  }
});

export default router;
