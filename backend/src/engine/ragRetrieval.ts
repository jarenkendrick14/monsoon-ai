import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface CorpusEntry {
  id: string;
  topic: string;
  keywords: string[];
  text: string;
}

interface ScoredCorpusEntry {
  entry: CorpusEntry;
  score: number;
}

let corpus: CorpusEntry[] | null = null;

function getCorpus(): CorpusEntry[] {
  if (!corpus) {
    const path = join(__dirname, '../../data/rag-corpus.json');
    corpus = JSON.parse(readFileSync(path, 'utf-8')) as CorpusEntry[];
  }
  return corpus;
}

const RAG_TRIGGERS = [
  'hurt', 'injured', 'injury', 'sick', 'fever', 'wound', 'bleed', 'bleeding',
  'burn', 'burning', 'pain', 'baby', 'infant', 'pregnant', 'food', 'water',
  'drink', 'shelter', 'trapped', 'stuck', 'drowning', 'diarrhea',
  'vomiting', 'cut', 'smoke', 'haze', 'asthma', 'evacuate', 'evacuation',
  'collapse', 'debris', 'heat', 'heatstroke', 'elderly', 'disabled',
  'broke', 'broken', 'fracture', 'sprain', 'dislocation',
  // flood/storm variants
  'flood', 'flooding', 'flooded', 'floodwater', 'submerged', 'underwater',
  // structural/typhoon damage
  'roof', 'wall', 'blown', 'collapsed', 'collapsing', 'destroyed', 'damaged',
  'typhoon', 'storm', 'landslide', 'mudslide', 'swept',
  // vehicle/crash
  'crash', 'accident', 'crashed', 'hit',
  // electrical / gas
  'electric', 'electrocuted', 'wire', 'wires', 'sparks', 'gas', 'leak', 'leaking',
  // distress / unresponsive
  'unresponsive', 'unconscious', 'moving', 'responding', 'breathing',
  'dying', 'die', 'drown', 'drowning',
  // missing persons in disaster
  'missing', 'lost', 'family', 'child', 'children',
];

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(Boolean);
}

function stem(word: string): string {
  if (word.length > 6 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith('tion')) return word.slice(0, -4);
  if (word.length > 5 && word.endsWith('tion')) return word.slice(0, -4);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  if (word.length > 3 && word.endsWith('e')) return word.slice(0, -1);
  return word;
}

function keywordMatches(keyword: string, lower: string, tokenSet: Set<string>): boolean {
  const keywordTokens = tokenize(keyword);
  if (keywordTokens.length === 0) return false;
  if (keywordTokens.length === 1) {
    const kw = keywordTokens[0];
    if (tokenSet.has(kw)) return true;
    if (kw.length >= 4) {
      const stemKw = stem(kw);
      for (const t of tokenSet) {
        if (t.length < 4) continue;
        const stemT = stem(t);
        if (stemT === stemKw || stemT.startsWith(stemKw) || stemKw.startsWith(stemT)) return true;
      }
    }
    return false;
  }
  return lower.includes(keyword.toLowerCase()) || keywordTokens.every(token => tokenSet.has(token));
}

export function needsRag(message: string): boolean {
  const lower = message.toLowerCase();
  const tokenSet = new Set(tokenize(message));
  return RAG_TRIGGERS.some(kw => tokenSet.has(kw))
    || getCorpus().some(entry => entry.keywords.some(kw => keywordMatches(kw, lower, tokenSet)));
}

function scoreCorpus(message: string): ScoredCorpusEntry[] {
  const lower = message.toLowerCase();
  const tokens = tokenize(message);
  const tokenSet = new Set(tokens);

  return getCorpus().map(entry => {
    let score = 0;
    for (const kw of entry.keywords) {
      const keywordTokens = tokenize(kw);
      if (keywordMatches(kw, lower, tokenSet)) score += 2 + Math.min(keywordTokens.length, 3);
      if (keywordTokens.length > 1 && keywordTokens.every(token => tokenSet.has(token))) {
        score += keywordTokens.length;
      }
    }
    for (const token of tokens) {
      if (entry.keywords.includes(token)) score += 1;
    }
    return { entry, score };
  }).filter(item => item.score >= 2)
    .sort((a, b) => b.score - a.score);
}

export function retrievePassages(message: string, limit = 4): CorpusEntry[] {
  return scoreCorpus(message).slice(0, limit).map(item => item.entry);
}

export function retrievePassage(message: string): CorpusEntry | null {
  return retrievePassages(message, 1)[0] ?? null;
}
