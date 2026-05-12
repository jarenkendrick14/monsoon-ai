import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EvacCenter } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { discoverEvacCenterCandidates } from './googlePlaces.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let centers: EvacCenter[] | null = null;

export function getEvacCenters(): EvacCenter[] {
  if (centers) return centers;

  try {
    const raw = readFileSync(join(__dirname, '../../data/evac-centers.json'), 'utf8');
    centers = (JSON.parse(raw) as EvacCenter[]).map(center => ({
      ...center,
      source: center.source ?? 'static',
      verificationStatus: center.verificationStatus ?? 'verified',
    }));
  } catch {
    logger.warn('evac-centers.json not found, using empty list');
    centers = [];
  }

  return centers;
}

export function findNearestCenter(lat: number, lng: number): EvacCenter | null {
  const all = getEvacCenters();
  if (!all.length) return null;

  let nearest: EvacCenter | null = null;
  let minDist = Infinity;

  for (const c of all) {
    const dlat = c.lat - lat;
    const dlng = c.lng - lng;
    const dist = Math.sqrt(dlat * dlat + dlng * dlng);
    if (dist < minDist) {
      minDist = dist;
      nearest = c;
    }
  }

  return nearest;
}

export async function getEvacCentersNear(lat?: number, lng?: number): Promise<EvacCenter[]> {
  const staticCenters = getEvacCenters();
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat == null || lng == null) {
    return staticCenters;
  }

  const candidates = await discoverEvacCenterCandidates(lat, lng);
  return mergeCenters(staticCenters, candidates);
}

export async function findNearestCenterNear(lat: number, lng: number): Promise<EvacCenter | null> {
  const all = await getEvacCentersNear(lat, lng);
  if (!all.length) return null;

  let nearest: EvacCenter | null = null;
  let minDist = Infinity;

  for (const c of all) {
    const dist = distanceKm(lat, lng, c.lat, c.lng);
    if (dist < minDist) {
      minDist = dist;
      nearest = c;
    }
  }

  return nearest;
}

function mergeCenters(staticCenters: EvacCenter[], candidates: EvacCenter[]): EvacCenter[] {
  const merged = [...staticCenters];
  const seen = new Set(staticCenters.map(centerKey));

  for (const candidate of candidates) {
    const key = centerKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
  }

  return merged;
}

function centerKey(center: EvacCenter): string {
  if (center.placeId) return `place:${center.placeId}`;
  return `${center.name.toLowerCase().replace(/\s+/g, ' ').trim()}:${center.lat.toFixed(4)},${center.lng.toFixed(4)}`;
}

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
