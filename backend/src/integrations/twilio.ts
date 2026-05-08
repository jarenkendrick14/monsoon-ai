import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export function buildTwiML(message: string): string {
  const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

export async function sendSms(to: string, body: string): Promise<boolean> {
  if (!config.twilio.accountSid || !config.twilio.authToken) {
    logger.warn('Twilio not configured, skipping SMS');
    return false;
  }

  try {
    const { default: twilio } = await import('twilio');
    const client = twilio(config.twilio.accountSid, config.twilio.authToken);
    await client.messages.create({
      body,
      from: config.twilio.phoneNumber,
      to,
    });
    return true;
  } catch (err: unknown) {
    const msg = (err as Error)?.message?.split('\n')[0] ?? String(err);
    logger.error(`Twilio sendSms failed: ${msg}`);
    return false;
  }
}
