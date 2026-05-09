import { fetchAirQuality } from '../integrations/airquality.js';
import { fetchGloFAS } from '../integrations/glofas.js';
import { setCondition, getCondition, TTL } from '../utils/conditionsCache.js';
import { logger } from '../utils/logger.js';
import type { OpenMeteoData } from '../integrations/openmeteo.js';

const DEFAULT_LAT = 14.5995;
const DEFAULT_LNG = 120.9842;

export async function runConditionsFetch(): Promise<void> {
  try {
    logger.info('Running conditionsFetch job');
    const weather = await getCondition<OpenMeteoData>('weather');

    const lat = DEFAULT_LAT;
    const lng = DEFAULT_LNG;

    const [aq, flood] = await Promise.all([
      fetchAirQuality(lat, lng),
      fetchGloFAS(lat, lng),
    ]);

    // Normalize raw discharge (m³/s) to a 0–5 NHWL-equivalent scale.
    // Reference: Pampanga River ~500 m³/s normal, ~3000 m³/s major flood.
    const riverLevel = Math.min(5, flood.riverDischarge / 600);

    const snapshot = {
      rainfall: weather?.rainfall ?? 0,
      heatIndex: weather?.heatIndex ?? 32,
      airQuality: aq.usAqi,
      pm25: aq.pm25,
      riverLevel: Math.round(riverLevel * 10) / 10,
      riverDischarge: flood.riverDischarge,
      glofasCritical: flood.critical,
      fetchedAt: new Date().toISOString(),
    };

    await setCondition('conditions', snapshot, TTL.conditions);
    logger.info(`Conditions fetched: AQI=${aq.usAqi} discharge=${flood.riverDischarge}m³/s riverLevel=${snapshot.riverLevel} critical=${flood.critical}`);
  } catch (err: unknown) {
    const msg = (err as Error)?.message?.split('\n')[0] ?? String(err);
    logger.error(`conditionsFetch job failed: ${msg}`);
  }
}
