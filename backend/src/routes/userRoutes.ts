import { Router } from 'express';
import { z } from 'zod';
import { ClientResponseError } from 'pocketbase';
import { authMiddleware } from '../middleware/auth.js';
import { getPb } from '../pb.js';
import { computeInaSAFEScore } from '../engine/inasafeScore.js';
import { isDisasterMode } from '../utils/disasterMode.js';
import type { UserRecord } from '../types/index.js';

const router = Router();

function isMissingPocketBaseRecord(err: unknown): boolean {
  return err instanceof ClientResponseError && err.status === 404;
}

router.get('/api/user/profile', authMiddleware, async (req, res) => {
  const user = req.user!;
  const { score } = computeInaSAFEScore(user);
  const disasterMode = isDisasterMode(req);
  const scenarioScore = Math.min(100,
    72 +
    (Number(user.floor) === 0 ? 10 : 0) +
    (['nipa_hut', 'bungalow', 'standalone'].includes(user.homeType) ? 6 : 0) +
    (user.hasElderly || user.hasPWD || user.hasInfant || user.hasPregnant ? 8 : 0) +
    ((user.householdSize || 0) >= 4 ? 4 : 0)
  );

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
      riskScore: disasterMode ? Math.max(user.riskScore ?? 0, scenarioScore) : user.riskScore,
      riskTier: disasterMode ? 'critical' : user.riskTier,
      inasafeScore: score,
      isOnRescueList: disasterMode ? true : user.isOnRescueList,
    },
  });
});

const ProfileUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  firstName: z.string().optional(),
  middleName: z.string().optional(),
  lastName: z.string().optional(),
  address: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  coordinates: z.object({
    lat: z.number(),
    lng: z.number(),
  }).optional(),
  locale: z.enum(['en', 'tl', 'vi']).optional(),
  mobile: z.string().optional(),
  phone: z.string().optional(),
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
  const { coordinates, firstName, middleName, lastName, phone, ...data } = parsed.data;
  const fullName = [firstName, middleName, lastName].map(part => part?.trim()).filter(Boolean).join(' ');
  const payload = {
    ...data,
    ...(coordinates ? { lat: coordinates.lat, lng: coordinates.lng } : {}),
    ...(fullName ? { name: fullName } : {}),
    ...(phone ? { mobile: phone } : {}),
  };
  try {
    const updated = await pb.collection('users').update(req.user!.id, payload);
    res.json({ success: true, user: updated });
  } catch (err) {
    if (isMissingPocketBaseRecord(err)) {
      res.status(401).json({ error: 'User session is stale. Please sign in again.' });
      return;
    }
    throw err;
  }
});

const HouseholdSchema = z.object({
  householdSize: z.number().min(1).optional(),
  occupantCount: z.union([z.number().min(1), z.string()]).optional(),
  homeType: z.enum(['bungalow', 'standalone', 'townhouse', 'apartment', 'condo', 'duplex', 'nipa_hut', 'studio']).optional(),
  floor: z.number().min(0).optional(),
  floorLevel: z.union([z.number().min(0), z.string()]).optional(),
  hasSpecialNeeds: z.boolean().optional(),
  specialNeedsFlags: z.array(z.string()).optional(),
  additionalNote: z.string().optional(),
  hasPWD: z.boolean().optional(),
  hasElderly: z.boolean().optional(),
  hasInfant: z.boolean().optional(),
  hasPregnant: z.boolean().optional(),
});

function parseFloorLevel(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (value === 'ground') return 0;
  if (value === '4+') return 4;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOccupantCount(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (value === '2-4') return 4;
  if (value === '5-8') return 8;
  if (value === '9+') return 9;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

router.patch('/api/user/household', authMiddleware, async (req, res) => {
  const parsed = HouseholdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const pb = getPb();
  const { occupantCount, floorLevel, hasSpecialNeeds, specialNeedsFlags, additionalNote, ...data } = parsed.data;
  const needs = new Set(specialNeedsFlags ?? []);
  const parsedOccupantCount = parseOccupantCount(occupantCount);
  const parsedFloorLevel = parseFloorLevel(floorLevel);
  const payload = {
    ...data,
    ...(parsedOccupantCount !== undefined ? { householdSize: parsedOccupantCount } : {}),
    ...(parsedFloorLevel !== undefined ? { floor: parsedFloorLevel } : {}),
    ...(hasSpecialNeeds !== undefined ? {
      hasPWD: hasSpecialNeeds && (needs.has('pwd') || needs.has('mobility')),
      hasElderly: hasSpecialNeeds && needs.has('elderly'),
      hasInfant: hasSpecialNeeds && needs.has('infant'),
      hasPregnant: hasSpecialNeeds && needs.has('pregnant'),
    } : {}),
  };
  try {
    const updated = await pb.collection('users').update(req.user!.id, payload);
    res.json({ success: true, user: updated });
  } catch (err) {
    if (isMissingPocketBaseRecord(err)) {
      res.status(401).json({ error: 'User session is stale. Please sign in again.' });
      return;
    }
    throw err;
  }
});

router.get('/api/user/risk-summary', authMiddleware, async (req, res) => {
  const user = req.user!;
  const { score, tier, riskFactors } = computeInaSAFEScore(user);
  const disasterMode = isDisasterMode(req);
  const scenarioScore = Math.min(100,
    72 +
    (Number(user.floor) === 0 ? 10 : 0) +
    (['nipa_hut', 'bungalow', 'standalone'].includes(user.homeType) ? 6 : 0) +
    (user.hasElderly || user.hasPWD || user.hasInfant || user.hasPregnant ? 8 : 0) +
    ((user.householdSize || 0) >= 4 ? 4 : 0)
  );

  res.json({
    user: {
      fullName: user.name,
      address: user.address,
      mobile: user.mobile,
    },
    riskScore: disasterMode ? Math.max(score, scenarioScore) : score,
    riskTier: disasterMode ? 'critical' : tier,
    vulnerabilityFlags: disasterMode ? [...riskFactors, 'active typhoon flood scenario'] : riskFactors,
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
