import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface GoogleRouteResult {
  etaMinutes: number;
  distanceKm: number;
  polyline: [number, number][];
  steps: string[];
}

const GOOGLE_ROUTES_COMPUTE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

function getComputeRoutesUrl(): string {
  const configured = config.googleMaps.routesBase.trim();

  if (!configured) return GOOGLE_ROUTES_COMPUTE_ROUTES_URL;

  try {
    const url = new URL(configured);
    const isGoogleRoutesHost = url.hostname === 'routes.googleapis.com';
    const isComputeRoutesPath = url.pathname === '/directions/v2:computeRoutes';
    if (isGoogleRoutesHost && isComputeRoutesPath) return configured;

    logger.warn(`Ignoring invalid GOOGLE_ROUTES_BASE=${configured}; using ${GOOGLE_ROUTES_COMPUTE_ROUTES_URL}`);
    return GOOGLE_ROUTES_COMPUTE_ROUTES_URL;
  } catch {
    logger.warn(`Ignoring malformed GOOGLE_ROUTES_BASE=${configured}; using ${GOOGLE_ROUTES_COMPUTE_ROUTES_URL}`);
    return GOOGLE_ROUTES_COMPUTE_ROUTES_URL;
  }
}

function parseDurationSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^([\d.]+)s$/);
  return match ? Number(match[1]) : null;
}

function parseGeoJsonPolyline(value: unknown): [number, number][] {
  const coordinates = ((value as Record<string, unknown> | undefined)?.['coordinates'] ?? []) as unknown[];
  return coordinates
    .map(item => Array.isArray(item) ? [Number(item[1]), Number(item[0])] as [number, number] : null)
    .filter((item): item is [number, number] => !!item && Number.isFinite(item[0]) && Number.isFinite(item[1]));
}

export async function computeGoogleWalkingRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): Promise<GoogleRouteResult | null> {
  if (!config.googleMaps.apiKey) return null;

  try {
    const resp = await axios.post(
      getComputeRoutesUrl(),
      {
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode: 'WALK',
        polylineQuality: 'HIGH_QUALITY',
        polylineEncoding: 'GEO_JSON_LINESTRING',
        languageCode: 'en',
        units: 'METRIC',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': config.googleMaps.apiKey,
          'X-Goog-FieldMask': [
            'routes.duration',
            'routes.distanceMeters',
            'routes.polyline.geoJsonLinestring',
            'routes.legs.steps.navigationInstruction.instructions',
            'routes.legs.steps.distanceMeters',
          ].join(','),
        },
        timeout: 12000,
      }
    );

    const route = resp.data?.routes?.[0] as Record<string, unknown> | undefined;
    if (!route) return null;

    const durationSeconds = parseDurationSeconds(route['duration']);
    const distanceMeters = Number(route['distanceMeters']);
    const polyline = parseGeoJsonPolyline((route['polyline'] as Record<string, unknown> | undefined)?.['geoJsonLinestring']);
    const legs = (route['legs'] as Array<Record<string, unknown>> | undefined) ?? [];
    const stepRecords = legs.flatMap(leg => (leg['steps'] as Array<Record<string, unknown>> | undefined) ?? []);
    const steps = stepRecords
      .map(step => {
        const instruction = ((step['navigationInstruction'] as Record<string, unknown> | undefined)?.['instructions'] ?? '') as string;
        const stepDistanceMeters = Number(step['distanceMeters']);
        return instruction
          ? `${instruction}${Number.isFinite(stepDistanceMeters) ? ` (${(stepDistanceMeters / 1000).toFixed(1)} km)` : ''}`
          : '';
      })
      .filter(Boolean);

    if (!durationSeconds || !Number.isFinite(distanceMeters)) return null;

    return {
      etaMinutes: Math.max(1, Math.ceil(durationSeconds / 60)),
      distanceKm: Number((distanceMeters / 1000).toFixed(2)),
      polyline,
      steps,
    };
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    const msg = (err as Error)?.message?.split('\n')[0] ?? String(err);
    const responseData = (err as { response?: { data?: unknown } })?.response?.data;
    const detail = responseData
      ? ` body=${JSON.stringify(responseData).slice(0, 500)}`
      : '';
    logger.warn(`Google Routes computeRoutes failed (${status ?? 'no response'}) url=${getComputeRoutesUrl()}: ${msg}${detail}`);
    return null;
  }
}
