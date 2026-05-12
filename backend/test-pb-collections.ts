import { ensureCollectionsForClient } from './src/pb.js';

type CollectionRecord = {
  id: string;
  name: string;
  type: string;
  fields?: any[];
  schema?: any[];
};

const store = new Map<string, CollectionRecord>();

function put(collection: CollectionRecord): void {
  store.set(collection.name, collection);
}

function fieldNames(collectionName: string): string[] {
  const collection = store.get(collectionName);
  const fields = collection?.fields ?? collection?.schema ?? [];
  return fields.map(field => field.name);
}

function assertHasFields(collectionName: string, names: string[]): void {
  const existing = new Set(fieldNames(collectionName));
  const missing = names.filter(name => !existing.has(name));
  if (missing.length > 0) {
    throw new Error(`${collectionName} missing fields: ${missing.join(', ')}`);
  }
}

put({ id: 'users', name: 'users', type: 'auth', fields: [] });
put({ id: 'sms_onboarding_state', name: 'sms_onboarding_state', type: 'base', fields: [] });
put({ id: 'sms_sessions', name: 'sms_sessions', type: 'base', schema: [{ name: 'mobile', type: 'text', required: true }] });

const pb: any = {
  collections: {
    getOne: async (nameOrId: string) => {
      const byName = store.get(nameOrId);
      if (byName) return byName;
      const byId = Array.from(store.values()).find(collection => collection.id === nameOrId);
      if (byId) return byId;
      throw new Error(`missing collection ${nameOrId}`);
    },
    create: async (payload: any) => {
      if (!payload.fields || !payload.schema) {
        throw new Error(`create ${payload.name} missing fields/schema aliases`);
      }
      const collection = { id: payload.name, ...payload };
      store.set(payload.name, collection);
      return collection;
    },
    update: async (idOrName: string, payload: any) => {
      if (!payload.fields || !payload.schema) {
        throw new Error(`update ${idOrName} missing fields/schema aliases`);
      }
      const current = Array.from(store.values()).find(collection => collection.id === idOrName || collection.name === idOrName);
      if (!current) throw new Error(`missing collection ${idOrName}`);
      Object.assign(current, payload);
      return current;
    },
  },
};

await ensureCollectionsForClient(pb);

assertHasFields('sms_onboarding_state', ['mobile', 'state', 'locale', 'partialProfile', 'history', 'lastMessageAt']);
assertHasFields('sms_sessions', ['mobile', 'state', 'locale', 'partialProfile', 'history', 'lastMessageAt']);
assertHasFields('sms_situations', ['mobile', 'situation', 'history', 'lastMessageAt']);

if (fieldNames('sms_sessions').filter(name => name === 'mobile').length !== 1) {
  throw new Error('sms_sessions duplicated existing mobile field');
}

console.log('PocketBase collection migration tests passed');
