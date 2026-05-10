import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  SchemaType,
  type ResponseSchema,
} from '@google/generative-ai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { ChatMessage, ChatReply, Locale, RiskContext } from '../types/index.js';
import { CorpusEntry, needsRag, retrievePassages } from '../engine/ragRetrieval.js';

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

const RAG_STATUS_VALUES = ['supported', 'insufficient'] as const;
type RagStatus = typeof RAG_STATUS_VALUES[number];

const ALLOWED_RAG_COMMANDS = [
  'Call 911',
  'Find evac center',
  'Check conditions',
  'Show evac route',
  'Contact emergency services',
  'View checklist',
] as const;

interface StructuredRagReply {
  status: RagStatus;
  answer: string;
  usedSourceIds: string[];
  emergency: boolean;
  suggestedCommands: string[];
}

const RAG_SAFETY_SETTINGS = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map(category => ({
  category,
  threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
}));

const GROUNDED_FALLBACKS: Record<Locale, string> = {
  en: 'I cannot verify that from the provided guidance. Call 911 or contact local emergency responders.',
  tl: 'Hindi ko ma-verify iyon mula sa gabay. Tumawag sa 911 o sa lokal na emergency responders.',
  vi: 'Tôi không thể xác minh điều đó từ hướng dẫn được cung cấp. Hãy gọi 911 hoặc lực lượng ứng cứu địa phương.',
};

const SMS_GROUNDED_FALLBACKS: Record<Locale, string> = {
  en: 'Cannot verify from guidance. Call 911 or local emergency responders.',
  tl: 'Hindi ma-verify sa gabay. Tumawag sa 911 o local responders.',
  vi: 'Không thể xác minh từ hướng dẫn. Gọi 911 hoặc đội ứng cứu địa phương.',
};

function formatRagSources(passages: CorpusEntry[]): string {
  return passages.map((passage, index) => [
    `[SOURCE ${index + 1}: ${passage.id} | ${passage.topic}]`,
    passage.text,
    `[END SOURCE ${index + 1}]`,
  ].join('\n')).join('\n\n');
}

function groundedRagPrompt(
  message: string,
  locale: Locale,
  passages: CorpusEntry[],
  wordLimit: string,
  userContext?: string
): string {
  return `You are MonsoonAI. Answer the user using ONLY the provided sources.

STRICT GROUNDING RULES:
- Use only facts and instructions that appear in the sources below.
- Do not add medical, rescue, legal, weather, location, or evacuation advice from general knowledge.
- You may personalize wording using user-provided details from the current question and recent user context, such as body part, person, severity words, or pronouns.
- User-provided details are context for wording and relevance only; safety instructions must still come from the sources.
- If the user mentions a body part, refer to that body part naturally instead of using generic wording when the source guidance applies.
- If the sources do not contain enough information to answer safely, say: "I cannot verify that from the provided guidance. Call 911 or contact local emergency responders."
- If the situation may be life-threatening based on the sources, tell the user to call 911 or local emergency responders.
- Reply in ${LOCALE_NAMES[locale]}.
- ${wordLimit}
- Return JSON only. No markdown.
- If status is supported, usedSourceIds must list only sources used in the answer.
- If status is insufficient, answer must be the exact fallback sentence requested by the grounding rules.
- suggestedCommands must only use commands that are relevant and available in the schema.

${formatRagSources(passages)}

${userContext ? `[RECENT USER CONTEXT]\n${userContext}\n[END RECENT USER CONTEXT]\n\n` : ''}User question: ${message}`;
}

function buildRecentUserContext(message: string, history: ChatMessage[]): string {
  const recentUserMessages = history
    .filter(item => item.role === 'user')
    .slice(-3)
    .map(item => item.content.trim())
    .filter(Boolean);
  return [...recentUserMessages, message.trim()]
    .filter(Boolean)
    .join('\n');
}

function buildRagQuery(message: string, history: ChatMessage[]): string {
  const recentUserContext = buildRecentUserContext(message, history);
  return recentUserContext || message;
}

function isLiveConditionsQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  const triviaStarters = ['who is', 'who invented', 'what is', 'when was', 'where is', 'why is'];
  if (triviaStarters.some(starter => lower.startsWith(starter))
    && !['current', 'today', 'now', 'status', 'check'].some(term => lower.includes(term))) {
    return false;
  }
  const conditionTerms = [
    'weather',
    'umbrella',
    'rain',
    'rainfall',
    'forecast',
    'condition',
    'conditions',
    'temperature',
    'outside',
  ];
  const liveIntentTerms = [
    'current',
    'today',
    'now',
    'update',
    'alert',
    'alerts',
    'status',
    'check',
    'safe',
    'conditions',
    'forecast',
    'rainfall',
    'umbrella',
  ];
  const emergencyTerms = [
    'hurt',
    'injured',
    'injury',
    'wound',
    'bleed',
    'bleeding',
    'burn',
    'cut',
    'pain',
    'sick',
    'fever',
    'heatstroke',
    'heat stroke',
  ];
  return conditionTerms.some(term => lower.includes(term))
    && liveIntentTerms.some(term => lower.includes(term))
    && !emergencyTerms.some(term => lower.includes(term));
}

function isStatusQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  return [
    'status',
    'check conditions',
    'weather update',
    'alert',
    'alerts',
    'is it safe',
    'evac',
    'evacuation',
  ].some(term => lower.includes(term));
}

function isCasualGreeting(message: string): boolean {
  const lower = message.trim().toLowerCase();
  return [
    'hi',
    'hello',
    'hey',
    'how are you',
    'how r u',
    'sup',
    'yo',
  ].some(term => lower === term || lower.startsWith(`${term}?`));
}

function isOutOfScopeQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  const questionStarters = ['who is', 'what is', 'when was', 'where is', 'why is', 'how do i'];
  if (!questionStarters.some(starter => lower.startsWith(starter))) return false;
  return !isLiveConditionsQuestion(message) && !needsRag(message);
}

function casualReply(locale: Locale): ChatReply {
  const replies: Record<Locale, string> = {
    en: "I'm here and ready. Ask me about weather, alerts, evacuation, or emergency first aid.",
    tl: 'Nandito ako at handa. Magtanong tungkol sa panahon, alerto, evacuation, o emergency first aid.',
    vi: 'Tôi sẵn sàng. Hãy hỏi về thời tiết, cảnh báo, sơ tán hoặc sơ cứu khẩn cấp.',
  };
  return {
    reply: replies[locale],
    suggestedCommands: ['Check conditions', 'Find evac center'],
  };
}

function outOfScopeReply(locale: Locale): ChatReply {
  const replies: Record<Locale, string> = {
    en: "I'm focused on disaster readiness and emergency guidance, so I can't verify general trivia here. Ask me about local conditions, evacuation, or first aid.",
    tl: 'Nakatuon ako sa disaster readiness at emergency guidance, kaya hindi ko ma-verify ang general trivia rito. Magtanong tungkol sa local conditions, evacuation, o first aid.',
    vi: 'Tôi tập trung vào sẵn sàng ứng phó thiên tai và hướng dẫn khẩn cấp, nên không xác minh câu hỏi kiến thức chung ở đây. Hãy hỏi về điều kiện địa phương, sơ tán hoặc sơ cứu.',
  };
  return {
    reply: replies[locale],
    suggestedCommands: ['Check conditions', 'Find evac center'],
  };
}

function buildRagResponseSchema(passages: CorpusEntry[]): ResponseSchema {
  return {
    type: SchemaType.OBJECT,
    properties: {
      status: {
        type: SchemaType.STRING,
        format: 'enum',
        enum: [...RAG_STATUS_VALUES],
      },
      answer: {
        type: SchemaType.STRING,
        description: 'User-facing answer grounded only in the provided sources.',
      },
      usedSourceIds: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.STRING,
          format: 'enum',
          enum: passages.map(passage => passage.id),
        },
      },
      emergency: {
        type: SchemaType.BOOLEAN,
      },
      suggestedCommands: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.STRING,
          format: 'enum',
          enum: [...ALLOWED_RAG_COMMANDS],
        },
      },
    },
    required: ['status', 'answer', 'usedSourceIds', 'emergency', 'suggestedCommands'],
  };
}

function cleanJsonText(text: string): string {
  return text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
}

export function fallbackGroundedReply(locale: Locale, channel: 'chat' | 'sms'): StructuredRagReply {
  return {
    status: 'insufficient',
    answer: channel === 'sms' ? SMS_GROUNDED_FALLBACKS[locale] : GROUNDED_FALLBACKS[locale],
    usedSourceIds: [],
    emergency: true,
    suggestedCommands: ['Call 911', 'Find evac center'],
  };
}

