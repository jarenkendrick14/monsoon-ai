import { handleSmsOnboarding } from './src/engine/smsOnboarding.js';

const users: any[] = [];
const sessions: any[] = [];
const onboardingStates: any[] = [];

const pb: any = {
  collection: (name: string) => ({
    getList: async () => ({
      items: name === 'sms_onboarding_state'
        ? onboardingStates.slice().reverse()
        : name === 'sms_sessions'
          ? sessions.slice().reverse()
          : [],
    }),
    create: async (data: any) => {
      const item = { id: `${name}:${Math.random().toString(36).slice(2)}`, ...data };
      if (name === 'sms_sessions') sessions.push(item);
      if (name === 'sms_onboarding_state') onboardingStates.push(item);
      if (name === 'users') users.push(item);
      return item;
    },
    update: async (id: string, patch: any) => {
      const arr = name === 'sms_onboarding_state' ? onboardingStates : name === 'sms_sessions' ? sessions : users;
      const item = arr.find((x: any) => x.id === id);
      if (!item) throw new Error(`missing ${name} ${id}`);
      Object.assign(item, patch);
      return item;
    },
  }),
};

let user: any = null;
const mobile = '+639771234567';
const messages = ['JOIN', '1 English', '225 San Nicolas 1st Lubao, Pampanga', '4', 'NONE', '1', '0'];

for (const message of messages) {
  const result = await handleSmsOnboarding(pb, mobile, message, user);
  user = result.user ?? user;
  console.log(`${message} => ${result.reply}`);
}

if (!users[0]) throw new Error('Expected SMS user to be created');
if (users[0].locale !== 'en') throw new Error(`Expected locale en, got ${users[0].locale}`);
if (users[0].address !== '225 San Nicolas 1st Lubao, Pampanga') throw new Error(`Unexpected address ${users[0].address}`);

console.log('SMS onboarding test passed');
