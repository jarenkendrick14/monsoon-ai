import { classifyChatIntent } from './src/engine/intentClassifier.js';
import type { ChatMessage } from './src/types/index.js';

const plain: string[] = [
  'is it hot', 'u sure', 'are you sure', 'is it raining',
  'typhoon signal', 'is my area flooded', 'what is the temperature outside',
  'how warm is it today', 'is it humid', 'any alerts',
  'check weather', 'is there a flood', 'is it safe',
  '2 people in our house', 'my roof is leaking',
];

const weatherHistory: ChatMessage[] = [
  { role: 'user', content: 'weather update' },
  { role: 'assistant', content: 'No active alerts. Heat index 32C.' },
];

console.log('--- no history ---');
for (const t of plain) {
  console.log(classifyChatIntent(t, []).intent.padEnd(25), JSON.stringify(t));
}

console.log('\n--- with weather history ---');
for (const t of ['u sure', 'are you sure', 'really?', 'you sure about that']) {
  console.log(classifyChatIntent(t, weatherHistory).intent.padEnd(25), JSON.stringify(t));
}
