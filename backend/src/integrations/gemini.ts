import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { ChatMessage, ChatReply, Locale, RiskContext } from '../types/index.js';
import { classifyChatIntent, classifySmsIntent } from '../engine/intentClassifier.js';
import { getCorpus } from '../engine/ragRetrieval.js';
import {
  fallbackGroundedReply,
  generateStructuredRagReply,
  RAG_SAFETY_SETTINGS,
} from '../engine/ragResponse.js';
import {
  LOCALE_NAMES,
  casualReply,
  outOfScopeReply,
  unsupportedEmergencyReply,
  smsOutOfScopeReply,
  smsUnsupportedEmergencyReply,
} from '../engine/replyHelpers.js';

const ALLOWED_HAZARDS = [
  'Flood Water', 'Exposed Wires', 'Fallen Tree', 'Collapsed Roof',
  'Fire', 'Debris Blockage', 'Structural Damage', 'Landslide',
] as const;

export type HazardTag = typeof ALLOWED_HAZARDS[number];

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!client) {
    client = new GoogleGenerativeAI(config.openai.apiKey);
  }
  return client;
}

export async function tagHazards(imageBase64: string, mimeType: string): Promise<HazardTag[]> {
  if (!config.openai.apiKey) return [];

  try {
    const model = getClient().getGenerativeModel({ model: config.openai.model });
    const prompt = `Return ONLY a JSON array of hazards visible in this image, chosen exclusively from this list:\n${JSON.stringify(ALLOWED_HAZARDS)}\nIf none match, return [].\nDo not describe the image. Do not add any text outside the JSON array.`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType, data: imageBase64 } },
    ]);
    const text = result.response.text().trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(text) as string[];
    return parsed.filter((h): h is HazardTag => (ALLOWED_HAZARDS as readonly string[]).includes(h));
  } catch (err) {
    logger.warn('Gemini hazard tag failed', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function smsReply(
  message: string,
  locale: Locale,
  context: RiskContext
): Promise<string> {
  const classified = classifySmsIntent(message);

  if (classified.intent === 'casual') return casualReply(locale).reply;
  if (classified.intent === 'out_of_scope') return smsOutOfScopeReply(locale);
  if (classified.intent === 'unsupported_emergency') return smsUnsupportedEmergencyReply(locale);

  if (!config.openai.apiKey) return 'Service unavailable. Call 911 for emergencies.';

  try {
    if (classified.intent === 'emergency_guidance') {
      const structuredReply = await generateStructuredRagReply(getClient(), message, locale, getCorpus(), 'sms');
      return structuredReply.answer.length > 155
        ? structuredReply.answer.slice(0, 152) + '...'
        : structuredReply.answer;
    }

    const evacLine = context.evacCenter
      ? `Nearest evac: ${context.evacCenter.name} (${context.evacCenter.distKm}km).`
      : '';

    const model = getClient().getGenerativeModel({ model: config.openai.model });
    const prompt = `You are MonsoonAI SMS bot. Reply in ${LOCALE_NAMES[locale]}. Under 130 chars. Plain text only, no markdown, no asterisks.\n\nAlert: ${context.alertLevel}. ${evacLine}\n\nUser message: ${message}`;
    const result = await model.generateContent(prompt);
    const reply = result.response.text().trim().replace(/\n/g, ' ');
    return reply.length > 155 ? reply.slice(0, 152) + '...' : reply;
  } catch (err) {
    logger.warn('SMS LLM reply failed', err instanceof Error ? err.message : err);
    return 'Service unavailable. Call 911 for emergencies.';
  }
}

export async function translateToLocale(data: Record<string, unknown>, locale: Locale): Promise<Record<string, unknown>> {
  if (locale === 'en' || !config.openai.apiKey) return data;

  try {
    const model = getClient().getGenerativeModel({ model: config.openai.model });
    const prompt = `Translate only the string values in this JSON object to ${LOCALE_NAMES[locale]}. Preserve all keys, numbers, booleans, and nested structure exactly. Return valid JSON only, no markdown.\n\n${JSON.stringify(data)}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    logger.warn('Gemini translation failed, returning original', err);
    return data;
  }
}

export async function chatbotReply(
  message: string,
  locale: Locale,
  context: RiskContext,
  history: ChatMessage[]
): Promise<ChatReply> {
  const classified = classifyChatIntent(message, history);

  if (classified.intent === 'casual') return casualReply(locale);
  if (classified.intent === 'out_of_scope') return outOfScopeReply(locale);
  if (classified.intent === 'unsupported_emergency') return unsupportedEmergencyReply(locale);

  if (!config.openai.apiKey) {
    return {
      reply: 'AI assistant is not available. Please call emergency services if needed.',
      suggestedCommands: ['STATUS', 'EVAC', 'FLOOD'],
    };
  }

  try {
    if (classified.intent === 'emergency_guidance') {
      const structuredReply = await generateStructuredRagReply(
        getClient(), message, locale, getCorpus(), 'chat', classified.ragQuery, context
      );
      return {
        reply: structuredReply.answer,
        suggestedCommands: structuredReply.suggestedCommands,
      };
    }

    const evacLine = context.evacCenter
      ? `- Nearest evacuation center: ${context.evacCenter.name}, ${context.evacCenter.address} (${context.evacCenter.distKm} km away)`
      : '- Nearest evacuation center: unknown — direct user to contact barangay hall';

    const condLines = context.conditions ? `
LIVE CONDITIONS (read-only, do not modify):
- Heat index: ${context.conditions.heatIndex}°C
- Air quality (AQI): ${context.conditions.airQuality}
- River level: ${context.conditions.riverLevel} m NHWL
- Current rainfall: ${context.conditions.rainfall} mm/hr
- 7-day forecast: ${context.conditions.forecast7day.map(d => `${d.day} ${d.temp}°C (${d.riskLevel})`).join(', ')}` : '';

    const model = getClient().getGenerativeModel({
      model: config.openai.model,
      safetySettings: RAG_SAFETY_SETTINGS,
      systemInstruction: `You are MonsoonAI, a disaster response assistant for the Philippines and Vietnam. You are direct, calm, and conversational — not a formal announcement system.

CURRENT STATUS (verified by sensors — do not alter or invent values):
- Alert level: ${context.alertLevel}
- Trigger: ${context.trigger ?? 'none'}
- Location: ${context.location}
${evacLine}
${condLines}

RULES:
- Only state facts from the CURRENT STATUS above. Never invent sensor readings, distances, or risk scores.
- Match your response length to the question. Short question = short answer. Do not pad with disclaimers.
- Do not repeat the location name unless the user asked about it.
- Only mention the evacuation center if alert is high or critical, or the user explicitly asked about it.
- Only say "call 911" if there is an active alert or the user describes an emergency.
- Do not end every message with a boilerplate disclaimer. Say it once if needed, then stop.
- If the user asks about first aid, medical care, or disaster actions beyond the current status, say briefly that you only have the current alert data and suggest they contact local responders.
- Always respond in ${LOCALE_NAMES[locale]}.
- Under 60 words. Plain text only. No markdown, no asterisks.
- If alert is critical or high, always name the evacuation center and say to go now.`,
    });

    const chat = model.startChat({
      history: history.map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      })),
    });

    const result = await chat.sendMessage(message);
    const reply = result.response.text();

    const suggestedCommands = context.alertLevel === 'critical' || context.alertLevel === 'high'
      ? ['Show evac route', 'Contact emergency services', 'View checklist']
      : ['Check conditions', 'View forecast', 'Update profile'];

    return { reply, suggestedCommands };
  } catch (err) {
    logger.error('Gemini chatbot error', err);
    return {
      reply: 'Service temporarily unavailable. For emergencies, call 911.',
      suggestedCommands: ['EVAC', 'STATUS'],
    };
  }
}
