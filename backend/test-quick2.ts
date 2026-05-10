import { classifyChatIntent } from './src/engine/intentClassifier.js';
const tests = [
  'so its 8AM and we are looking to evacuate. me and my son have packed a bag of peppermint a salt shaker and some watermelon. anything else?',
  'we have packed a bag already',
  'what should i bring when evacuating',
  'anything else',
  'go bag checklist',
  'what to pack for typhoon',
];
for (const t of tests) console.log(classifyChatIntent(t, []).intent.padEnd(25), JSON.stringify(t.slice(0, 60)));
