import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { getPb } from '../pb.js';
import { computeInaSAFEScore } from '../engine/inasafeScore.js';
import type { UserRecord } from '../types/index.js';

const router = Router();

router.get('/api/user/profile', authMiddleware, async (req, res) => {
  const user = req.user!;
  const { score } = computeInaSAFEScore(user);

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    mobile: user.mobile,
    locale: user.locale,
    address: user.address,
    lat: user.lat,
    lng: user.lng,
    homeType: user.homeType,
    floor: user.floor,
    householdSize: user.householdSize,
    hasPWD: user.hasPWD,
    hasElderly: user.hasElderly,
    hasInfant: user.hasInfant,
    hasPregnant: user.hasPregnant,
    alertOptIn: user.alertOptIn,
    smsOptIn: user.smsOptIn,
    created: user.created,
    risk: {
      riskScore: user.riskScore,
      riskTier: user.riskTier,
      inasafeScore: score,
      isOnRescueList: user.isOnRescueList,
    },
  });
});

const ProfileUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  locale: z.enum(['en', 'tl', 'vi']).optional(),
  mobile: z.string().optional(),
  alertOptIn: z.boolean().optional(),
  smsOptIn: z.boolean().optional(),
});

router.patch('/api/user/profile', authMiddleware, async (req, res) => {
  const parsed = ProfileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const pb = getPb();
  const updated = await pb.collection('users').update(req.user!.id, parsed.data);
  res.json({ success: true, user: updated });
});

const HouseholdSchema = z.object({
  householdSize: z.number().min(1).optional(),
  homeType: z.enum(['bungalow', 'standalone', 'townhouse', 'apartment', 'condo', 'duplex', 'nipa_hut', 'studio']).optional(),
  floor: z.number().min(0).optional(),
  hasPWD: z.boolean().optional(),
  hasElderly: z.boolean().optional(),
  hasInfant: z.boolean().optional(),
  hasPregnant: z.boolean().optional(),
});

router.patch('/api/user/household', authMiddleware, async (req, res) => {
  const parsed = HouseholdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const pb = getPb();
  const updated = await pb.collection('users').update(req.user!.id, parsed.data);
  res.json({ success: true, user: updated });
});

router.get('/api/user/risk-summary', authMiddleware, async (req, res) => {
  const user = req.user!;
  const { score, tier, riskFactors } = computeInaSAFEScore(user);

  res.json({
    user: {
      fullName: user.name,
      address: user.address,
      mobile: user.mobile,
    },
    riskScore: score,
    riskTier: tier,
    vulnerabilityFlags: riskFactors,
  });
});

router.patch('/api/user/checklist', authMiddleware, async (req, res) => {
  const { alertId, checked } = req.body as { alertId: string; checked: string[] };
  if (!alertId) {
    res.status(400).json({ error: 'alertId required' });
    return;
  }

  const pb = getPb();
  try {
    const alert = await pb.collection('alerts').getOne(alertId);
    if ((alert as Record<string, unknown>)['userId'] !== req.user!.id) {
      res.status(403).json({ error: 'Not your alert' });
      return;
    }
    await pb.collection('alerts').update(alertId, { checklist: checked });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'Alert not found' });
  }
});

export default router;
