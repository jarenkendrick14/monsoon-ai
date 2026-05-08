import { getPb } from '../pb.js';
import { logger } from './logger.js';
import { ConditionsSnapshot } from '../types/index.js';

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const memCache = new Map<string, CacheEntry>();

export const TTL = {
  weather: 3600,
  firms: 10800,
  pagasa: 1800,
  conditions: 3600,
} as const;

export async function getCondition<T = unknown>(key: string): Promise<T | null> {
  const mem = memCache.get(key);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.data as T;
  }

  try {
    const pb = getPb();
    const records = await pb.collection('conditions_cache').getList(1, 1, {
      filter: `key="${key}"`,
      sort: '-fetchedAt',
    });

    if (records.items.length > 0) {
      const record = records.items[0] as Record<string, unknown>;
      const expiresAt = record['expiresAt'] as number;
      if (expiresAt > Date.now()) {
        const data = record['value'] as T;
        memCache.set(key, { data, expiresAt });
        return data;
      }
    }
  } catch (err) {
    logger.debug(`conditionsCache PB read failed for key=${key}`, err);
  }

  return null;
}

export async function setCondition(key: string, data: unknown, ttlSeconds: number): Promise<void> {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  memCache.set(key, { data, expiresAt });

  try {
    const pb = getPb();
    const existing = await pb.collection('conditions_cache').getList(1, 1, {
      filter: `key="${key}"`,
    });

    const payload = {
      key,
      value: data,
      fetchedAt: new Date().toISOString(),
      expiresAt,
    };

    if (existing.items.length > 0) {
      await pb.collection('conditions_cache').update(existing.items[0].id, payload);
    } else {
      await pb.collection('conditions_cache').create(payload);
    }
  } catch (err) {
    logger.debug(`conditionsCache PB write failed for key=${key}`, err);
  }
}

export async function getCurrentConditions(): Promise<ConditionsSnapshot> {
  const cached = await getCondition<ConditionsSnapshot>('conditions');
  if (cached) return cached;

  const defaults: ConditionsSnapshot = {
    rainfall: 0,
    heatIndex: 32,
    airQuality: 50,
    riverLevel: 1.2,
    aerosolOpticalDepth: 0.3,
    firePts: 0,
    pagasaSignal: 0,
    glofasCritical: false,
    fetchedAt: new Date().toISOString(),
  };

  return defaults;
}
