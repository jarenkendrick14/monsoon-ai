import axios from 'axios';
import { logger } from '../utils/logger.js';

export interface GloFASData {
  critical: boolean;
  riverDischarge: number;
}

// Open-Meteo Global Flood API — same GloFAS v4 (ECMWF) data, no key required
export async function fetchGloFAS(lat: number, lng: number): Promise<GloFASData> {
  try {
    const resp = await axios.get('https://flood-api.open-meteo.com/v1/flood', {
      params: {
        latitude: lat,
        longitude: lng,
        daily: 'river_discharge',
        forecast_days: 1,
      },
      timeout: 15000,
    });

    const discharge: number = (resp.data?.daily?.river_discharge as number[])?.[0] ?? 0;
    // >2000 m³/s is a high-end threshold for major Philippine rivers (Pampanga ~3000 at flood)
    return { critical: discharge > 2000, riverDischarge: Math.round(discharge) };
  } catch (err: unknown) {
    const msg = (err as Error)?.message?.split('\n')[0] ?? String(err);
    logger.warn(`GloFAS fetch failed: ${msg}`);
    return { critical: false, riverDischarge: 0 };
  }
}
