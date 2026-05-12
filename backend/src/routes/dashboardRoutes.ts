import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getPb } from '../pb.js';
import { getCondition } from '../utils/conditionsCache.js';
import { getLocalWeather, getLocalizedConditions, toForecastPreview } from '../utils/localConditions.js';
import { applyDisasterContext, DISASTER_FORECAST, DISASTER_SCENARIO, disasterAlert, isDisasterMode } from '../utils/disasterMode.js';
import { generateAlertDetailGuidance } from '../integrations/gemini.js';
import type { PagasaData } from '../integrations/pagasa.js';
import type { AlertRecord, RiskContext } from '../types/index.js';

const router = Router();

function readSituationContext(req: { get(name: string): string | undefined }): RiskContext['situation'] {
  const raw = req.get('x-monsoon-situation-context');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8')) as RiskContext['situation'];
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      companions: Array.isArray(parsed.companions) ? parsed.companions.filter(v => typeof v === 'string').slice(0, 6) : [],
      needs: Array.isArray(parsed.needs) ? parsed.needs.filter(v => typeof v === 'string').slice(0, 8) : [],
      absent: Array.isArray(parsed.absent) ? parsed.absent.filter(v => typeof v === 'string').slice(0, 8) : [],
      profileFlagsNotPresent: parsed.profileFlagsNotPresent === true,
      waterLevel: typeof parsed.waterLevel === 'string' ? parsed.waterLevel : null,
      canLeaveSafely: typeof parsed.canLeaveSafely === 'string' ? parsed.canLeaveSafely : null,
      notes: Array.isArray(parsed.notes) ? parsed.notes.filter(v => typeof v === 'string').slice(0, 6) : [],
    };
  } catch {
    return null;
  }
}

router.get('/api/dashboard', authMiddleware, async (req, res) => {
  const user = req.user!;
  const pb = getPb();
  const disasterMode = isDisasterMode(req);

  const [weather, conditions] = await Promise.all([
    getLocalWeather(user.lat, user.lng),
    getLocalizedConditions(user.lat, user.lng),
  ]);

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

  const forecast7day = toForecastPreview(weather);

  res.json({
    user: {
      firstName: user.name?.split(' ')[0] ?? user.name ?? '',
      address: user.address ?? '',
    },
    alertLevel: disasterMode ? 'critical' : alertLevel,
    forecast7day: disasterMode ? DISASTER_FORECAST : forecast7day,
    conditions: {
      riverLevel: disasterMode ? DISASTER_SCENARIO.riverLevel : conditions.riverLevel,
      airQuality: disasterMode ? DISASTER_SCENARIO.airQuality : conditions.airQuality,
      heatIndex: disasterMode ? DISASTER_SCENARIO.heatIndex : conditions.heatIndex,
      rainfall: disasterMode ? DISASTER_SCENARIO.rainfall24h : undefined,
    },
  });
});

router.get('/api/alerts/active', authMiddleware, async (req, res) => {
  const user = req.user!;
  const pb = getPb();
  if (isDisasterMode(req)) {
    const alert = disasterAlert(user);
    const context: RiskContext = applyDisasterContext({
      alertLevel: alert.level,
      trigger: alert.type,
      location: user.address || 'Philippines',
      situation: readSituationContext(req),
      evacCenter: null,
      conditions: null,
    });
    const guidance = await generateAlertDetailGuidance(user, context);
    res.json({
      alertId: alert.id,
      level: alert.level,
      evacuateWithin: alert.evacuateWithin,
      rainfall: alert.rainfall,
      floodZone: alert.floodZone,
      riverDischarge: alert.riverDischarge,
      issuedAt: alert.issuedAt,
      reEvalAt: alert.reEvalAt,
      headline: guidance.headline,
      reasons: guidance.reasons,
      checklist: guidance.checklist,
      sourceIds: guidance.sourceIds,
      generatedBy: 'llm_rag',
    });
    return;
  }

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

router.get('/api/alerts/active-storm', async (req, res) => {
  if (isDisasterMode(req)) {
    res.json({
      signal: DISASTER_SCENARIO.signal,
      bulletinTitle: DISASTER_SCENARIO.bulletinTitle,
      issuedAt: new Date().toISOString(),
    });
    return;
  }
  const pagasa = await getCondition<PagasaData>('pagasa');
  res.json({
    signal: pagasa?.signal ?? 0,
    bulletinTitle: pagasa?.bulletinTitle ?? 'No active storm',
    issuedAt: pagasa?.issuedAt ?? new Date().toISOString(),
  });
});

export default router;
