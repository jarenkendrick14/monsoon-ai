import PocketBase, { ClientResponseError } from 'pocketbase';
import { config } from './config.js';
import { logger } from './utils/logger.js';

type CollectionField = {
  name: string;
  type: string;
  required?: boolean;
  options?: Record<string, unknown>;
};

type CollectionSpec = {
  name: string;
  type: string;
  schema: CollectionField[];
};

let pb: PocketBase | null = null;

export function getPb(): PocketBase {
  if (!pb) {
    pb = new PocketBase(config.pb.url);
  }
  return pb;
}

export async function authenticatePb(): Promise<void> {
  const client = getPb();
  if (!config.pb.adminEmail || !config.pb.adminPassword) {
    throw new Error('Missing PB_ADMIN_EMAIL or PB_ADMIN_PASSWORD. Set them on the backend service.');
  }

  try {
    try {
      // PocketBase v0.23+ uses the _superusers auth collection.
      await client.collection('_superusers').authWithPassword(config.pb.adminEmail, config.pb.adminPassword);
      logger.info('PocketBase superuser authenticated');
      return;
    } catch (superuserErr) {
      if (!(superuserErr instanceof ClientResponseError) || superuserErr.status !== 404) {
        throw superuserErr;
      }

      // Older PocketBase versions use /api/admins/auth-with-password.
      await client.admins.authWithPassword(config.pb.adminEmail, config.pb.adminPassword);
      logger.info('PocketBase admin authenticated');
    }
  } catch (err) {
    logger.error(
      'PocketBase admin auth failed. Check that backend PB_URL points to the PocketBase service URL and PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD match the existing PocketBase superuser. If PB has a persistent volume, changing env vars will not reset the saved admin password.',
      err
    );
    throw err;
  }
}

// Re-authenticate if the admin token is expired or missing
export async function ensurePbAuth(): Promise<void> {
  const client = getPb();
  if (!client.authStore.isValid) {
    await authenticatePb();
  }
}

// Wraps any PocketBase call: if it gets a 401, re-auths once and retries.
// This handles server-side token invalidation that authStore.isValid misses.
export async function pbCall<T>(fn: (pb: PocketBase) => Promise<T>): Promise<T> {
  const client = getPb();
  try {
    return await fn(client);
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 401) {
      logger.warn('PocketBase 401 — re-authenticating');
      await authenticatePb();
      return fn(client);
    }
    throw err;
  }
}

function withPocketBaseFieldAliases<T extends CollectionSpec>(collection: T, fields = collection.schema): T & { fields: CollectionField[] } {
  return {
    ...collection,
    schema: fields,
    fields,
  };
}

function collectionFields(collection: unknown): CollectionField[] {
  const record = collection && typeof collection === 'object' ? collection as Record<string, unknown> : {};
  const fields = record['fields'] ?? record['schema'] ?? [];
  return Array.isArray(fields) ? fields as CollectionField[] : [];
}

function mergeCollectionFields(existingFields: CollectionField[], requiredFields: CollectionField[]): CollectionField[] {
  const existingNames = new Set(existingFields.map(field => field.name));
  const missingFields = requiredFields.filter(field => !existingNames.has(field.name));
  return [...existingFields, ...missingFields];
}

function missingFieldNames(existingFields: CollectionField[], requiredFields: CollectionField[]): string[] {
  const existingNames = new Set(existingFields.map(field => field.name));
  return requiredFields.filter(field => !existingNames.has(field.name)).map(field => field.name);
}

const smsSessionFields: CollectionField[] = [
  { name: 'mobile', type: 'text', required: true },
  { name: 'userId', type: 'text', required: false },
  { name: 'state', type: 'text', required: true },
  { name: 'locale', type: 'text', required: false },
  { name: 'partialProfile', type: 'json', required: false },
  { name: 'history', type: 'json', required: false },
  { name: 'lastMessageAt', type: 'text', required: false },
];

const smsSituationFields: CollectionField[] = [
  { name: 'mobile', type: 'text', required: true },
  { name: 'userId', type: 'text', required: false },
  { name: 'situation', type: 'json', required: false },
  { name: 'history', type: 'json', required: false },
  { name: 'lastMessageAt', type: 'text', required: false },
];

