import { fetchFirmsHotspots } from '../integrations/firms.js';
import { setCondition, TTL } from '../utils/conditionsCache.js';
import { logger } from '../utils/logger.js';

export async function runFirmsFetch(): Promise<void> {
  try {
    logger.info('Running firmsFetch job');
    const hotspots = await fetchFirmsHotspots();
    await setCondition('firms', hotspots, TTL.firms);
    logger.info(`FIRMS fetched: ${hotspots.length} hotspots`);
  } catch (err) {
    logger.error('firmsFetch job failed', err);
  }
}
