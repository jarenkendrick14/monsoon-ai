import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { sendBulkSms as sendSemaphoreBulkSms, sendSms as sendSemaphoreSms } from './semaphore.js';
import { sendBulkSms as sendHttpSmsBulkSms, sendSms as sendHttpSms } from './httpsms.js';
import { sendSms as sendTwilioSms } from './twilio.js';

type SmsProvider = typeof config.sms.provider;

export interface NormalizedInboundSms {
  provider: SmsProvider | 'unknown';
  from: string;
  to?: string;
  message: string;
  eventType?: string;
  shouldProcess: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(segment, 'base64url').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function verifyHs256Jwt(token: string, signingKey: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [headerSegment, payloadSegment, signatureSegment] = parts;
  const header = decodeBase64UrlJson(headerSegment);
  if (header?.['alg'] !== 'HS256') return false;

  const expected = createHmac('sha256', signingKey)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest('base64url');

  const actualBuffer = Buffer.from(signatureSegment);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return false;

  const payload = decodeBase64UrlJson(payloadSegment);
  const exp = payload?.['exp'];
  if (typeof exp === 'number' && Date.now() >= exp * 1000) return false;

  return true;
}

export function verifyHttpSmsWebhook(req: Request): boolean {
  if (!config.httpsms.webhookSigningKey) {
    logger.warn('HTTPSMS_WEBHOOK_SIGNING_KEY not set; accepting httpSMS webhook without signature verification');
    return true;
  }

  const header = req.header('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  return verifyHs256Jwt(match[1], config.httpsms.webhookSigningKey);
}

export function isHttpSmsWebhook(body: unknown): boolean {
  const event = asRecord(body);
  return asString(event['specversion']) === '1.0'
    && !!asString(event['type'])
    && !!event['data'];
}

export function normalizeInboundSms(body: unknown): NormalizedInboundSms {
  const payload = asRecord(body);

  if (isHttpSmsWebhook(payload)) {
    const data = asRecord(payload['data']);
    const eventType = asString(payload['type']);
    return {
      provider: 'httpsms',
      eventType,
      from: asString(data['contact']),
      to: asString(data['owner']),
      message: asString(data['content']),
      shouldProcess: eventType === 'message.phone.received',
    };
  }

  return {
    provider: 'unknown',
    from: asString(payload['from']) || asString(payload['From']),
    to: asString(payload['to']) || asString(payload['To']),
    message: asString(payload['message']) || asString(payload['Body']),
    shouldProcess: true,
  };
}

export async function sendSms(to: string, message: string): Promise<boolean> {
  if (config.sms.provider === 'httpsms') return sendHttpSms(to, message);
  if (config.sms.provider === 'twilio') return sendTwilioSms(to, message);
  return sendSemaphoreSms(to, message);
}

export async function sendBulkSms(numbers: string[], message: string): Promise<void> {
  if (config.sms.provider === 'httpsms') {
    await sendHttpSmsBulkSms(numbers, message);
    return;
  }

  if (config.sms.provider === 'twilio') {
    for (const number of numbers) {
      await sendTwilioSms(number, message);
    }
    return;
  }

  await sendSemaphoreBulkSms(numbers, message);
}
