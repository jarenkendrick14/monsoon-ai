import axios from 'axios';
import { logger } from '../utils/logger.js';

export interface AirQualityData {
  usAqi: number;
  pm25: number;
}

export async function fetchAirQuality(lat: number, lng: number): Promise<AirQualityData> {
  try {
    const resp = await axios.get('https://air-quality-api.open-meteo.com/v1/air-quality', {
      params: {
        latitude: lat,
        longitude: lng,
        current: 'us_aqi,pm2_5',
      },
      timeout: 15000,
    });

    const current = resp.data?.current as Record<string, number>;
    return {
      usAqi: Math.round(current['us_aqi'] ?? 50),
      pm25: current['pm2_5'] ?? 0,
    };
  } catch (err: unknown) {
    const msg = (err as Error)?.message?.split('\n')[0] ?? String(err);
    logger.warn(`Air quality fetch failed: ${msg}`);
    return { usAqi: 50, pm25: 0 };
  }
}
