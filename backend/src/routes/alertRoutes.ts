import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getPb } from '../pb.js';
import { applyDisasterContext, disasterAlert, isDisasterMode } from '../utils/disasterMode.js';
import { generateAlertDetailGuidance } from '../integrations/gemini.js';
import type { RiskContext } from '../types/index.js';
import type { AlertRecord } from '../types/index.js';

const router = Router();

router.get('/api/alerts/:alertId', authMiddleware, async (req, res) => {
  const { alertId } = req.params;
  const pb = getPb();
  if (isDisasterMode(req) && alertId === 'disaster-mode-critical-flood') {
    const alert = disasterAlert(req.user!);
    const context: RiskContext = applyDisasterContext({
      alertLevel: alert.level,
      trigger: alert.type,
      location: req.user!.address || 'Philippines',
      evacCenter: null,
      conditions: null,
    });
    const guidance = await generateAlertDetailGuidance(req.user!, context);
    res.json({
      alertId: alert.id,
      level: alert.level,
      type: alert.type,
      headline: guidance.headline,
      reasons: guidance.reasons,
      checklist: guidance.checklist,
      sourceIds: guidance.sourceIds,
      generatedBy: 'llm_rag',
      issuedAt: alert.issuedAt,
      reEvalAt: alert.reEvalAt,
    });
    return;
  }

  try {
    const alert = await pb.collection('alerts').getOne<AlertRecord>(alertId);

    if (alert.userId !== req.user!.id) {
      res.status(403).json({ error: 'Not your alert' });
      return;
    }

    res.json({
      alertId: alert.id,
      level: alert.level,
      type: alert.type,
      reasons: alert.reasons ?? [],
      checklist: alert.checklist ?? [],
      issuedAt: alert.issuedAt,
      reEvalAt: alert.reEvalAt,
    });
  } catch {
    res.status(404).json({ error: 'Alert not found' });
  }
});

export default router;
