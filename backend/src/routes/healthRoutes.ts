import { Router } from 'express';
import { isPbConnected } from '../pb.js';

const router = Router();

router.get('/health', async (_req, res) => {
  const pbOk = await isPbConnected();
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    pb: pbOk ? 'connected' : 'disconnected',
  });
});

export default router;