export function parseAndValidateRagResponse(
  text: string,
  passages: CorpusEntry[],
  locale: Locale,
  channel: 'chat' | 'sms'
): StructuredRagReply {
  const fallback = fallbackGroundedReply(locale, channel);
  const maxAnswerChars = channel === 'sms' ? 155 : 900;

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanJsonText(text));
  } catch {
    return fallback;
  }

  if (!parsed || typeof parsed !== 'object') return fallback;

  const candidate = parsed as Partial<StructuredRagReply>;
  const sourceIds = new Set(passages.map(passage => passage.id));
  const allowedCommands = new Set<string>(ALLOWED_RAG_COMMANDS);

  if (candidate.status !== 'supported' && candidate.status !== 'insufficient') return fallback;
  if (typeof candidate.answer !== 'string') return fallback;

  const answer = candidate.answer.trim().replace(/\s+/g, ' ');
  if (!answer || answer.length > maxAnswerChars) return fallback;
  if (!Array.isArray(candidate.usedSourceIds)) return fallback;
  if (!candidate.usedSourceIds.every(id => typeof id === 'string' && sourceIds.has(id))) return fallback;
  if (typeof candidate.emergency !== 'boolean') return fallback;
  if (!Array.isArray(candidate.suggestedCommands)) return fallback;

  const suggestedCommands = candidate.suggestedCommands
    .filter((command): command is string => typeof command === 'string' && allowedCommands.has(command))
    .slice(0, 3);

  if (candidate.suggestedCommands.length !== suggestedCommands.length) return fallback;
  if (candidate.status === 'insufficient') return fallback;
  if (candidate.usedSourceIds.length === 0) return fallback;

  return {
    status: candidate.status,
    answer,
    usedSourceIds: candidate.usedSourceIds,
    emergency: candidate.emergency,
    suggestedCommands: suggestedCommands.length > 0
      ? suggestedCommands
      : ['Call 911', 'Find evac center', 'Check conditions'],
  };
}

async function generateStructuredRagReply(
  message: string,
  locale: Locale,
  passages: CorpusEntry[],
  channel: 'chat' | 'sms',
  userContext?: string
): Promise<StructuredRagReply> {
  const model = getClient().getGenerativeModel({
    model: config.openai.model,
    safetySettings: RAG_SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: buildRagResponseSchema(passages),
    },
  });
  const wordLimit = channel === 'sms' ? 'Under 130 characters.' : 'Under 80 words.';
  const prompt = groundedRagPrompt(message, locale, passages, wordLimit, userContext);
  const result = await model.generateContent(prompt);
  return parseAndValidateRagResponse(result.response.text(), passages, locale, channel);
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
  if (!config.openai.apiKey) return 'Service unavailable. Call 911 for emergencies.';

  try {
    if (!isLiveConditionsQuestion(message) && needsRag(message)) {
      const passages = retrievePassages(message, 2);
      if (passages.length > 0) {
        const structuredReply = await generateStructuredRagReply(message, locale, passages, 'sms');
        return structuredReply.answer.length > 155
          ? structuredReply.answer.slice(0, 152) + '...'
          : structuredReply.answer;
      }
      return fallbackGroundedReply(locale, 'sms').answer;
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
  if (!config.openai.apiKey) {
    return {
      reply: 'AI assistant is not available. Please call emergency services if needed.',
      suggestedCommands: ['STATUS', 'EVAC', 'FLOOD'],
    };
  }

  try {
    const ragQuery = buildRagQuery(message, history);
    if (!isLiveConditionsQuestion(message) && needsRag(ragQuery)) {
      const passages = retrievePassages(ragQuery, 4);
      if (passages.length > 0) {
        const structuredReply = await generateStructuredRagReply(message, locale, passages, 'chat', ragQuery);
        return {
          reply: structuredReply.answer,
          suggestedCommands: structuredReply.suggestedCommands,
        };
      } else {
        const fallback = fallbackGroundedReply(locale, 'chat');
        return {
          reply: fallback.answer,
          suggestedCommands: fallback.suggestedCommands,
        };
      }
    }

    if (isCasualGreeting(message)) {
      return casualReply(locale);
    }

    if (isOutOfScopeQuestion(message) && !isStatusQuestion(message)) {
      return outOfScopeReply(locale);
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
      systemInstruction: `You are MonsoonAI, a disaster response assistant for the Philippines and Vietnam.
The deterministic risk engine has already computed the user's status. You are a TRANSLATOR only — convert this verdict into a helpful human sentence. DO NOT calculate, estimate, or invent any risk data.

CURRENT ENGINE VERDICT:
- Alert level: ${context.alertLevel}
- Trigger: ${context.trigger ?? 'none'}
- Location: ${context.location}
${evacLine}
${condLines}

STRICT RULES:
- Only use the CURRENT ENGINE VERDICT and LIVE CONDITIONS above
- DO NOT invent evacuation centers, distances, risk scores, or sensor readings
- DO NOT perform any calculations — the engine already did this
- If the user asks for first aid, medical, rescue, or disaster advice that is not covered by the current verdict, say you can only verify the current alert status and they should contact local emergency responders or call 911
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
