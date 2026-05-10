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

let corpus: CorpusEntry[] | null = null;

export function getCorpus(): CorpusEntry[] {
  if (!corpus) {
    const path = join(__dirname, '../../data/rag-corpus.json');
    corpus = JSON.parse(readFileSync(path, 'utf-8')) as CorpusEntry[];
  }
  return corpus;
}
