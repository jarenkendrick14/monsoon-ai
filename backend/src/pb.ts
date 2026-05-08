import PocketBase from 'pocketbase';
import { config } from './config.js';
import { logger } from './utils/logger.js';

let pb: PocketBase | null = null;

export function getPb(): PocketBase {
  if (!pb) {
    pb = new PocketBase(config.pb.url);
  }
  return pb;
}

export async function authenticatePb(): Promise<void> {
  const client = getPb();
  try {
    await client.admins.authWithPassword(config.pb.adminEmail, config.pb.adminPassword);
    logger.info('PocketBase admin authenticated');
  } catch (err) {
    logger.error('PocketBase admin auth failed', err);
    throw err;
  }
}

export async function ensureCollections(): Promise<void> {
  const client = getPb();

  const collections = [
    {
      name: 'alerts',
      type: 'base',
      schema: [
        { name: 'userId', type: 'text', required: true },
        { name: 'level', type: 'text', required: true },
        { name: 'type', type: 'text', required: false },
        { name: 'rainfall', type: 'number', required: false },
        { name: 'floodZone', type: 'text', required: false },
        { name: 'riverDischarge', type: 'number', required: false },
        { name: 'evacuateWithin', type: 'number', required: false },
        { name: 'reasons', type: 'json', required: false },
        { name: 'checklist', type: 'json', required: false },
        { name: 'issuedAt', type: 'text', required: false },
        { name: 'reEvalAt', type: 'text', required: false },
        { name: 'resolved', type: 'bool', required: false },
      ],
    },
    {
      name: 'conditions_cache',
      type: 'base',
      schema: [
        { name: 'key', type: 'text', required: true },
        { name: 'value', type: 'json', required: true },
        { name: 'fetchedAt', type: 'text', required: true },
        { name: 'expiresAt', type: 'number', required: true },
      ],
    },
    {
      name: 'gov_households',
      type: 'base',
      schema: [
        { name: 'userId', type: 'text', required: true },
        { name: 'rank', type: 'number', required: false },
        { name: 'inasafeScore', type: 'number', required: false },
        { name: 'tier', type: 'text', required: false },
        { name: 'riskFactors', type: 'json', required: false },
        { name: 'assignedTeam', type: 'text', required: false },
        { name: 'status', type: 'text', required: false },
      ],
    },
    {
      name: 'dispatch_log',
      type: 'base',
      schema: [
        { name: 'householdId', type: 'text', required: true },
        { name: 'teamId', type: 'text', required: false },
        { name: 'officerId', type: 'text', required: false },
        { name: 'action', type: 'text', required: false },
      ],
    },
    {
      name: 'chat_sessions',
      type: 'base',
      schema: [
        { name: 'userId', type: 'text', required: true },
        { name: 'sessionId', type: 'text', required: true },
        { name: 'locale', type: 'text', required: false },
        { name: 'history', type: 'json', required: false },
      ],
    },
  ];

  for (const col of collections) {
    try {
      await client.collections.getOne(col.name);
      logger.debug(`Collection '${col.name}' already exists`);
    } catch {
      try {
        await client.collections.create(col as Parameters<typeof client.collections.create>[0]);
        logger.info(`Created collection '${col.name}'`);
      } catch (createErr) {
        logger.warn(`Could not create collection '${col.name}'`, createErr);
      }
    }
  }
}

export async function isPbConnected(): Promise<boolean> {
  try {
    const client = getPb();
    await client.health.check();
    return true;
  } catch {
    return false;
  }
}
