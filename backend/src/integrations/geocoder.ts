import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface GeocodedLocation {
  lat: number;
  lng: number;
  displayName: string;
}

export async function geocodeAddress(address: string): Promise<GeocodedLocation | null> {
  try {
    const resp = await axios.get(`${config.nominatim.base}/search`, {
      params: {
        q: address,
        format: 'jsonv2',
        limit: 1,
        countrycodes: 'ph,vn',
      },
      headers: {
        'User-Agent': 'MonsoonAI/1.0 (jarenkendricky@gmail.com)',
      },
      timeout: 10000,
    });

    const results = resp.data as Array<Record<string, string>>;
    if (!results.length) return null;

    return {
      lat: parseFloat(results[0]['lat']),
      lng: parseFloat(results[0]['lon']),
      displayName: results[0]['display_name'],
    };
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    const msg = (err as Error)?.message?.split('\n')[0] ?? String(err);
    logger.warn(`Nominatim geocode failed (${status ?? 'no response'}): ${msg}`);
    return null;
  }
}
