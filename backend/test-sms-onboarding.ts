import { handleSmsOnboarding, resetSmsOnboardingMemoryForTest } from './src/engine/smsOnboarding.js';

type Store = {
  users: any[];
  sessions: any[];
  onboardingStates: any[];
};

function makePb(store: Store, options: { breakOnboardingState?: boolean } = {}) {
  const collectionItems = (name: string) => {
    if (name === 'sms_onboarding_state') return store.onboardingStates;
    if (name === 'sms_sessions') return store.sessions;
    if (name === 'users') return store.users;
    return [];
  };

  return {
    collection: (name: string) => {
      if (options.breakOnboardingState && name === 'sms_onboarding_state') {
        return {
          getList: async () => { throw new Error('sms_onboarding_state unavailable'); },
          create: async () => { throw new Error('sms_onboarding_state unavailable'); },
          update: async () => { throw new Error('sms_onboarding_state unavailable'); },
        };
      }

      return {
        getList: async () => ({
          items: collectionItems(name).slice().reverse(),
        }),
        create: async (data: any) => {
          const item = {
            id: `${name}:${Math.random().toString(36).slice(2)}`,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            ...data,
          };
          collectionItems(name).push(item);
          return item;
        },
        update: async (id: string, patch: any) => {
          const item = collectionItems(name).find((x: any) => x.id === id);
          if (!item) throw new Error(`missing ${name} ${id}`);
          Object.assign(item, patch, { updated: new Date().toISOString() });
          return item;
        },
      };
    },
  };
}

async function runFlow(label: string, mobile: string, options: { breakOnboardingState?: boolean } = {}) {
  const store: Store = { users: [], sessions: [], onboardingStates: [] };
  const pb: any = makePb(store, options);
  let user: any = null;
  const messages = ['JOIN', '1 English', '225 San Nicolas 1st Lubao, Pampanga', '4', 'NONE', '1', '0'];

  for (const message of messages) {
    resetSmsOnboardingMemoryForTest(mobile);
    const result = await handleSmsOnboarding(pb, mobile, message, user);
    user = result.user ?? user;
    console.log(`${label}: ${message} => ${result.reply}`);
  }

  if (!store.users[0]) throw new Error(`${label}: expected SMS user to be created`);
  if (store.users[0].locale !== 'en') throw new Error(`${label}: expected locale en, got ${store.users[0].locale}`);
  if (store.users[0].address !== '225 San Nicolas 1st Lubao, Pampanga') {
    throw new Error(`${label}: unexpected address ${store.users[0].address}`);
  }
  if (options.breakOnboardingState && store.sessions.length === 0) {
    throw new Error(`${label}: expected fallback sms_sessions state to be used`);
  }
}

async function runMixedStatePrefersNewest() {
  const mobile = '+639771234569';
  const store: Store = {
    users: [],
    onboardingStates: [{
      id: 'sms_onboarding_state:old',
      mobile,
      state: 'language',
      partialProfile: {},
      history: [],
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:00:00.000Z',
      lastMessageAt: '2026-01-01T00:00:00.000Z',
    }],
    sessions: [{
      id: 'sms_sessions:new',
      mobile,
      state: 'address',
      locale: 'en',
      partialProfile: {},
      history: [],
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:01:00.000Z',
      lastMessageAt: '2026-01-01T00:01:00.000Z',
    }],
  };
  const pb: any = makePb(store);

  resetSmsOnboardingMemoryForTest(mobile);
  const result = await handleSmsOnboarding(pb, mobile, '225 San Nicolas 1st Lubao, Pampanga', null);

  console.log(`mixed-state: address => ${result.reply}`);
  if (result.reply !== '[MonsoonAI] How many people live with you? Reply a number, like 4.') {
    throw new Error(`mixed-state: expected address to continue, got ${result.reply}`);
  }
  if (store.sessions[0].state !== 'household_size') {
    throw new Error(`mixed-state: expected legacy session to advance, got ${store.sessions[0].state}`);
  }
}

await runFlow('primary-state', '+639771234567');
await runFlow('legacy-fallback', '+639771234568', { breakOnboardingState: true });
await runMixedStatePrefersNewest();

console.log('SMS onboarding tests passed');
