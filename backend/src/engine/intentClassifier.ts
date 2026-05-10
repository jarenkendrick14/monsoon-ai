import { ChatMessage } from '../types/index.js';
import { CorpusEntry, retrievePassages } from './ragRetrieval.js';

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
    'simulator', 'creative mode', 'survival mode',
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
  ]) || (hasIntentWord(message, ['pack', 'packing', 'kit', 'checklist'])
    && hasIntentWord(message, ['evac', 'evacuate', 'evacuation', 'emergency']));
}

function isUnsupportedEmergencyQuestion(message: string): boolean {
  const hasUnsupportedMedicalTerm = hasIntentWord(message, [
    'bruise', 'bruised', 'swollen', 'swelling', 'ache', 'aches', 'pain', 'hurts',
    'hurt', 'injury', 'injured', 'medical', 'doctor', 'hospital',
    'balls', 'testicle', 'testicles', 'groin',
  ]);
  const asksForHelp = hasIntentPhrase(message, [
    'what do i do', 'what should i do', 'need help', 'help me',
  ]);
  const hasEmergencyContext = hasIntentWord(message, [
    'emergency', 'injured', 'injury', 'hurt', 'hurts', 'pain', 'sick', 'wounded',
  ]);
  return hasUnsupportedMedicalTerm || (asksForHelp && hasEmergencyContext);
}

export function isLiveConditionsQuestion(message: string): boolean {
  const lower = message.toLowerCase();
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
  return [
    'status', 'check conditions', 'weather update', 'alert', 'alerts',
    'is it safe', 'evac', 'evacuation',
  ].some(term => lower.includes(term));
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
  if (isUnsupportedEmergencyQuestion(message)) return { intent: 'unsupported_emergency', ragQuery, passages: [] };
  return { intent: 'out_of_scope', ragQuery, passages: [] };
}

export function classifySmsIntent(message: string): ClassifiedIntent {
  const passages = retrievePassages(message, 2);

  if (isCasualGreeting(message)) return { intent: 'casual', ragQuery: message, passages: [] };
  if (isVirtualScenario(message)) return { intent: 'out_of_scope', ragQuery: message, passages: [] };
  if (isEvacuationPrepQuestion(message) && passages.length > 0) return { intent: 'emergency_guidance', ragQuery: message, passages };
  if (isLiveConditionsQuestion(message) || isStatusQuestion(message)) return { intent: 'live_conditions', ragQuery: message, passages: [] };
  if (passages.length > 0) return { intent: 'emergency_guidance', ragQuery: message, passages };
  if (isUnsupportedEmergencyQuestion(message)) return { intent: 'unsupported_emergency', ragQuery: message, passages: [] };
  return { intent: 'out_of_scope', ragQuery: message, passages: [] };
}
