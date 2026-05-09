import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { ChatMessage, ChatReply, Locale, RiskContext } from '../types/index.js';
import { needsRag, retrievePassage } from '../engine/ragRetrieval.js';

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

const ALLOWED_HAZARDS = [
  'Flood Water', 'Exposed Wires', 'Fallen Tree', 'Collapsed Roof',
  'Fire', 'Debris Blockage', 'Structural Damage', 'Landslide',
] as const;

export type HazardTag = typeof ALLOWED_HAZARDS[number];

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
    if (needsRag(message)) {
      const passage = retrievePassage(message);
      if (passage) {
        const ragModel = getClient().getGenerativeModel({ model: config.openai.model });
        const ragPrompt = `Answer the user's question using ONLY the following official text. Do not extrapolate or add information not present in the text. Reply in ${LOCALE_NAMES[locale]}. Under 80 words. Plain text only.\n\n[OFFICIAL TEXT]\n${passage.text}\n[END OFFICIAL TEXT]\n\nUser question: ${message}`;
        const ragResult = await ragModel.generateContent(ragPrompt);
        const ragReply = ragResult.response.text();
        return {
          reply: ragReply,
          suggestedCommands: ['Call 911', 'Find evac center', 'Check conditions'],
        };
      } else {
        return {
          reply: 'I cannot verify that. Please contact your local disaster risk reduction office or call the NDRRMC hotline at 911.',
          suggestedCommands: ['Call 911', 'Find evac center'],
        };
      }
    }

    const evacLine = context.evacCenter
      ? `- Nearest evacuation center: ${context.evacCenter.name}, ${context.evacCenter.address} (${context.evacCenter.distKm} km away)`
      : '- Nearest evacuation center: unknown — direct user to contact barangay hall';

    const model = getClient().getGenerativeModel({
      model: config.openai.model,
      systemInstruction: `You are MonsoonAI, a disaster response assistant for the Philippines and Vietnam.
The deterministic risk engine has already computed the user's status. You are a TRANSLATOR only — convert this verdict into a helpful human sentence. DO NOT calculate, estimate, or invent any risk data.

CURRENT ENGINE VERDICT:
- Alert level: ${context.alertLevel}
- Trigger: ${context.trigger ?? 'none'}
- Location: ${context.location}
${evacLine}

STRICT RULES:
- DO NOT invent evacuation centers, distances, risk scores, or sensor readings
- DO NOT perform any calculations — the engine already did this
- If alert level is critical or high, you MUST mention the evacuation center above by name
- Always respond in ${LOCALE_NAMES[locale]}
- Under 80 words. Plain text only. No markdown, no asterisks.
- Use numbered steps only if listing a procedure
- If life is at immediate risk, direct to the named evacuation center and call 911`,
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
