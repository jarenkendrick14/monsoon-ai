import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export async function sendSms(to: string, message: string): Promise<boolean> {
  if (!config.httpsms.apiKey || !config.httpsms.phoneNumber) {
    logger.warn('httpSMS not configured, skipping SMS');
    return false;
  }

  try {
    await axios.post(
      `${config.httpsms.baseUrl}/messages/send`,
      {
        from: config.httpsms.phoneNumber,
        to,
        content: message,
      },
      {
        headers: {
          'x-api-key': config.httpsms.apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    return true;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    const msg = (err as Error)?.message?.split('\n')[0] ?? String(err);
    logger.error(`httpSMS sendSms failed (${status ?? 'no response'}): ${msg}`);
    return false;
  }
}

export async function sendBulkSms(numbers: string[], message: string): Promise<void> {
  for (const number of numbers) {
    await sendSms(number, message);
  }
}
