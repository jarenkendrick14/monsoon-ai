import { ChatMessage } from '../types/index.js';
import { CorpusEntry, retrievePassages, needsRag } from './ragRetrieval.js';

export type UserIntent =
  | 'emergency_guidance'
  | 'live_conditions'
  | 'casual'
  | 'unsupported_emergency'
  | 'out_of_scope';

export interface ClassifiedIntent {
  intent: UserIntent;
  ragQuery: string;
  passages: CorpusEntry[];
}

function tokenizeIntent(message: string): string[] {
  return message.toLowerCase().split(/\W+/).filter(Boolean);
}

function hasIntentWord(message: string, words: string[]): boolean {
  const tokens = new Set(tokenizeIntent(message));
  return words.some(word => tokens.has(word));
}

function hasIntentPhrase(message: string, phrases: string[]): boolean {
  const lower = message.toLowerCase();
  return phrases.some(phrase => lower.includes(phrase));
}

function isVirtualScenario(message: string): boolean {
  const virtualTerms = [
    'minecraft', 'growtopia', 'roblox', 'fortnite', 'valorant',
    'in-game', 'in game', 'video game', 'game server', 'virtual',
    'simulator', 'creative mode', 'survival mode', 'survival world', 'survival game',
  ];
  const scenarioTerms = [
    'flood', 'flooding', 'fire', 'earthquake', 'typhoon', 'storm',
    'crash', 'injured', 'hurt', 'bleeding', 'evacuate', 'evacuation',
  ];
  return hasIntentPhrase(message, virtualTerms)
    && (hasIntentPhrase(message, scenarioTerms) || !isLiveConditionsQuestion(message));
}

function isEvacuationPrepQuestion(message: string): boolean {
  return hasIntentPhrase(message, [
    'go bag', 'gobag', 'emergency kit', 'evacuation kit',
    'what should i pack', 'what to pack', 'bring with me', 'prepare for evacuation',
    'what to bring', 'bring during', 'bring when',
    'first aid tips', 'first aid before', 'tips before', 'what to do before',
    'what do we do before', 'what should we do before', 'before evacuating', 'before we evacuate',
  ]) || (hasIntentWord(message, ['pack', 'packing', 'kit', 'checklist', 'bring', 'tips', 'prepare'])
    && hasIntentWord(message, ['evac', 'evacuate', 'evacuation', 'evacuating', 'emergency', 'disaster', 'typhoon', 'flood']));
}

function isUnsupportedEmergencyQuestion(message: string): boolean {
  const lower = message.trim().toLowerCase();

  // repeated/stressed help cries
  if (/^(help\s*[!?]*\s*){1,}$/i.test(lower) || lower === 'help me' || lower === 'please help') return true;

  // existential distress
  if (hasIntentPhrase(message, [
    'going to die', 'gonna die', 'we will die', 'going to drown',
    'nobody is coming', 'nobody comes', 'no one is coming', 'no one comes',
    'cant find my family', "can't find my family", 'lost my family',
    'cant find my child', "can't find my child", 'missing child',
    'stopped moving', 'not moving', 'stopped breathing', 'not responding',
    'wont stop', "won't stop", 'water is rising', 'water keeps rising',
    'water is very high', 'water is getting high',
  ])) return true;

  const hasUnsupportedMedicalTerm = hasIntentWord(message, [
    'bruise', 'bruised', 'swollen', 'swelling', 'ache', 'aches', 'pain', 'hurts',
    'injury', 'injured', 'medical', 'doctor', 'hospital',
    'headache', 'dizzy', 'dizziness', 'nausea', 'nauseous',
    'balls', 'testicle', 'testicles', 'groin',
  ]);
  const asksForHelp = hasIntentPhrase(message, [
    'what do i do', 'what should i do', 'what do we do', 'what should we do',
    'need help', 'help me', 'what now', 'what do now',
  ]);
  return hasUnsupportedMedicalTerm || asksForHelp;
}

