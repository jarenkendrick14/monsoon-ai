import { fetchPagasa } from '../integrations/pagasa.js';
import { setCondition, TTL } from '../utils/conditionsCache.js';
import { logger } from '../utils/logger.js';

export async function runPagasaFetch(): Promise<void> {
  try {
    logger.info('Running pagasaFetch job');
    const data = await fetchPagasa();
    await setCondition('pagasa', data, TTL.pagasa);
    logger.info(`PAGASA fetched: signal=${data.signal}`);
  } catch (err) {
    logger.error('pagasaFetch job failed', err);
  }
}
