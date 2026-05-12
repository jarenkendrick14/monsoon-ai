import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { AlertReason, ChatMessage, ChatReply, HazardTag, Locale, RiskContext, UserRecord } from '../types/index.js';
import { classifyChatIntent, classifyDisasterChatIntent, classifySmsIntent } from '../engine/intentClassifier.js';
import { retrieveDisasterPassages, retrievePassages } from '../engine/ragRetrieval.js';
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
] as const satisfies readonly HazardTag[];

export interface HazardTaggingResult {
  hazards: HazardTag[];
  confidence: 'low' | 'medium' | 'high';
  needsHumanReview: true;
}

export interface AlertDetailGuidance {
  headline: string;
  reasons: AlertReason[];
  checklist: string[];
  sourceIds: string[];
}

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!client) {
    client = new GoogleGenerativeAI(config.openai.apiKey);
  }
  return client;
}

const ALERT_DETAIL_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    headline: {
      type: SchemaType.STRING,
      description: 'Short urgent alert headline personalized to the household.',
    },
    reasons: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING },
          detail: { type: SchemaType.STRING },
        },
        required: ['title', 'detail'],
      },
    },
    checklist: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    sourceIds: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
  },
  required: ['headline', 'reasons', 'checklist', 'sourceIds'],
};

function cleanJsonText(text: string): string {
  return text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
}

function formatAlertSources(passages: ReturnType<typeof retrievePassages>): string {
  return passages.map((p, i) => `[SOURCE ${i + 1}: ${p.id} | ${p.topic}]\n${p.text}\n[END SOURCE ${i + 1}]`).join('\n\n');
}

function fallbackAlertDetailGuidance(user: UserRecord): AlertDetailGuidance {
  const householdNotes = [
    Number(user.floor) === 0 ? 'ground-floor home' : '',
    user.hasElderly ? 'elderly household member' : '',
    user.hasPWD ? 'PWD household member' : '',
    user.hasInfant ? 'infant' : '',
    user.hasPregnant ? 'pregnant household member' : '',
  ].filter(Boolean).join(', ');

  return {
    headline: 'Evacuate within 45 min',
    reasons: [
      { title: 'Extreme 24-hour rainfall', detail: '248 mm/24h in the active disaster scenario.' },
      { title: 'Flood hazard at saved address', detail: `${user.address || 'Your saved address'} is being tested as a 25-year flood hazard zone.` },
      { title: 'Household priority', detail: householdNotes ? `Prioritized because of ${householdNotes}.` : 'Prioritized because of flood exposure.' },
    ],
    checklist: [
      'Bring IDs, medicines, phone, charger, water, food, flashlight, and cash.',
      'Turn off electricity or gas only if it is safe to do so.',
      'Avoid walking or driving through floodwater.',
      'Follow the evacuation route and LGU instructions.',
      'Call 911 or local responders if trapped or in immediate danger.',
    ],
    sourceIds: ['rag-001', 'rag-018'],
  };
}

export async function generateAlertDetailGuidance(user: UserRecord, context: RiskContext): Promise<AlertDetailGuidance> {
  const passages = retrievePassages('flood evacuation emergency kit avoid floodwater typhoon shelter', 4);
  if (!config.openai.apiKey || passages.length === 0) return fallbackAlertDetailGuidance(user);

  const householdContext = [
    `Name: ${user.name}`,
    `Saved address: ${user.address || 'unknown'}`,
    `Home type: ${user.homeType || 'unknown'}`,
    `Floor: ${Number(user.floor) === 0 ? 'ground floor' : user.floor}`,
    `Household size: ${user.householdSize || 'unknown'}`,
    `Vulnerable members: ${[
      user.hasElderly ? 'elderly' : '',
      user.hasPWD ? 'PWD' : '',
      user.hasInfant ? 'infant' : '',
      user.hasPregnant ? 'pregnant' : '',
    ].filter(Boolean).join(', ') || 'none recorded'}`,
    `Alert level: ${context.alertLevel}`,
    `Trigger: ${context.trigger ?? 'none'}`,
    `Rainfall: ${context.conditions?.rainfall ?? 'unknown'} mm/24h`,
    `River level: ${context.conditions?.riverLevel ?? 'unknown'} m NHWL`,
    context.evacCenter ? `Nearest evacuation center: ${context.evacCenter.name}, ${context.evacCenter.address} (${context.evacCenter.distKm} km)` : 'Nearest evacuation center: unknown',
  ].join('\n');

  const model = getClient().getGenerativeModel({
    model: config.openai.model,
    safetySettings: RAG_SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: ALERT_DETAIL_SCHEMA,
    },
  });

  const prompt = `You generate the content for a citizen active-alert page.

Return JSON only.

Rules:
- Use ONLY the provided sources for safety advice and checklist actions.
- Use household context only for personalization and prioritization.
- Do not invent sensor readings, evacuation centers, distances, medical advice, or structural safety claims.
- reasons must contain 3 concise personalized reasons.
- checklist must contain 5 concise practical items/actions grounded in the sources.
- sourceIds must list only source IDs actually used.
- headline must be urgent and short, under 45 characters.
- Plain language for a mobile app. No markdown.

[HOUSEHOLD AND ALERT CONTEXT]
${householdContext}
[END HOUSEHOLD AND ALERT CONTEXT]

${formatAlertSources(passages)}`;

  try {
    const result = await model.generateContent(prompt);
    const parsed = JSON.parse(cleanJsonText(result.response.text())) as Partial<AlertDetailGuidance>;
    const validSourceIds = new Set(passages.map(p => p.id));
    const reasons = Array.isArray(parsed.reasons)
      ? parsed.reasons
          .filter(r => r && typeof r.title === 'string' && typeof r.detail === 'string')
          .slice(0, 3)
      : [];
    const checklist = Array.isArray(parsed.checklist)
      ? parsed.checklist.filter(item => typeof item === 'string' && item.trim()).slice(0, 5)
      : [];
    const sourceIds = Array.isArray(parsed.sourceIds)
      ? parsed.sourceIds.filter((id): id is string => typeof id === 'string' && validSourceIds.has(id))
      : [];
    if (!parsed.headline || typeof parsed.headline !== 'string' || reasons.length < 2 || checklist.length < 3 || sourceIds.length === 0) {
      return fallbackAlertDetailGuidance(user);
    }
    return {
      headline: parsed.headline.slice(0, 60),
      reasons,
      checklist,
      sourceIds,
    };
  } catch (err) {
    logger.warn('Gemini alert detail generation failed', err instanceof Error ? err.message : err);
    return fallbackAlertDetailGuidance(user);
  }
}

