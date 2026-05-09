import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { ChatMessage, ChatReply, Locale, RiskContext } from '../types/index.js';

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!client) {
    client = new GoogleGenerativeAI(config.openai.apiKey);
  }
  return client;
}

const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  tl: 'Filipino (Tagalog)',
  vi: 'Vietnamese',
};

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
  if (!config.openai.apiKey) {
    return {
      reply: 'AI assistant is not available. Please call emergency services if needed.',
      suggestedCommands: ['STATUS', 'EVAC', 'FLOOD'],
    };
  }

  try {
    const model = getClient().getGenerativeModel({
      model: config.openai.model,
      systemInstruction: `You are MonsoonAI, a disaster response assistant for the Philippines and Vietnam.
The deterministic risk engine has already evaluated conditions. Current status:
- Alert level: ${context.alertLevel}
- Trigger: ${context.trigger ?? 'none'}
- Location: ${context.location}

Rules:
- Provide factual, calm, actionable safety information only
- Do NOT perform any risk calculations — the engine already did this
- Always respond in ${LOCALE_NAMES[locale]}
- Keep responses concise (under 100 words)
- Use plain text only. No markdown, no asterisks, no bullet symbols. Use numbered lists if listing steps.
- If life is at immediate risk, always direct to evacuate or call 911`,
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
