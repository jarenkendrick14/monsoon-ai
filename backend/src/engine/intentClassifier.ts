import { ChatMessage } from '../types/index.js';
import { getCorpus, CorpusEntry } from './ragRetrieval.js';

export type UserIntent =
  | 'emergency_guidance'
  | 'live_conditions'
  | 'casual'
  | 'unsupported_emergency'
  | 'out_of_scope';

export interface ClassifiedIntent {
  intent: UserIntent;
  ragQuery: string;
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
    'what should i pack', 'what to pack', 'bring with me',
    'what to bring', 'bring during', 'bring when',
    'packed a bag', 'packing a bag', 'have packed',
    'before evacuating', 'before we evacuate',
    'what else should i bring', 'what else to bring',
  ]) || (hasIntentWord(message, ['pack', 'packing', 'packed', 'kit', 'checklist', 'bring', 'anything'])
    && hasIntentWord(message, ['evac', 'evacuate', 'evacuation', 'evacuating', 'emergency', 'disaster', 'typhoon', 'flood', 'bag']));
}

function isUnsupportedEmergencyQuestion(message: string): boolean {
  const lower = message.trim().toLowerCase();

  if (/^(help\s*[!?]*\s*){1,}$/i.test(lower) || lower === 'help me' || lower === 'please help') return true;

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
    'bruise', 'bruised', 'swollen', 'swelling', 'ache', 'aches',
    'medical', 'doctor', 'hospital',
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

  if ([
    'heat index', 'air quality', 'aqi', 'typhoon coming', 'typhoon approaching',
    'storm coming', 'storm approaching', 'is there a typhoon', 'is there a storm',
  ].some(phrase => lower.includes(phrase))) return true;

  const triviaStarters = ['who is', 'who invented', 'what is', 'when was', 'where is', 'why is'];
  if (triviaStarters.some(starter => lower.startsWith(starter))
    && !['current', 'today', 'now', 'status', 'check', 'temperature', 'outside', 'weather'].some(term => lower.includes(term))) {
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
    'should i evacuate', 'should we evacuate', 'do i need to evacuate',
    'do we need to evacuate', 'is it time to evacuate', 'time to evacuate',
    'need to evacuate', 'have to evacuate',
    'where should we go', 'where can we go', 'where do we go',
    'where could we go', 'where would we go', 'where will we go',
    'where we could go', 'where we can go', 'where we should go',
    'where to go', 'where to evacuate',
    'is it time to leave', 'is it safe to leave', 'time to leave',
    'can we leave', 'should we leave',
    'nearby shelter', 'find shelter', 'nearest shelter', 'evacuation shelter',
    'nearest evac', 'find evac', 'nearby evac',
    'is it hot', 'is it cold', 'is it warm', 'is it humid',
    'how hot', 'how cold', 'how warm', 'how humid',
    'what is the temperature', "what's the temperature",
    'temperature outside', 'temperature today', 'temperature right now',
  ].some(term => lower.includes(term))) {
    return true;
  }
  // "is it safe" alone is a status check; "is it safe to shower" is emergency_guidance
  if (/\bis it safe[?.]?\s*$/.test(lower)) return true;

  const hasEmergencyWord = hasIntentWord(message, [
    'blocked', 'collapsed', 'closed', 'landslide', 'full',
    'fell', 'fallen', 'injured', 'hurt', 'trapped', 'stuck', 'fire', 'burning',
  ]);
  if (hasEmergencyWord) return false;
  return hasIntentWord(message, ['alert', 'alerts', 'evac', 'evacuation', 'evacuate', 'evacuating']);
}

export function isCasualGreeting(message: string): boolean {
  const lower = message.trim().toLowerCase();
  return ['hi', 'hello', 'hey', 'how are you', 'how r u', 'sup', 'yo']
    .some(term => lower === term || lower.startsWith(`${term}?`));
}

