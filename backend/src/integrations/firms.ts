import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface FirmsHotspot {
  lat: number;
  lng: number;
  brightness: number;
  acqDate: string;
  confidence: string;
}

// PH + VN bounding box
const BBOX = { minLat: 5, maxLat: 25, minLng: 100, maxLng: 130 };

export async function fetchFirmsHotspots(): Promise<FirmsHotspot[]> {
  if (!config.firms.mapKey) {
    logger.warn('FIRMS_MAP_KEY not set, returning empty hotspots');
    return [];
  }

  try {
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${config.firms.mapKey}/VIIRS_SNPP_NRT/${BBOX.minLng},${BBOX.minLat},${BBOX.maxLng},${BBOX.maxLat}/1`;
    const resp = await axios.get<string>(url, { timeout: 15000 });
    return parseFirmsCsv(resp.data);
  } catch (err) {
    logger.warn('FIRMS fetch failed', err);
    return [];
  }
}

function parseFirmsCsv(csv: string): FirmsHotspot[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const latIdx = header.indexOf('latitude');
  const lngIdx = header.indexOf('longitude');
  const brightIdx = header.indexOf('bright_ti4');
  const dateIdx = header.indexOf('acq_date');
  const confIdx = header.indexOf('confidence');

  const hotspots: FirmsHotspot[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const lat = parseFloat(cols[latIdx]);
    const lng = parseFloat(cols[lngIdx]);
    if (isNaN(lat) || isNaN(lng)) continue;

    hotspots.push({
      lat,
      lng,
      brightness: parseFloat(cols[brightIdx]) || 0,
      acqDate: cols[dateIdx]?.trim() ?? '',
      confidence: cols[confIdx]?.trim() ?? 'nominal',
    });
  }

  return hotspots;
}

export function countHotspotsNear(hotspots: FirmsHotspot[], lat: number, lng: number, radiusKm = 20): number {
  return hotspots.filter(h => {
    const dlat = h.lat - lat;
    const dlng = h.lng - lng;
    const dist = Math.sqrt(dlat * dlat + dlng * dlng) * 111;
    return dist <= radiusKm;
  }).length;
}
