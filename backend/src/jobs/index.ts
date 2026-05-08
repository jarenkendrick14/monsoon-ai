import cron from 'node-cron';
import { runWeatherFetch } from './weatherFetch.js';
import { runPagasaFetch } from './pagasaFetch.js';
import { runFirmsFetch } from './firmsFetch.js';
import { runRiskEval } from './riskEval.js';
import { runAlertFire } from './alertFire.js';
import { logger } from '../utils/logger.js';

export function startJobs(): void {
  cron.schedule('0 * * * *', () => void runWeatherFetch(), { name: 'weatherFetch' });
  cron.schedule('0 */3 * * *', () => void runFirmsFetch(), { name: 'firmsFetch' });
  cron.schedule('*/30 * * * *', () => void runPagasaFetch(), { name: 'pagasaFetch' });
  cron.schedule('*/30 * * * *', () => void runRiskEval(), { name: 'riskEval' });
  cron.schedule('*/30 * * * *', () => void runAlertFire(), { name: 'alertFire' });

  logger.info('Cron jobs registered');

  // Prime caches on startup
  void runWeatherFetch();
  void runPagasaFetch();
  void runFirmsFetch();
}
