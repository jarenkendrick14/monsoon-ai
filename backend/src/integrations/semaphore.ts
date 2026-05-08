import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const BASE_URL = 'https://api.semaphore.co/api/v4';

export async function sendSms(to: string, message: string): Promise<boolean> {
  if (!config.semaphore.apiKey) {
    logger.warn('Semaphore API key not set, skipping SMS');
    return false;
  }

  try {
    await axios.post(
      `${BASE_URL}/messages`,
      {
        apikey: config.semaphore.apiKey,
        number: to,
        message,
        sendername: config.semaphore.senderName,
      },
      { timeout: 10000 }
    );
    return true;
  } catch (err) {
    logger.error('Semaphore sendSms failed', err);
    return false;
  }
}

export async function sendBulkSms(numbers: string[], message: string): Promise<void> {
  if (!config.semaphore.apiKey) {
    logger.warn('Semaphore API key not set, skipping bulk SMS');
    return;
  }

  const chunks: string[][] = [];
  for (let i = 0; i < numbers.length; i += 100) {
    chunks.push(numbers.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    try {
      await axios.post(
        `${BASE_URL}/bulk`,
        {
          apikey: config.semaphore.apiKey,
          number: chunk.join(','),
          message,
          sendername: config.semaphore.senderName,
        },
        { timeout: 15000 }
      );
    } catch (err) {
      logger.error('Semaphore bulk SMS chunk failed', err);
    }
  }
}
