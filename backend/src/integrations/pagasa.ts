import axios from 'axios';
import { logger } from '../utils/logger.js';

export interface PagasaData {
  signal: number;
  bulletinTitle: string;
  issuedAt: string;
}

import { config } from '../config.js';

const PARSER_URL = config.pagasa.parserUrl;
const NO_STORM: PagasaData = { signal: 0, bulletinTitle: 'No active bulletin', issuedAt: new Date().toISOString() };

export async function fetchPagasa(): Promise<PagasaData> {
  try {
    const resp = await axios.get(PARSER_URL, { timeout: 10000 });
    const data = resp.data as Record<string, unknown>;

    // pagasa-parser returns the bulletin under data.bulletin or at root
    const bulletin = (data.bulletin ?? data) as Record<string, unknown>;

    const title: string =
      (bulletin.title as string) ??
      (bulletin.bulletinTitle as string) ??
      (bulletin.name as string) ??
      '';

    const issuedAt: string =
      (bulletin.issued as string) ??
      (bulletin.issuedAt as string) ??
      (bulletin.date as string) ??
      new Date().toISOString();

    // Signal may live at bulletin.signal, bulletin.signalNumber, or in the title text
    const rawSignal =
      (bulletin.signal as number) ??
      (bulletin.signalNumber as number) ??
      extractSignal(title);

    return { signal: Number(rawSignal) || 0, bulletinTitle: title || 'Active bulletin', issuedAt };
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      // No active typhoon — this is normal
      return NO_STORM;
    }
    const msg = (err as Error)?.message?.split('\n')[0] ?? String(err);
    logger.warn(`PAGASA parser fetch failed (${status ?? 'no response'}): ${msg}`);
    return NO_STORM;
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
