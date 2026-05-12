import { Router } from 'express';
import { getCondition, getCurrentConditions } from '../utils/conditionsCache.js';
import { getLocalizedConditions, parseNear } from '../utils/localConditions.js';
import { getTropomiData } from '../integrations/tropomi.js';
import { getEvacCenters } from '../integrations/evacCenters.js';
import { config } from '../config.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { FirmsHotspot } from '../integrations/firms.js';
import { DISASTER_SCENARIO, disasterConditions, isDisasterMode } from '../utils/disasterMode.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const router = Router();

router.get('/api/maps/config', (_req, res) => {
  res.json({
    provider: 'google',
    apiKey: config.googleMaps.browserKey,
  });
});

function disasterFloodZones(lat = 15.1348, lng = 120.5869) {
  const dLat = 0.010;
  const dLng = 0.012;
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        name: 'Disaster Mode 25-year flood extent',
        returnPeriod: '25-year',
        scenario: DISASTER_SCENARIO.bulletinTitle,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [lng - dLng, lat - dLat],
          [lng + dLng, lat - dLat * 0.8],
          [lng + dLng * 0.9, lat + dLat],
          [lng - dLng * 0.7, lat + dLat * 0.8],
          [lng - dLng, lat - dLat],
        ]],
      },
    }],
  };
}

router.get('/api/map/flood-zones', (req, res) => {
  if (isDisasterMode(req)) {
    const near = parseNear(req.query['near']);
    res.json(disasterFloodZones(near?.lat, near?.lng));
    return;
  }
  try {
    const raw = readFileSync(join(__dirname, '../../data/flood-zones-25yr.geojson'), 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.send(raw);
  } catch {
    res.json({ type: 'FeatureCollection', features: [] });
  }
});

router.get('/api/conditions/rivers', async (req, res) => {
  const near = parseNear(req.query['near']);
  if (isDisasterMode(req)) {
    const conditions = disasterConditions();
    res.json({
      riverLevel: conditions.riverLevel,
      lat: near?.lat ?? null,
      lng: near?.lng ?? null,
      status: 'critical',
      fetchedAt: conditions.fetchedAt,
    });
    return;
  }
  const conditions = await getCurrentConditions();
  res.json({
    riverLevel: conditions.riverLevel,
    lat: near?.lat ?? null,
    lng: near?.lng ?? null,
    status: conditions.riverLevel > 3 ? 'critical' : conditions.riverLevel > 2 ? 'high' : 'normal',
    fetchedAt: conditions.fetchedAt,
  });
});

router.get('/api/conditions/current', async (req, res) => {
  if (isDisasterMode(req)) {
    res.json(disasterConditions());
    return;
  }
  const near = parseNear(req.query['near']);
  const conditions = near
    ? await getLocalizedConditions(near.lat, near.lng)
    : await getCurrentConditions();
  res.json(conditions);
});

router.get('/api/conditions/air', async (req, res) => {
  if (isDisasterMode(req)) {
    const conditions = disasterConditions();
    res.json({
      airQuality: conditions.airQuality,
      pm25: Math.round(conditions.airQuality * 0.45),
      category: 'Moderate',
      fetchedAt: conditions.fetchedAt,
    });
    return;
  }
  const near = parseNear(req.query['near']);
  const conditions = near
    ? await getLocalizedConditions(near.lat, near.lng)
    : await getCurrentConditions();
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

router.get('/api/conditions/heat', async (req, res) => {
  if (isDisasterMode(req)) {
    const conditions = disasterConditions();
    res.json({
      heatIndex: conditions.heatIndex,
      category: 'Safe',
      wbgt: Math.round(conditions.heatIndex * 0.72),
      fetchedAt: conditions.fetchedAt,
    });
    return;
  }
  const near = parseNear(req.query['near']);
  const conditions = near
    ? await getLocalizedConditions(near.lat, near.lng)
    : await getCurrentConditions();
  const hi = conditions.heatIndex;
  res.json({
    heatIndex: hi,
    category: hi >= 54 ? 'Extreme Danger' : hi >= 42 ? 'Danger' : hi >= 33 ? 'Caution' : 'Safe',
    wbgt: Math.round(hi * 0.72),
    fetchedAt: conditions.fetchedAt,
  });
});

router.get('/api/conditions/haze', async (req, res) => {
  if (isDisasterMode(req)) {
    const conditions = disasterConditions();
    res.json({
      aerosolOpticalDepth: conditions.aerosolOpticalDepth,
      smokeCritical: false,
      firePts: 0,
      source: 'Disaster Mode scenario',
      fetchedAt: conditions.fetchedAt,
    });
    return;
  }
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
