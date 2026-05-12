import { fetchWeather, type OpenMeteoData } from '../integrations/openmeteo.js';
import { getCondition, getCurrentConditions, setCondition, TTL } from './conditionsCache.js';
import type { ConditionsSnapshot, UserRecord } from '../types/index.js';

const COORD_PRECISION = 3;

export function hasUserLocation(user: Pick<UserRecord, 'lat' | 'lng'> | null | undefined): user is Pick<UserRecord, 'lat' | 'lng'> {
  return Number.isFinite(Number(user?.lat)) && Number.isFinite(Number(user?.lng));
}

export function parseNear(value: unknown): { lat: number; lng: number } | null {
  if (typeof value !== 'string') return null;
  const [rawLat, rawLng] = value.split(',');
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function localWeatherKey(lat: number, lng: number): string {
  return `weather:${lat.toFixed(COORD_PRECISION)},${lng.toFixed(COORD_PRECISION)}`;
}

export async function getLocalWeather(lat?: number, lng?: number): Promise<OpenMeteoData | null> {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return getCondition<OpenMeteoData>('weather');
  }

  const key = localWeatherKey(Number(lat), Number(lng));
  const cached = await getCondition<OpenMeteoData>(key);
  if (cached) return cached;

  const weather = await fetchWeather(Number(lat), Number(lng));
  await setCondition(key, weather, TTL.weather);
  return weather;
}

export async function getLocalizedConditions(lat?: number, lng?: number): Promise<ConditionsSnapshot> {
  const [globalConditions, localWeather] = await Promise.all([
    getCurrentConditions(),
    getLocalWeather(lat, lng),
  ]);

  if (!localWeather) return globalConditions;

  return {
    ...globalConditions,
    rainfall: localWeather.rainfall,
    heatIndex: localWeather.heatIndex,
    fetchedAt: new Date().toISOString(),
  };
}

export function toForecastPreview(weather: OpenMeteoData | null): { day: string; riskLevel: string; temp: number }[] {
  return (weather?.forecast7day ?? []).map(day => ({
    day: day.day,
    riskLevel: day.precipSum > 50 ? 'critical' : day.precipSum > 30 ? 'high' : day.precipSum > 10 ? 'medium' : 'low',
    temp: Math.round(day.tempMax),
  }));
}
