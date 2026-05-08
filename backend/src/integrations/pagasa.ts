import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface PagasaData {
  signal: number;
  bulletinTitle: string;
  issuedAt: string;
}

export async function fetchPagasa(): Promise<PagasaData> {
  try {
    const resp = await axios.get(config.pagasa.rssUrl, { timeout: 10000 });
    const parsed = await parseStringPromise(resp.data as string);

    const items = parsed?.rss?.channel?.[0]?.item ?? [];
    const firstItem = items[0] ?? {};
    const title: string = firstItem.title?.[0] ?? '';
    const pubDate: string = firstItem.pubDate?.[0] ?? new Date().toISOString();

    const signal = extractSignal(title);

    return { signal, bulletinTitle: title, issuedAt: pubDate };
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    const msg = (err as Error)?.message?.split('\n')[0] ?? String(err);
    logger.warn(`PAGASA RSS fetch failed (${status ?? 'no response'}): ${msg}`);
    return { signal: 0, bulletinTitle: 'No active bulletin', issuedAt: new Date().toISOString() };
  }
}

function extractSignal(text: string): number {
  const match = text.match(/signal\s+no\.?\s*(\d)/i);
  if (match) return parseInt(match[1], 10);
  if (/signal\s+4/i.test(text)) return 4;
  if (/signal\s+3/i.test(text)) return 3;
  if (/signal\s+2/i.test(text)) return 2;
  if (/signal\s+1/i.test(text)) return 1;
  return 0;
}
