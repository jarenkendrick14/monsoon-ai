import { classifyChatIntent } from './src/engine/intentClassifier.js';
const tests = [
  'do you know where we could go',
  'i applied a cold pack and it still hurts',
  'how long should i keep the cold pack on',
  'what about nearby shelters',
];
for (const t of tests) console.log(classifyChatIntent(t, []).intent.padEnd(25), JSON.stringify(t));
