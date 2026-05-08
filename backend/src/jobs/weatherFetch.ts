import { fetchWeather } from '../integrations/openmeteo.js';
import { setCondition, TTL } from '../utils/conditionsCache.js';
import { logger } from '../utils/logger.js';

// Default coordinates: Metro Manila
const DEFAULT_LAT = 14.5995;
const DEFAULT_LNG = 120.9842;

export async function runWeatherFetch(): Promise<void> {
  try {
    logger.info('Running weatherFetch job');
    const data = await fetchWeather(DEFAULT_LAT, DEFAULT_LNG);
    await setCondition('weather', data, TTL.weather);
    logger.info(`Weather fetched: temp=${data.temp}°C rain=${data.rainfall}mm hi=${data.heatIndex}°C`);
  } catch (err) {
    logger.error('weatherFetch job failed', err);
  }
}
