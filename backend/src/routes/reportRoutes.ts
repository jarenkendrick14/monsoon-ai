import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getPb } from '../pb.js';
import { tagHazards } from '../integrations/gemini.js';
import { logger } from '../utils/logger.js';
import multer from 'multer';
import { broadcastGov } from '../ws.js';

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
  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : '';

  const tagging = await tagHazards(imageBase64, mimeType);

  const pb = getPb();
  let reportId = '';
  try {
    const form = new FormData();
    form.append('userId', user.id);
    const imageBytes = req.file.buffer.buffer.slice(
      req.file.buffer.byteOffset,
      req.file.buffer.byteOffset + req.file.buffer.byteLength
    ) as ArrayBuffer;
    form.append('photo', new Blob([imageBytes], { type: mimeType }), req.file.originalname || 'hazard-photo.jpg');
    form.append('hazards', JSON.stringify(tagging.hazards));
    form.append('confidence', tagging.confidence);
    form.append('needsHumanReview', String(tagging.needsHumanReview));
    form.append('note', note);
    if (user.lat != null) form.append('lat', String(user.lat));
    if (user.lng != null) form.append('lng', String(user.lng));

    const record = await pb.collection('hazard_reports').create(form);
    reportId = record.id;
    broadcastGov({
      type: 'HAZARD_REPORT',
      payload: {
        reportId,
        hazards: tagging.hazards,
        confidence: tagging.confidence,
        lat: user.lat ?? null,
        lng: user.lng ?? null,
      },
    });
  } catch (err) {
    logger.warn('Failed to save hazard report', err instanceof Error ? err.message : err);
  }

  res.json({
    hazards: tagging.hazards,
    confidence: tagging.confidence,
    needsHumanReview: tagging.needsHumanReview,
    reportId,
    savedAt: new Date().toISOString(),
    message: 'Report sent to LGU for human review.',
  });
});

export default router;
