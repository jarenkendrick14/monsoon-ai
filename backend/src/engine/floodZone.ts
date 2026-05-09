import { readFileSync } from 'fs';
import { config } from '../config.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point, featureCollection } from '@turf/helpers';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import * as GeoJSON from 'geojson';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');

function loadGeoJSON(filename: string): FeatureCollection<Polygon | MultiPolygon> {
  try {
    const raw = readFileSync(join(DATA_DIR, filename), 'utf8');
    return JSON.parse(raw) as FeatureCollection<Polygon | MultiPolygon>;
  } catch {
    logger.warn(`Could not load ${filename}, using empty FeatureCollection`);
    return featureCollection([]) as FeatureCollection<Polygon | MultiPolygon>;
  }
}

const zones25yr = loadGeoJSON('flood-zones-25yr.geojson');
const zones100yr = loadGeoJSON('flood-zones-100yr.geojson');

export function isIn25yrZone(lat: number, lng: number): boolean {
  const mock = config.mocks.floodZone;
  if (mock === '25yr') return true;
  if (zones25yr.features.length === 0) return false;
  const pt = point([lng, lat]);
  return zones25yr.features.some((f: GeoJSON.Feature) => booleanPointInPolygon(pt, f as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>));
}

export function isIn100yrZone(lat: number, lng: number): boolean {
  const mock = config.mocks.floodZone;
  if (mock === '25yr' || mock === '100yr') return true;
  if (zones100yr.features.length === 0) return false;
  const pt = point([lng, lat]);
  return zones100yr.features.some((f: GeoJSON.Feature) => booleanPointInPolygon(pt, f as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>));
}

export function getFloodZoneLabel(lat: number, lng: number): string {
  if (isIn25yrZone(lat, lng)) return '25yr flood zone';
  if (isIn100yrZone(lat, lng)) return '100yr flood zone';
  return 'no flood zone';
}