// Broad signal check — catches anything plausibly disaster/emergency-related
// so the LLM gets a chance to answer. False positives are fine; the LLM returns
// status:insufficient for things the corpus doesn't cover.
function hasEmergencySignal(message: string): boolean {
  const lower = message.toLowerCase();
  return [
    // disaster events
    'flood', 'flooding', 'flooded', 'typhoon', 'storm', 'fire', 'earthquake',
    'landslide', 'mudslide', 'tsunami',
    // injuries / medical
    'hurt', 'injured', 'injury', 'pain', 'bleed', 'bleeding', 'wound', 'cut',
    'burn', 'broke', 'broken', 'fracture', 'sprain', 'unconscious', 'unresponsive',
    'choking', 'choke', 'drowning', 'drown', 'trapped', 'stuck',
    'sick', 'fever', 'dizzy', 'vomit', 'diarrhea', 'leptospirosis',
    // vulnerable people
    'baby', 'infant', 'pregnant', 'elderly', 'child', 'children',
    // safety / evacuation
    'safe', 'danger', 'dangerous', 'evacuate', 'evacuation', 'shelter',
    'rescue', 'missing', 'lost',
    // everyday disaster safety
    'shower', 'bath', 'generator', 'cook', 'cooking', 'boil', 'tap', 'smell',
    'electric', 'wire', 'gas', 'leak', 'charger', 'appliance',
    // first aid follow-ups
    'cold pack', 'ice pack', 'cold compress', 'first aid', 'bandage', 'tourniquet',
    // structural
    'roof', 'wall', 'collapsed', 'collapse',
    // distress
    'dying', 'die', 'emergency', 'help',
    // aftermath
    'clean', 'cleanup', 'after the flood', 'after the typhoon',
  ].some(w => lower.includes(w));
}

function isVagueFollowUp(message: string): boolean {
  const lower = message.trim().toLowerCase();
  if (tokenizeIntent(lower).length > 9) return false;
  return [
    'where', 'and then', 'then what', 'what about', 'how about',
    'can we go', 'could we go', 'should we go', 'what if',
    'is that', 'is there', 'after that', 'what next',
    // confirmation follow-ups
    'u sure', 'you sure', 'are you sure', 'r u sure',
    'really', 'for real', 'seriously', 'you certain',
  ].some(p => lower.includes(p));
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

function inferHistoryIntent(history: ChatMessage[]): UserIntent | null {
  const recent = history
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => m.content)
    .reverse();
  for (const msg of recent) {
    if (isLiveConditionsQuestion(msg) || isStatusQuestion(msg)) return 'live_conditions';
    if (hasEmergencySignal(msg)) return 'emergency_guidance';
  }
  return null;
}

export function classifyChatIntent(message: string, history: ChatMessage[]): ClassifiedIntent {
  const ragQuery = buildRagQuery(message, history);

  if (isCasualGreeting(message)) return { intent: 'casual', ragQuery };
  if (isVirtualScenario(message)) return { intent: 'out_of_scope', ragQuery };
  if (isEvacuationPrepQuestion(message)) return { intent: 'emergency_guidance', ragQuery };
  if (isLiveConditionsQuestion(message) || isStatusQuestion(message)) return { intent: 'live_conditions', ragQuery };
  if (isUnsupportedEmergencyQuestion(message)) return { intent: 'unsupported_emergency', ragQuery };

  // History-aware: check combined context before falling through
  if (history.length > 0 && isVagueFollowUp(message)) {
    const combined = buildRecentUserContext(message, history);
    if (combined !== message && (isLiveConditionsQuestion(combined) || isStatusQuestion(combined))) {
      return { intent: 'live_conditions', ragQuery };
    }
  }

  if (hasEmergencySignal(message)) return { intent: 'emergency_guidance', ragQuery };

  // Intent carryover for vague follow-ups with no emergency signal
  if (history.length > 0 && isVagueFollowUp(message)) {
    const inherited = inferHistoryIntent(history);
    if (inherited === 'live_conditions') return { intent: 'live_conditions', ragQuery };
    if (inherited && hasIntentWord(message, ['where'])) return { intent: 'live_conditions', ragQuery };
  }

  return { intent: 'out_of_scope', ragQuery };
}

export function classifySmsIntent(message: string): ClassifiedIntent {
  if (isCasualGreeting(message)) return { intent: 'casual', ragQuery: message };
  if (isVirtualScenario(message)) return { intent: 'out_of_scope', ragQuery: message };
  if (isLiveConditionsQuestion(message) || isStatusQuestion(message)) return { intent: 'live_conditions', ragQuery: message };
  if (isUnsupportedEmergencyQuestion(message)) return { intent: 'unsupported_emergency', ragQuery: message };
  if (hasEmergencySignal(message)) return { intent: 'emergency_guidance', ragQuery: message };
  return { intent: 'out_of_scope', ragQuery: message };
}

// Exported for use in ragRetrieval consumers that need the full corpus
export function getFullCorpus(): CorpusEntry[] {
  return getCorpus();
}
