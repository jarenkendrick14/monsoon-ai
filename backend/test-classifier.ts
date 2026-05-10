import { classifyChatIntent } from './src/engine/intentClassifier.js';
import type { ChatMessage } from './src/types/index.js';

type E = 'emergency_guidance'|'live_conditions'|'casual'|'unsupported_emergency'|'out_of_scope';

const cases: [string, E][] = [
  // everyday safety questions during disasters
  ['can i shower', 'emergency_guidance'],
  ['is it safe to shower', 'emergency_guidance'],
  ['can i use my generator', 'emergency_guidance'],
  ['can i cook', 'emergency_guidance'],
  ['can i boil water', 'emergency_guidance'],
  ['can i go on the roof', 'emergency_guidance'],
  ['is the tap water safe to drink', 'emergency_guidance'],
  ['can i wade through the flood', 'emergency_guidance'],
  ['can i drive through the flood', 'emergency_guidance'],
  ['can i use my phone charger', 'emergency_guidance'],
  // post-disaster concerns
  ['when can we go back home', 'live_conditions'],
  ['is the food still safe to eat', 'emergency_guidance'],
  ['how do i clean after the flood', 'emergency_guidance'],
  ['the smell is bad after the flood', 'emergency_guidance'],
  // contextual follow-ups (no history) — vague without context → acceptable
  ['what should we do', 'unsupported_emergency'],
  ['how bad is it', 'out_of_scope'],
  ['is it getting worse', 'out_of_scope'],
];

const evacHistory: ChatMessage[] = [
  { role: 'user', content: 'should we evacuate' },
  { role: 'assistant', content: 'No active alert at your location right now.' },
];

const floodHistory: ChatMessage[] = [
  { role: 'user', content: 'our house is flooding' },
  { role: 'assistant', content: 'Do not enter floodwater. Call 911 immediately.' },
];

const historyCases: [string, ChatMessage[], E][] = [
  // vague follow-ups after live_conditions exchange
  ['do you know where we could go', evacHistory, 'live_conditions'],
  ['where should we go', evacHistory, 'live_conditions'],
  ['what about nearby shelters', evacHistory, 'live_conditions'],
  ['and then where', evacHistory, 'live_conditions'],
  // "where?" after disaster context → live_conditions (has evac center info)
  ['where do we go after', floodHistory, 'live_conditions'],
  // casual should still be casual even with history
  ['u ok', evacHistory, 'out_of_scope'],
];

let pass = 0, fail = 0;

for (const [msg, expected] of cases) {
  const r = classifyChatIntent(msg, []);
  if (r.intent === expected) pass++;
  else { fail++; console.log(`[${r.intent.padEnd(22)}] expected [${expected.padEnd(22)}] → "${msg}"`); }
}

console.log('\n--- history-aware cases ---');
for (const [msg, history, expected] of historyCases) {
  const r = classifyChatIntent(msg, history);
  if (r.intent === expected) pass++;
  else { fail++; console.log(`[${r.intent.padEnd(22)}] expected [${expected.padEnd(22)}] → "${msg}" (with history)`); }
}

const total = cases.length + historyCases.length;
console.log(`\n${pass}/${total} passed, ${fail} failed`);
