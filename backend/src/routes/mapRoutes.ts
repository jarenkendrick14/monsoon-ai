import { Router } from 'express';
import { getCondition, getCurrentConditions } from '../utils/conditionsCache.js';
import { getTropomiData } from '../integrations/tropomi.js';
import { getEvacCenters } from '../integrations/evacCenters.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { FirmsHotspot } from '../integrations/firms.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const router = Router();

router.get('/api/map/flood-zones', (_req, res) => {
  try {
    const raw = readFileSync(join(__dirname, '../../data/flood-zones-25yr.geojson'), 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.send(raw);
  } catch {
    res.json({ type: 'FeatureCollection', features: [] });
  }
});

router.get('/api/conditions/rivers', async (req, res) => {
  const near = (req.query['near'] as string)?.split(',');
  const conditions = await getCurrentConditions();
  res.json({
    riverLevel: conditions.riverLevel,
    lat: near ? parseFloat(near[0]) : null,
    lng: near ? parseFloat(near[1]) : null,
    status: conditions.riverLevel > 3 ? 'critical' : conditions.riverLevel > 2 ? 'high' : 'normal',
    fetchedAt: conditions.fetchedAt,
  });
});

router.get('/api/conditions/current', async (_req, res) => {
  const conditions = await getCurrentConditions();
  res.json(conditions);
});

router.get('/api/conditions/air', async (_req, res) => {
  const conditions = await getCurrentConditions();
  res.json({
    airQuality: conditions.airQuality,
    pm25: Math.round(conditions.airQuality * 0.45),
    category: conditions.airQuality > 200 ? 'Hazardous' :
      conditions.airQuality > 150 ? 'Unhealthy' :
        conditions.airQuality > 100 ? 'Unhealthy for Sensitive' :
          conditions.airQuality > 50 ? 'Moderate' : 'Good',
    fetchedAt: conditions.fetchedAt,
  });
});

router.get('/api/conditions/heat', async (_req, res) => {
  const conditions = await getCurrentConditions();
  const hi = conditions.heatIndex;
  res.json({
    heatIndex: hi,
    category: hi >= 54 ? 'Extreme Danger' : hi >= 42 ? 'Danger' : hi >= 33 ? 'Caution' : 'Safe',
    wbgt: Math.round(hi * 0.72),
    fetchedAt: conditions.fetchedAt,
  });
});

router.get('/api/conditions/haze', async (_req, res) => {
  const tropomi = getTropomiData();
  const firms = await getCondition<FirmsHotspot[]>('firms') ?? [];

  res.json({
    aerosolOpticalDepth: tropomi.aerosolOpticalDepth,
    smokeCritical: tropomi.smokeCritical,
    firePts: firms.length,
    source: 'FIRMS/TROPOMI',
    fetchedAt: new Date().toISOString(),
  });
});

export default router;