export async function tagHazards(imageBase64: string, mimeType: string): Promise<HazardTaggingResult> {
  if (!config.openai.apiKey) return emptyHazardTaggingResult();

  try {
    const model = getClient().getGenerativeModel({ model: config.openai.model });
    const prompt = `You are an object tagger for an LGU disaster dashboard, not a safety advisor or structural engineer.

Return ONLY valid JSON in this exact shape:
{"hazards":[],"confidence":"low","needsHumanReview":true}

Rules:
- hazards must contain only labels chosen from this list: ${JSON.stringify(ALLOWED_HAZARDS)}
- include a label only when it is visibly present in the image
- do not infer hidden electrical, structural, chemical, medical, or engineering risk
- do not say whether anything is safe or unsafe
- confidence must be "low", "medium", or "high"
- needsHumanReview must always be true
- if no allowed hazard is visible, return {"hazards":[],"confidence":"low","needsHumanReview":true}`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType, data: imageBase64 } },
    ]);
    const text = result.response.text().trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    return parseHazardTaggingResult(text);
  } catch (err) {
    logger.warn('Gemini hazard tag failed', err instanceof Error ? err.message : err);
    return emptyHazardTaggingResult();
  }
}

function emptyHazardTaggingResult(): HazardTaggingResult {
  return { hazards: [], confidence: 'low', needsHumanReview: true };
}

function parseHazardTaggingResult(text: string): HazardTaggingResult {
  const parsed = JSON.parse(text) as Partial<HazardTaggingResult> | HazardTag[];
  const sourceHazards = Array.isArray(parsed) ? parsed : parsed.hazards;
  const hazards = Array.isArray(sourceHazards)
    ? sourceHazards.filter((h): h is HazardTag => (ALLOWED_HAZARDS as readonly string[]).includes(h))
    : [];
  const confidence = !Array.isArray(parsed) && ['low', 'medium', 'high'].includes(String(parsed.confidence))
    ? parsed.confidence as 'low' | 'medium' | 'high'
    : hazards.length ? 'medium' : 'low';
  return { hazards, confidence, needsHumanReview: true };
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
      const passages = retrievePassages(classified.ragQuery, 2);
      if (passages.length === 0) return fallbackGroundedReply(locale, 'sms').answer;

      const structuredReply = await generateStructuredRagReply(getClient(), message, locale, passages, 'sms');
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
  const isActiveDisaster = context.alertLevel === 'critical' || context.alertLevel === 'high';
  const classified = isActiveDisaster
    ? classifyDisasterChatIntent(message, history)
    : classifyChatIntent(message, history);

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
      const passages = isActiveDisaster
        ? retrieveDisasterPassages(classified.ragQuery, 4)
        : retrievePassages(classified.ragQuery, 4);
      if (passages.length === 0) {
        const fallback = fallbackGroundedReply(locale, 'chat');
        return {
          reply: fallback.answer,
          suggestedCommands: fallback.suggestedCommands,
        };
      }

      const structuredReply = await generateStructuredRagReply(
        getClient(), message, locale, passages, 'chat', classified.ragQuery, context
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
- Treat "my area", "near me", and similar wording as the saved Location above.
- If the user asks whether a prior live-condition answer is true for their area, answer using the same verified CURRENT STATUS values.
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
      : ['Check conditions', 'View forecast', 'Find evac center'];

    return { reply, suggestedCommands };
  } catch (err) {
    logger.error('Gemini chatbot error', err);
    return {
      reply: 'Service temporarily unavailable. For emergencies, call 911.',
      suggestedCommands: ['EVAC', 'STATUS'],
    };
  }
}