export function isLiveConditionsQuestion(message: string): boolean {
  const lower = message.toLowerCase();

  // explicit conditions phrases that are always live conditions
  if ([
    'heat index', 'air quality', 'aqi', 'typhoon coming', 'typhoon approaching',
    'storm coming', 'storm approaching', 'is there a typhoon', 'is there a storm',
  ].some(phrase => lower.includes(phrase))) return true;

  const triviaStarters = ['who is', 'who invented', 'what is', 'when was', 'where is', 'why is'];
  if (triviaStarters.some(starter => lower.startsWith(starter))
    && !['current', 'today', 'now', 'status', 'check'].some(term => lower.includes(term))) {
    return false;
  }
  const conditionTerms = [
    'weather', 'umbrella', 'rain', 'rainfall', 'forecast',
    'condition', 'conditions', 'temperature', 'outside',
  ];
  const liveIntentTerms = [
    'current', 'today', 'now', 'update', 'alert', 'alerts',
    'status', 'check', 'safe', 'conditions', 'forecast', 'rainfall', 'umbrella',
    'rain', 'raining', 'weather', 'temperature', 'hot', 'cold', 'humid',
  ];
  const emergencyTerms = [
    'hurt', 'injured', 'injury', 'wound', 'bleed', 'bleeding',
    'burn', 'cut', 'pain', 'sick', 'fever', 'heatstroke', 'heat stroke',
  ];
  return conditionTerms.some(term => lower.includes(term))
    && liveIntentTerms.some(term => lower.includes(term))
    && !emergencyTerms.some(term => lower.includes(term));
}

export function isStatusQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  const exact = lower.trim();
  if (['status', 'weather', 'conditions', 'alerts', 'alert', 'evac', 'evacuation', 'flood'].includes(exact)) {
    return true;
  }
  if (['status', 'check conditions', 'weather update',
    'when can we go back', 'when can i go back', 'safe to go back',
    'return home', 'go back home', 'when is it safe', 'is it safe outside',
    'is it safe to go back', 'is it safe to return',
  ].some(term => lower.includes(term))) {
    return true;
  }
  // don't treat "evacuation" as a status keyword if paired with emergency words
  const hasEmergencyWord = hasIntentWord(message, [
    'blocked', 'flooded', 'flooded', 'collapsed', 'closed', 'landslide', 'full',
    'fell', 'fallen', 'injured', 'hurt', 'trapped', 'stuck', 'fire', 'burning',
  ]);
  if (hasEmergencyWord) return false;
  return hasIntentWord(message, ['alert', 'alerts', 'evac', 'evacuation']);
}

export function isCasualGreeting(message: string): boolean {
  const lower = message.trim().toLowerCase();
  return ['hi', 'hello', 'hey', 'how are you', 'how r u', 'sup', 'yo']
    .some(term => lower === term || lower.startsWith(`${term}?`));
}

function buildRecentUserContext(message: string, history: ChatMessage[]): string {
  const recentUserMessages = history
    .filter(item => item.role === 'user')
    .slice(-3)
    .map(item => item.content.trim())
    .filter(Boolean);
  return [...recentUserMessages, message.trim()].filter(Boolean).join('\n');
}

function buildRagQuery(message: string, history: ChatMessage[]): string {
  return buildRecentUserContext(message, history) || message;
}

export function classifyChatIntent(message: string, history: ChatMessage[]): ClassifiedIntent {
  const ragQuery = buildRagQuery(message, history);
  const passages = retrievePassages(ragQuery, 4);

  if (isCasualGreeting(message)) return { intent: 'casual', ragQuery, passages: [] };
  if (isVirtualScenario(message)) return { intent: 'out_of_scope', ragQuery, passages: [] };
  if (isEvacuationPrepQuestion(message) && passages.length > 0) return { intent: 'emergency_guidance', ragQuery, passages };
  if (isLiveConditionsQuestion(message) || isStatusQuestion(message)) return { intent: 'live_conditions', ragQuery, passages: [] };
  if (passages.length > 0) return { intent: 'emergency_guidance', ragQuery, passages };
  if (isUnsupportedEmergencyQuestion(message) || needsRag(message)) return { intent: 'unsupported_emergency', ragQuery, passages: [] };
  return { intent: 'out_of_scope', ragQuery, passages: [] };
}

export function classifySmsIntent(message: string): ClassifiedIntent {
  const passages = retrievePassages(message, 2);

  if (isCasualGreeting(message)) return { intent: 'casual', ragQuery: message, passages: [] };
  if (isVirtualScenario(message)) return { intent: 'out_of_scope', ragQuery: message, passages: [] };
  if (isEvacuationPrepQuestion(message) && passages.length > 0) return { intent: 'emergency_guidance', ragQuery: message, passages };
  if (isLiveConditionsQuestion(message) || isStatusQuestion(message)) return { intent: 'live_conditions', ragQuery: message, passages: [] };
  if (passages.length > 0) return { intent: 'emergency_guidance', ragQuery: message, passages };
  if (isUnsupportedEmergencyQuestion(message) || needsRag(message)) return { intent: 'unsupported_emergency', ragQuery: message, passages: [] };
  return { intent: 'out_of_scope', ragQuery: message, passages: [] };
}
