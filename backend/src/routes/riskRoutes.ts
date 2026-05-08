import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { evaluateRisk } from '../engine/riskEngine.js';
import { getCurrentConditions } from '../utils/conditionsCache.js';
import { getPb } from '../pb.js';
import { getGloFASData } from '../integrations/glofas.js';
import { getTropomiData } from '../integrations/tropomi.js';
import { getCondition } from '../utils/conditionsCache.js';
import { countHotspotsNear } from '../integrations/firms.js';
import type { FirmsHotspot } from '../integrations/firms.js';
import type { PagasaData } from '../integrations/pagasa.js';
import type { ConditionsSnapshot } from '../types/index.js';

const router = Router();

router.post('/api/risk/score', authMiddleware, async (req, res) => {
  const user = req.user!;

  const pagasa = await getCondition<PagasaData>('pagasa');
  const firms = await getCondition<FirmsHotspot[]>('firms') ?? [];
  const glofas = getGloFASData();
  const tropomi = getTropomiData();
  const weather = await getCurrentConditions();
  const firePts = countHotspotsNear(firms, user.lat, user.lng);

  const conditions: ConditionsSnapshot = {
    ...weather,
    aerosolOpticalDepth: tropomi.aerosolOpticalDepth,
    firePts,
    pagasaSignal: pagasa?.signal ?? 0,
    glofasCritical: glofas.critical,
    fetchedAt: new Date().toISOString(),
  };

  const result = evaluateRisk({ user, conditions });

  const pb = getPb();
  await pb.collection('users').update(user.id, {
    riskScore: result.level === 'critical' ? 95 : result.level === 'high' ? 75 : result.level === 'medium' ? 45 : 20,
    riskTier: result.level === 'none' ? 'low' : result.level,
  });

  res.json({
    riskTier: result.level,
    trigger: result.trigger,
    evacuateWithin: result.evacuateWithin,
    reasons: result.reasons,
  });
});

export default router;
