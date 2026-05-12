import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  SchemaType,
  type ResponseSchema,
} from '@google/generative-ai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { Locale, RiskContext } from '../types/index.js';
import { CorpusEntry } from './ragRetrieval.js';
import { LOCALE_NAMES, GROUNDED_FALLBACKS, SMS_GROUNDED_FALLBACKS } from './replyHelpers.js';

const RAG_STATUS_VALUES = ['supported', 'insufficient'] as const;
type RagStatus = typeof RAG_STATUS_VALUES[number];

export const ALLOWED_RAG_COMMANDS = [
  'Call 911',
  'Find evac center',
  'Check conditions',
  'Show evac route',
  'Contact emergency services',
  'View checklist',
] as const;

export interface StructuredRagReply {
  status: RagStatus;
  answer: string;
  usedSourceIds: string[];
  emergency: boolean;
  suggestedCommands: string[];
}

export const RAG_SAFETY_SETTINGS = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map(category => ({
  category,
  threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
}));

function formatRagSources(passages: CorpusEntry[]): string {
  return passages.map((passage, index) => [
    `[SOURCE ${index + 1}: ${passage.id} | ${passage.topic}]`,
    passage.text,
    `[END SOURCE ${index + 1}]`,
  ].join('\n')).join('\n\n');
}

function buildUserContextBlock(userContext?: string, riskContext?: RiskContext): string {
  const lines: string[] = [];

  if (riskContext) {
    lines.push(`Alert level: ${riskContext.alertLevel}`);
    if (riskContext.trigger) lines.push(`Alert trigger: ${riskContext.trigger}`);
    if (riskContext.location) lines.push(`User location: ${riskContext.location}`);
    if (riskContext.household) {
      const vulnerable = [
        riskContext.household.hasElderly ? 'elderly member' : '',
        riskContext.household.hasPWD ? 'PWD member' : '',
        riskContext.household.hasInfant ? 'infant' : '',
        riskContext.household.hasPregnant ? 'pregnant member' : '',
      ].filter(Boolean).join(', ') || 'none recorded';
      lines.push(`Household: ${riskContext.household.householdSize ?? 'unknown'} people, ${riskContext.household.homeType ?? 'unknown'} home, floor ${riskContext.household.floor ?? 'unknown'}, vulnerable members: ${vulnerable}`);
      if (riskContext.household.riskTier) lines.push(`Saved risk tier: ${riskContext.household.riskTier}`);
    }
    if (riskContext.evacCenter) {
      lines.push(`Nearest evacuation center: ${riskContext.evacCenter.name}, ${riskContext.evacCenter.address} (${riskContext.evacCenter.distKm} km away)`);
    }
    if (riskContext.situation) {
      const situationLines = [
        riskContext.situation.companions?.length ? `People with user: ${riskContext.situation.companions.join(', ')}` : '',
        riskContext.situation.needs?.length ? `Priority needs: ${riskContext.situation.needs.join(', ')}` : '',
        riskContext.situation.waterLevel ? `Water level: ${riskContext.situation.waterLevel}` : '',
        riskContext.situation.canLeaveSafely ? `Can leave safely: ${riskContext.situation.canLeaveSafely}` : '',
      ].filter(Boolean);
      if (situationLines.length) lines.push(...situationLines);
    }
  }

  if (userContext) lines.push(`Recent messages: ${userContext}`);

  if (lines.length === 0) return '';
  return `[USER CONTEXT]\n${lines.join('\n')}\n[END USER CONTEXT]\n\n`;
}