const collectionSpecs: CollectionSpec[] = [
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
  { name: 'sms_sessions', type: 'base', schema: smsSessionFields },
  { name: 'sms_onboarding_state', type: 'base', schema: smsSessionFields },
  { name: 'sms_situations', type: 'base', schema: smsSituationFields },
  {
    name: 'hazard_reports',
    type: 'base',
    schema: [
      { name: 'userId', type: 'text', required: true },
      {
        name: 'photo',
        type: 'file',
        required: false,
        options: {
          maxSelect: 1,
          maxSize: 10 * 1024 * 1024,
          mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
        },
      },
      { name: 'hazards', type: 'json', required: false },
      { name: 'confidence', type: 'text', required: false },
      { name: 'needsHumanReview', type: 'bool', required: false },
      { name: 'note', type: 'text', required: false },
      { name: 'lat', type: 'number', required: false },
      { name: 'lng', type: 'number', required: false },
    ],
  },
];

const criticalSmsCollections = collectionSpecs.filter(spec => (
  spec.name === 'sms_sessions'
  || spec.name === 'sms_onboarding_state'
  || spec.name === 'sms_situations'
));

export async function ensureCollections(): Promise<void> {
  await ensureCollectionsForClient(getPb());
}

export async function ensureCollectionsForClient(client: PocketBase): Promise<void> {
  try {
    await ensureUserFields(client);
  } catch (err) {
    logger.warn('Could not ensure users collection fields; profile updates may fail until schema is repaired', err);
  }

  for (const col of collectionSpecs) {
    try {
      const existing = await client.collections.getOne(col.name) as unknown as Record<string, unknown>;
      const existingFields = collectionFields(existing);
      const fields = mergeCollectionFields(existingFields, col.schema);
      const missing = missingFieldNames(existingFields, col.schema);
      if (missing.length > 0) {
        await client.collections.update(String(existing['id'] ?? col.name), withPocketBaseFieldAliases(col, fields) as Parameters<typeof client.collections.update>[1]);
        logger.info(`Added ${col.name} fields: ${missing.join(', ')}`);
      } else {
        logger.debug(`Collection '${col.name}' schema unchanged`);
      }
    } catch {
      try {
        await client.collections.create(withPocketBaseFieldAliases(col) as Parameters<typeof client.collections.create>[0]);
        logger.info(`Created collection '${col.name}'`);
      } catch (createErr: unknown) {
        const msg = (createErr as Error)?.message?.split('\n')[0] ?? String(createErr);
        logger.warn(`Could not create collection '${col.name}': ${msg}`);
      }
    }
  }

  await verifyCriticalSmsCollections(client);
}

async function verifyCriticalSmsCollections(client: PocketBase): Promise<void> {
  const failures: string[] = [];
  for (const col of criticalSmsCollections) {
    try {
      const existing = await client.collections.getOne(col.name);
      const missing = missingFieldNames(collectionFields(existing), col.schema);
      if (missing.length > 0) failures.push(`${col.name}: ${missing.join(', ')}`);
    } catch (err) {
      failures.push(`${col.name}: collection missing`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`PocketBase SMS state schema is incomplete: ${failures.join('; ')}`);
  }
}

async function ensureUserFields(client: PocketBase): Promise<void> {
  const usersCollection = await client.collections.getOne('users') as unknown as Record<string, unknown>;
  const existingFields = collectionFields(usersCollection);
  const requiredFields: CollectionField[] = [
    { name: 'mobile', type: 'text' },
    { name: 'role', type: 'text' },
    { name: 'locale', type: 'text' },
    { name: 'lat', type: 'number' },
    { name: 'lng', type: 'number' },
    { name: 'address', type: 'text' },
    { name: 'homeType', type: 'text' },
    { name: 'floor', type: 'number' },
    { name: 'householdSize', type: 'number' },
    { name: 'hasPWD', type: 'bool' },
    { name: 'hasElderly', type: 'bool' },
    { name: 'hasInfant', type: 'bool' },
    { name: 'hasPregnant', type: 'bool' },
    { name: 'riskScore', type: 'number' },
    { name: 'riskTier', type: 'text' },
    { name: 'isOnRescueList', type: 'bool' },
    { name: 'alertOptIn', type: 'bool' },
    { name: 'smsOptIn', type: 'bool' },
  ];
  const missing = missingFieldNames(existingFields, requiredFields);
  const fields = mergeCollectionFields(existingFields, requiredFields);

  if (missing.length === 0) {
    logger.debug('Users collection fields already present');
    return;
  }

  await client.collections.update('users', {
    fields,
    schema: fields,
  } as Parameters<typeof client.collections.update>[1]);
  logger.info(`Added users fields: ${missing.join(', ')}`);
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
