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

export function getCorpus(): CorpusEntry[] {
  if (!corpus) {
    const path = join(__dirname, '../../data/rag-corpus.json');
    corpus = JSON.parse(readFileSync(path, 'utf-8')) as CorpusEntry[];
  }
  return corpus;
}

function normalizeQuery(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bblooding\b/g, 'bleeding')
    .replace(/\bbloody\b/g, 'bleeding')
    .replace(/\bbleeded\b/g, 'bleeding')
    .replace(/\bswollen\b/g, 'swelling')
    .replace(/\bhurts\b/g, 'pain')
    .replace(/\bhurt\b/g, 'pain')
    .replace(/\baching\b/g, 'pain')
    .replace(/\bache\b/g, 'pain')
    .replace(/\bpuking\b/g, 'vomiting')
    .replace(/\bpuke\b/g, 'vomiting')
    .replace(/\bthrowing up\b/g, 'vomiting');
}

function tokenize(text: string): string[] {
  return normalizeQuery(text).split(/\W+/).filter(Boolean);
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'do', 'does', 'for', 'from',
  'i', 'im', "i'm", 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'our',
  'the', 'that', 'this', 'to', 'was', 'we', 'what', 'when', 'where', 'with',
  'you', 'your',
]);

function significantTokens(text: string): string[] {
  return tokenize(text).filter(token => token.length >= 3 && !STOPWORDS.has(token));
}

function keywordMatches(keyword: string, lower: string, tokenSet: Set<string>): boolean {
  const keywordTokens = tokenize(keyword);
  if (keywordTokens.length === 0) return false;
  if (keywordTokens.length === 1) return tokenSet.has(keywordTokens[0]);
  return lower.includes(normalizeQuery(keyword)) || keywordTokens.every(token => tokenSet.has(token));
}

function scoreCorpus(message: string): ScoredCorpusEntry[] {
  const lower = normalizeQuery(message);
  const tokens = significantTokens(message);
  const tokenSet = new Set(tokens);

  return getCorpus()
    .map(entry => {
      let score = 0;
      const topicTokens = new Set(significantTokens(entry.topic));
      const textTokens = new Set(significantTokens(entry.text));

      for (const kw of entry.keywords) {
        const keywordTokens = tokenize(kw);
        if (keywordMatches(kw, lower, tokenSet)) score += 2 + Math.min(keywordTokens.length, 3);
        if (keywordTokens.length > 1 && keywordTokens.every(token => tokenSet.has(token))) {
          score += keywordTokens.length;
        }
      }
      for (const token of tokens) {
        if (entry.keywords.includes(token)) score += 1;
        if (topicTokens.has(token)) score += 2;
        if (textTokens.has(token)) score += 1;
      }
      return { entry, score };
    })
    .filter(item => item.score >= 2)
    .sort((a, b) => b.score - a.score);
}

export function retrievePassages(message: string, limit = 4): CorpusEntry[] {
  return scoreCorpus(message).slice(0, limit).map(item => item.entry);
}