function groundedRagPrompt(
  message: string,
  locale: Locale,
  passages: CorpusEntry[],
  wordLimit: string,
  userContext?: string,
  riskContext?: RiskContext
): string {
  const hasEvacCenter = !!riskContext?.evacCenter;
  return `You are MonsoonAI. Answer the user using ONLY the provided sources.

STRICT GROUNDING RULES:
- Use only facts and instructions that appear in the sources below.
- Do not add medical, rescue, legal, weather, or evacuation advice from general knowledge.
- You may personalize wording using user-provided details from the current question and recent user context, such as body part, person, severity words, or pronouns.
- User-provided details are context for wording and relevance only; safety instructions must still come from the sources.
- If the user mentions a body part, refer to that body part naturally instead of using generic wording when the source guidance applies.
- Speak directly to the user's situation and avoid generic checklist wording.
- If alert level is high or critical, start with a one-sentence disaster update using USER CONTEXT before giving guidance.
- If alert level is high or critical and the user asks for a checklist or describes their situation, tailor 3 to 5 checklist items using the evacuation/source guidance, onboarding context, and the user's stated answers.
- During a high or critical alert, ask exactly one short follow-up question only if the answer would change the next checklist item. Never ask compound questions.
- Intake order: first ask who is with them; once answered, ask whether they can leave safely right now; once answered, ask water level; once answered, ask medicine/mobility needs. Skip any question already answered in recent messages.
- If the user says they have a baby, elderly person, diabetes medicine, wheelchair, PWD, or mobility need, treat that as checklist-priority context. Do not switch into symptom screening unless the user reports symptoms or asks about illness.
- Do not mention dehydration, breathing trouble, fever, convulsions, heatstroke, or other medical danger signs unless the user states a related symptom, asks about that condition, or the source guidance is directly necessary for the current question.
- Prioritize the current user question. Use recent messages only to resolve pronouns or short follow-ups, not to re-answer older topics.
- Do not mention an older injury, hazard, or scenario unless the current question is clearly a follow-up to it.
- Do not assume facts the user did not state. Use conditional wording such as "if you are still in the vehicle", "if bleeding is heavy", or "if you have head, neck, or back pain".
- Order the answer by urgency: immediate danger, call/help, then wound or symptom-specific care.
- Avoid absolute instructions like "do not move" unless the source clearly supports them and the user context fits; prefer conditional safety wording.
- If the sources do not contain enough information to answer safely, say: "I cannot verify that from the provided guidance. Call 911 or contact local emergency responders."
- If the situation may be life-threatening based on the sources, tell the user to call 911 or local emergency responders.${hasEvacCenter ? '\n- If the sources recommend evacuation, name the evacuation center from USER CONTEXT.' : ''}
- Reply in ${LOCALE_NAMES[locale]}.
- ${wordLimit}
- Return JSON only. No markdown.
- If status is supported, usedSourceIds must list only sources used in the answer.
- If status is insufficient, answer must be the exact fallback sentence requested by the grounding rules.
- suggestedCommands must only use commands that are relevant and available in the schema.

${formatRagSources(passages)}

${buildUserContextBlock(userContext, riskContext)}User question: ${message}`;
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
      emergency: { type: SchemaType.BOOLEAN },
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

function limitFollowUpQuestions(answer: string, channel: 'chat' | 'sms'): string {
  if (channel === 'sms') return answer;
  const firstQuestion = answer.indexOf('?');
  if (firstQuestion === -1) return answer;

  const before = answer.slice(0, firstQuestion + 1);
  const after = answer.slice(firstQuestion + 1).replace(/[^.?!]*\?/g, '').trim();
  return `${before}${after ? ` ${after}` : ''}`.trim();
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

  const answer = limitFollowUpQuestions(candidate.answer.trim().replace(/\s+/g, ' '), channel);
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

export async function generateStructuredRagReply(
  client: GoogleGenerativeAI,
  message: string,
  locale: Locale,
  passages: CorpusEntry[],
  channel: 'chat' | 'sms',
  userContext?: string,
  riskContext?: RiskContext
): Promise<StructuredRagReply> {
  const model = client.getGenerativeModel({
    model: config.openai.model,
    safetySettings: RAG_SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: buildRagResponseSchema(passages),
    },
  });
  const wordLimit = channel === 'sms' ? 'Under 130 characters.' : 'Under 130 words.';
  const prompt = groundedRagPrompt(message, locale, passages, wordLimit, userContext, riskContext);
  const result = await model.generateContent(prompt);
  return parseAndValidateRagResponse(result.response.text(), passages, locale, channel);
}
