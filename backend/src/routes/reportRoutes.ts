import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getPb } from '../pb.js';
import { tagHazards } from '../integrations/gemini.js';
import { logger } from '../utils/logger.js';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/api/reports/hazard-photo', authMiddleware, upload.single('photo'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'photo is required' });
    return;
  }

  const user = req.user!;
  const imageBase64 = req.file.buffer.toString('base64');
  const mimeType = req.file.mimetype;

  const hazards = await tagHazards(imageBase64, mimeType);

  const pb = getPb();
  let reportId = '';
  try {
    const record = await pb.collection('hazard_reports').create({
      userId: user.id,
      hazards,
      lat: user.lat ?? null,
      lng: user.lng ?? null,
    });
    reportId = record.id;
  } catch (err) {
    logger.warn('Failed to save hazard report', err instanceof Error ? err.message : err);
  }

  res.json({ hazards, reportId, savedAt: new Date().toISOString() });
});

export default router;
