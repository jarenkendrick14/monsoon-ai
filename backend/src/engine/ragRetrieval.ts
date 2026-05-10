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
  'drink', 'shelter', 'trapped', 'stuck', 'help', 'drowning', 'diarrhea',
  'vomiting', 'cut', 'smoke', 'haze', 'asthma', 'evacuate', 'evacuation',
  'collapse', 'debris', 'heat', 'heatstroke', 'elderly', 'disabled',
];

export function needsRag(message: string): boolean {
  const lower = message.toLowerCase();
  return RAG_TRIGGERS.some(kw => lower.includes(kw))
    || getCorpus().some(entry => entry.keywords.some(kw => lower.includes(kw)));
}

function scoreCorpus(message: string): ScoredCorpusEntry[] {
  const lower = message.toLowerCase();
  const tokens = lower.split(/\W+/).filter(Boolean);
  const tokenSet = new Set(tokens);

  return getCorpus().map(entry => {
    let score = 0;
    for (const kw of entry.keywords) {
      const keywordTokens = kw.split(/\W+/).filter(Boolean);
      if (lower.includes(kw)) score += 2 + Math.min(keywordTokens.length, 3);
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
