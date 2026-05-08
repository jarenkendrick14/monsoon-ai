import { Router } from 'express';
import { z } from 'zod';
import { geocodeAddress } from '../integrations/geocoder.js';

const router = Router();

const GeocodeSchema = z.object({
  address: z.string().min(3),
});

router.post('/api/geocode', async (req, res) => {
  const parsed = GeocodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Address required' });
    return;
  }

  const result = await geocodeAddress(parsed.data.address);
  if (!result) {
    res.status(404).json({ error: 'Address not found' });
    return;
  }

  res.json(result);
});

export default router;
