import { randomBytes } from 'crypto';
import type PocketBase from 'pocketbase';
import { computeInaSAFEScore } from './inasafeScore.js';
import { geocodeAddress } from '../integrations/geocoder.js';
import type { HomeType, Locale, RiskTier, UserRecord } from '../types/index.js';

export type SmsSessionState =
  | 'language'
  | 'address'
  | 'household_size'
  | 'vulnerabilities'
  | 'home_type'
  | 'floor'
  | 'complete';

interface SmsTurn {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

interface SmsPartialProfile {
  address?: string;
  lat?: number;
  lng?: number;
  householdSize?: number;
  hasPWD?: boolean;
  hasElderly?: boolean;
  hasInfant?: boolean;
  hasPregnant?: boolean;
  homeType?: HomeType;
  floor?: number;
}

export interface SmsSessionRecord {
  id: string;
  mobile: string;
  userId?: string;
  state: SmsSessionState;
  locale?: Locale;
  partialProfile?: SmsPartialProfile;
  history?: SmsTurn[];
  lastMessageAt?: string;
  collectionName?: 'sms_onboarding_state' | 'sms_sessions';
}

export interface SmsOnboardingResult {
  handled: boolean;
  reply?: string;
  user?: UserRecord | null;
}

const REGISTER_PROMPT = '[MonsoonAI] Register by SMS. Reply 1 English, 2 Filipino, 3 Vietnamese.';
const ADDRESS_PROMPT = '[MonsoonAI] Send your address or barangay/city. Example: Brgy 123, Manila';
const HOUSEHOLD_PROMPT = '[MonsoonAI] How many people live with you? Reply a number, like 4.';
const VULNERABILITY_PROMPT = '[MonsoonAI] Any elderly, baby, pregnant, or PWD? Reply words like ELDERLY BABY or NONE.';
const HOME_TYPE_PROMPT = '[MonsoonAI] Home type? Reply 1 concrete/house, 2 apartment/condo, 3 light materials/nipa.';
const FLOOR_PROMPT = '[MonsoonAI] What floor do you sleep on? Reply 0 ground, 1, 2, 3, or 4.';
const COMPLETE_PROMPT = '[MonsoonAI] Registered. Commands: STATUS, EVAC, FLOOD, HAZE, TEMP, STOP, HELP.';
const fallbackSessions = new Map<string, SmsSessionRecord>();

export function smsText(parts: string[]): string {
  const msg = parts.filter(Boolean).join(' ');
  return msg.length > 155 ? msg.slice(0, 152) + '...' : msg;
}

export function normalizeSmsMobile(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`;

  const digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('09') && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.startsWith('9') && digits.length === 10) return `+63${digits}`;
  if (digits.startsWith('63')) return `+${digits}`;
  return digits ? `+${digits}` : trimmed;
}

function escapePbString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function parseLocale(message: string): Locale | null {
  const normalized = message
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/[１]/g, '1')
    .replace(/[２]/g, '2')
    .replace(/[３]/g, '3');
  const leadingChoice = normalized.match(/^([123])(?:\b|[^a-z0-9])/);
  if (leadingChoice?.[1] === '1') return 'en';
  if (leadingChoice?.[1] === '2') return 'tl';
  if (leadingChoice?.[1] === '3') return 'vi';
  if (['1', 'en', 'english'].includes(normalized)) return 'en';
  if (['2', 'tl', 'filipino', 'tagalog'].includes(normalized)) return 'tl';
  if (['3', 'vi', 'vietnamese'].includes(normalized)) return 'vi';
  return null;
}

function parseLeadingLocaleChoice(message: string): Locale | null {
  const firstChoice = message
    .normalize('NFKC')
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[１]/g, '1')
    .replace(/[２]/g, '2')
    .replace(/[３]/g, '3')
    .match(/[123]/)?.[0];
  if (firstChoice === '1') return 'en';
  if (firstChoice === '2') return 'tl';
  if (firstChoice === '3') return 'vi';
  return null;
}

function parseHouseholdSize(message: string): number | null {
  const value = Number(message.trim());
  return Number.isInteger(value) && value >= 1 && value <= 30 ? value : null;
}

function parseVulnerabilities(message: string): Pick<SmsPartialProfile, 'hasPWD' | 'hasElderly' | 'hasInfant' | 'hasPregnant'> | null {
  const tokens = new Set(message.toUpperCase().split(/[^A-Z]+/).filter(Boolean));
  if (tokens.has('NONE') || tokens.has('NO')) {
    return { hasPWD: false, hasElderly: false, hasInfant: false, hasPregnant: false };
  }

  const hasElderly = tokens.has('ELDERLY') || tokens.has('SENIOR');
  const hasInfant = tokens.has('BABY') || tokens.has('INFANT');
  const hasPregnant = tokens.has('PREGNANT') || tokens.has('BUNTIS');
  const hasPWD = tokens.has('PWD') || tokens.has('DISABLED') || tokens.has('DISABILITY');

  if (!hasElderly && !hasInfant && !hasPregnant && !hasPWD) return null;
  return { hasPWD, hasElderly, hasInfant, hasPregnant };
}

function parseHomeType(message: string): HomeType | null {
  const normalized = message.trim().toLowerCase();
  if (['1', 'house', 'concrete', 'standalone'].includes(normalized)) return 'standalone';
  if (['2', 'apartment', 'condo'].includes(normalized)) return 'apartment';
  if (['3', 'nipa', 'nipa hut', 'light', 'light materials'].includes(normalized)) return 'nipa_hut';
  return null;
}

function parseFloor(message: string): number | null {
  const normalized = message.trim().toLowerCase();
  if (normalized === 'ground') return 0;
  const value = Number(normalized);
  return Number.isInteger(value) && value >= 0 && value <= 10 ? value : null;
}

async function findSession(pb: PocketBase, mobile: string): Promise<SmsSessionRecord | null> {
  const fallback = fallbackSessions.get(mobile);
  if (fallback && fallback.state !== 'complete') return fallback;

  try {
    const result = await pb.collection('sms_onboarding_state').getList<SmsSessionRecord>(1, 1, {
      filter: `mobile="${escapePbString(mobile)}"`,
      sort: '-updated',
    });
    const session = result.items[0] ?? null;
    if (session && session.state !== 'complete') {
      const tagged = { ...session, collectionName: 'sms_onboarding_state' as const };
      fallbackSessions.set(mobile, tagged);
      return tagged;
    }
  } catch {
    // Fall through to the legacy collection for older deployments.
  }

  try {
    const result = await pb.collection('sms_sessions').getList<SmsSessionRecord>(1, 10, {
      filter: `mobile="${escapePbString(mobile)}"`,
      sort: '-created',
    });
    const session = result.items.find(item => item.state !== 'complete') ?? null;
    if (session) {
      const tagged = { ...session, collectionName: 'sms_sessions' as const };
      fallbackSessions.set(mobile, tagged);
      return tagged;
    }
    return null;
  } catch {
    return null;
  }
}

async function createSession(pb: PocketBase, mobile: string): Promise<SmsSessionRecord> {
  const payload = {
    mobile,
    state: 'language',
    partialProfile: {},
    history: [],
    lastMessageAt: new Date().toISOString(),
  } satisfies Omit<SmsSessionRecord, 'id'>;

  try {
    const session = await pb.collection('sms_onboarding_state').create<SmsSessionRecord>(payload);
    const tagged = { ...session, collectionName: 'sms_onboarding_state' as const };
    fallbackSessions.set(mobile, tagged);
    return tagged;
  } catch {
    // Fall back to the legacy collection, then memory if PocketBase is unavailable.
  }

  try {
    const session = await pb.collection('sms_sessions').create<SmsSessionRecord>(payload);
    const tagged = { ...session, collectionName: 'sms_sessions' as const };
    fallbackSessions.set(mobile, tagged);
    return tagged;
  } catch {
    const session: SmsSessionRecord = { id: `memory:${mobile}`, collectionName: 'sms_onboarding_state', ...payload };
    fallbackSessions.set(mobile, session);
    return session;
  }
}

async function getOrCreateSession(pb: PocketBase, mobile: string): Promise<SmsSessionRecord> {
  return (await findSession(pb, mobile)) ?? createSession(pb, mobile);
}

async function updateSession(
  pb: PocketBase,
  session: SmsSessionRecord,
  patch: Partial<SmsSessionRecord>,
  userMessage: string,
  reply: string
): Promise<void> {
  const now = new Date().toISOString();
  const history = [
    ...(session.history ?? []),
    { role: 'user' as const, content: userMessage.trim(), at: now },
    { role: 'assistant' as const, content: reply, at: now },
  ].slice(-6);

  const nextSession: SmsSessionRecord = {
    ...session,
    ...patch,
    history,
    lastMessageAt: now,
  };
  fallbackSessions.set(session.mobile, nextSession);

  if (session.id.startsWith('memory:')) return;

  const collectionName = session.collectionName ?? 'sms_onboarding_state';
  try {
    await pb.collection(collectionName).update(session.id, {
      ...patch,
      history,
      lastMessageAt: now,
    });
  } catch {
    // PocketBase persistence is best-effort during SMS onboarding; fallbackSessions keeps the current flow coherent.
  }
}

function buildSmsUser(mobile: string, locale: Locale, partial: SmsPartialProfile): Omit<UserRecord, 'id' | 'created' | 'updated'> & { password: string; passwordConfirm: string } {
  const password = randomBytes(18).toString('base64url');
  const last4 = mobile.replace(/\D/g, '').slice(-4) || '0000';
  const baseUser = {
    name: `SMS User ${last4}`,
    email: `sms-${mobile.replace(/\D/g, '')}@monsoon.local`,
    mobile,
    password,
    passwordConfirm: password,
    role: 'citizen' as const,
    locale,
    lat: partial.lat ?? 0,
    lng: partial.lng ?? 0,
    address: partial.address ?? 'Philippines',
    homeType: partial.homeType ?? 'standalone',
    floor: partial.floor ?? 1,
    householdSize: partial.householdSize ?? 1,
    hasPWD: partial.hasPWD ?? false,
    hasElderly: partial.hasElderly ?? false,
    hasInfant: partial.hasInfant ?? false,
    hasPregnant: partial.hasPregnant ?? false,
    riskScore: 0,
    riskTier: 'low' as RiskTier,
    isOnRescueList: false,
    alertOptIn: true,
    smsOptIn: true,
  };

  const risk = computeInaSAFEScore({
    ...baseUser,
    id: 'sms-onboarding-preview',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  } as UserRecord);
  return { ...baseUser, riskScore: risk.score, riskTier: risk.tier };
}

async function createSmsUser(pb: PocketBase, mobile: string, locale: Locale, partial: SmsPartialProfile): Promise<UserRecord> {
  return pb.collection('users').create<UserRecord>(buildSmsUser(mobile, locale, partial));
}

export async function handleSmsOnboarding(
  pb: PocketBase,
  mobile: string,
  message: string,
  user: UserRecord | null
): Promise<SmsOnboardingResult> {
  const normalizedMessage = message.trim();
  const keyword = normalizedMessage.toUpperCase().split(/\s+/)[0] ?? '';

  if (keyword === 'CANCEL') {
    const session = await findSession(pb, mobile);
    if (session) {
      if (!session.id.startsWith('memory:')) {
        await pb.collection(session.collectionName ?? 'sms_onboarding_state').update(session.id, {
          state: 'complete',
          lastMessageAt: new Date().toISOString(),
        });
      }
      fallbackSessions.set(mobile, { ...session, state: 'complete', lastMessageAt: new Date().toISOString() });
    }
    return { handled: true, reply: '[MonsoonAI] SMS registration cancelled. Reply JOIN to start again.', user };
  }

  const activeSession = await findSession(pb, mobile);
  if (!activeSession && user) {
    if (['JOIN', 'REGISTER'].includes(keyword)) {
      return { handled: true, reply: '[MonsoonAI] You are already registered. Reply STATUS, EVAC, or HELP.', user };
    }
    return { handled: false, user };
  }

  const localeReplyWithoutSession = parseLocale(normalizedMessage) ?? parseLeadingLocaleChoice(normalizedMessage);

  if (!activeSession && !['JOIN', 'START', 'REGISTER'].includes(keyword) && !localeReplyWithoutSession) {
    if (keyword === 'STATUS') {
      return { handled: true, reply: '[MonsoonAI] Not registered yet. Reply JOIN to register by SMS.', user };
    }
    if (keyword === 'EVAC') {
      return { handled: true, reply: '[MonsoonAI] Reply JOIN to register by SMS and save your nearest evac info.', user };
    }
    return { handled: false, user };
  }

  const session = activeSession ?? await getOrCreateSession(pb, mobile);
  let reply: string;
  let patch: Partial<SmsSessionRecord> = {};
  let createdUser: UserRecord | null = user;
  const partial = session.partialProfile ?? {};
  const locale = session.locale ?? 'en';

  if (!activeSession && ['JOIN', 'START', 'REGISTER'].includes(keyword)) {
    reply = REGISTER_PROMPT;
    await updateSession(pb, session, {}, normalizedMessage, reply);
    return { handled: true, reply, user };
  }

  if ((!activeSession || session.state === 'language') && localeReplyWithoutSession) {
    reply = ADDRESS_PROMPT;
    await updateSession(pb, session, { state: 'address', locale: localeReplyWithoutSession }, normalizedMessage, reply);
    return { handled: true, reply, user };
  }

  switch (session.state) {
    case 'language': {
      const parsed = parseLocale(normalizedMessage) ?? parseLeadingLocaleChoice(normalizedMessage);
      if (!parsed) {
        reply = REGISTER_PROMPT;
        break;
      }
      reply = ADDRESS_PROMPT;
      patch = { state: 'address', locale: parsed };
      break;
    }

    case 'address': {
      const address = normalizedMessage.slice(0, 120);
      const geocoded = await geocodeAddress(address);
      reply = HOUSEHOLD_PROMPT;
      patch = {
        state: 'household_size',
        partialProfile: {
          ...partial,
          address,
          ...(geocoded ? { lat: geocoded.lat, lng: geocoded.lng } : {}),
        },
      };
      break;
    }

    case 'household_size': {
      const householdSize = parseHouseholdSize(normalizedMessage);
      if (!householdSize) {
        reply = '[MonsoonAI] Please reply with number of people in your home, like 4.';
        break;
      }
      reply = VULNERABILITY_PROMPT;
      patch = { state: 'vulnerabilities', partialProfile: { ...partial, householdSize } };
      break;
    }

    case 'vulnerabilities': {
      const vulnerabilities = parseVulnerabilities(normalizedMessage);
      if (!vulnerabilities) {
        reply = '[MonsoonAI] Reply ELDERLY, BABY, PREGNANT, PWD, or NONE.';
        break;
      }
      reply = HOME_TYPE_PROMPT;
      patch = { state: 'home_type', partialProfile: { ...partial, ...vulnerabilities } };
      break;
    }

    case 'home_type': {
      const homeType = parseHomeType(normalizedMessage);
      if (!homeType) {
        reply = '[MonsoonAI] Reply 1 house, 2 apartment/condo, or 3 light materials/nipa.';
        break;
      }
      reply = FLOOR_PROMPT;
      patch = { state: 'floor', partialProfile: { ...partial, homeType } };
      break;
    }

    case 'floor': {
      const floor = parseFloor(normalizedMessage);
      if (floor === null) {
        reply = '[MonsoonAI] Reply with floor number. Use 0 for ground floor.';
        break;
      }
      const finalProfile = { ...partial, floor };
      createdUser = await createSmsUser(pb, mobile, locale, finalProfile);
      reply = COMPLETE_PROMPT;
      patch = {
        state: 'complete',
        userId: createdUser.id,
        partialProfile: finalProfile,
      };
      break;
    }

    case 'complete':
      return { handled: false, user };

    default:
      reply = REGISTER_PROMPT;
  }

  await updateSession(pb, session, patch, normalizedMessage, reply);
  return { handled: true, reply, user: createdUser };
}
