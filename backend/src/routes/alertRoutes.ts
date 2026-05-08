import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getPb } from '../pb.js';
import type { AlertRecord } from '../types/index.js';

const router = Router();

router.get('/api/alerts/:alertId', authMiddleware, async (req, res) => {
  const { alertId } = req.params;
  const pb = getPb();

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
