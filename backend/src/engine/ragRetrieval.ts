import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CorpusEntry {
  id: string;
  topic: string;
  keywords: string[];
  text: string;
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
  return RAG_TRIGGERS.some(kw => lower.includes(kw));
}

export function retrievePassage(message: string): CorpusEntry | null {
  const lower = message.toLowerCase();
  const tokens = lower.split(/\W+/).filter(Boolean);

  let best: CorpusEntry | null = null;
  let bestScore = 0;

  for (const entry of getCorpus()) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) score += 2;
    }
    for (const token of tokens) {
      if (entry.keywords.includes(token)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return bestScore >= 2 ? best : null;
}
