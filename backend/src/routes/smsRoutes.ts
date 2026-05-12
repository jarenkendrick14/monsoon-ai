import { Router } from 'express';
import { config } from '../config.js';
import { getPb } from '../pb.js';
import { isHttpSmsWebhook, normalizeInboundSms, sendSms, verifyHttpSmsWebhook } from '../integrations/sms.js';
import { getLocalizedConditions } from '../utils/localConditions.js';
import { findNearestCenterNear, distanceKm } from '../integrations/evacCenters.js';
import { smsWebhookLimiter } from '../middleware/rateLimiter.js';
import { getTropomiData } from '../integrations/tropomi.js';
import { smsReply } from '../integrations/gemini.js';
import { handleSmsOnboarding, normalizeSmsMobile, smsText } from '../engine/smsOnboarding.js';
import { applyDisasterContext, disasterConditions, DISASTER_SCENARIO } from '../utils/disasterMode.js';
import type { UserRecord, AlertRecord, AlertLevel, RiskContext, Locale } from '../types/index.js';

const router = Router();

// Hard cap at 155 chars — standard SMS is 160, 5-char buffer for carrier headers
const sms = smsText;
const SMS_BUILD_ID = 'sms-disaster-mode-v7';

interface SmsSituationRecord {
  id: string;
  mobile: string;
  userId?: string;
  situation?: RiskContext['situation'];
  history?: { role: 'user' | 'assistant'; content: string; at: string }[];
  lastMessageAt?: string;
}

function escapePbString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function findSmsUser(mobile: string, originalMobile: string): Promise<UserRecord | null> {
  const pb = getPb();
  const candidates = Array.from(new Set([mobile, originalMobile].filter(Boolean)));

  for (const candidate of candidates) {
    try {
      const result = await pb.collection('users').getList<UserRecord>(1, 1, {
        filter: `mobile="${escapePbString(candidate)}"`,
      });
      if (result.items[0]) return result.items[0];
    } catch { /* unknown sender */ }
  }

  return null;
}

async function findSmsSituation(pb: ReturnType<typeof getPb>, mobile: string): Promise<SmsSituationRecord | null> {
  try {
    const result = await pb.collection('sms_situations').getList<SmsSituationRecord>(1, 1, {
      filter: `mobile="${escapePbString(mobile)}"`,
      sort: '-updated',
    });
    return result.items[0] ?? null;
  } catch {
    return null;
  }
}

function blankSituation(): NonNullable<RiskContext['situation']> {
  return {
    companions: [],
    needs: [],
    absent: [],
    profileFlagsNotPresent: false,
    waterLevel: null,
    canLeaveSafely: null,
    notes: [],
  };
}

function normalizeSituation(value: RiskContext['situation']): NonNullable<RiskContext['situation']> {
  return {
    ...blankSituation(),
    ...(value ?? {}),
    companions: Array.isArray(value?.companions) ? value.companions.slice(0, 8) : [],
    needs: Array.isArray(value?.needs) ? value.needs.slice(0, 8) : [],
    absent: Array.isArray(value?.absent) ? value.absent.slice(0, 8) : [],
    notes: Array.isArray(value?.notes) ? value.notes.slice(-6) : [],
  };
}

function addUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function updateSituationFromSms(current: RiskContext['situation'], rawMessage: string): NonNullable<RiskContext['situation']> {
  const ctx = normalizeSituation(current);
  const lower = rawMessage.toLowerCase();

  if (/\b(grandma|grandmother|lola|elderly|senior)\b/.test(lower)) addUnique(ctx.companions!, 'elderly family member');
  if (/\b(dad|father|mom|mother|parent|parents)\b/.test(lower)) addUnique(ctx.companions!, 'parent/adult family member');
  if (/\b(cousin|sibling|brother|sister|uncle|aunt)\b/.test(lower)) addUnique(ctx.companions!, 'other family member');
  if (/\b(neighbor|neighbour)\b/.test(lower)) addUnique(ctx.companions!, 'neighbor');
  if (/\b(dog|cat|pet)\b/.test(lower)) addUnique(ctx.companions!, 'pet');
  if (/\b(baby|infant|newborn)\b/.test(lower)) addUnique(ctx.companions!, 'baby/infant');
  if (/\b(child|kid|children)\b/.test(lower)) addUnique(ctx.companions!, 'child');

  if (/\b(pwd|disabled|wheelchair|mobility)\b/.test(lower)) addUnique(ctx.needs!, 'wheelchair or mobility assistance');
  if (/\b(diabetes|diabetic|insulin|maintenance meds?|medicine|medication|meds)\b/.test(lower)) addUnique(ctx.needs!, 'essential medicines');
  if (/\b(power bank|charger|phone)\b/.test(lower)) addUnique(ctx.needs!, 'phone and charging supplies');
  if (/\b(cannot walk|can't walk|cant walk)\b/.test(lower)) addUnique(ctx.needs!, 'walking assistance');

  const waterMatch = lower.match(/\b(ankle|knee|waist|chest)\s*[- ]?(deep|level)?\b|water (?:is |level is |about )([^.,;]+)/);
  if (waterMatch) ctx.waterLevel = waterMatch[0].trim();
  if (/\b(yes|can leave|able to leave|we can leave|safe to leave)\b/.test(lower)) ctx.canLeaveSafely = 'yes';
  if (/\b(no|cannot leave|can't leave|cant leave|trapped|stuck|not safe to leave)\b/.test(lower)) ctx.canLeaveSafely = 'no';

  if (/\b(they|grandma|grandmother|lola|child|kid|baby|pwd|wheelchair|mobility)\b.*\b(not with us|not here|aren't with us|are not with us|isn't with us|is not with us|elsewhere|away)\b/.test(lower)
    || /\b(not with us|not here|aren't with us|are not with us|isn't with us|is not with us)\b/.test(lower)) {
    ctx.profileFlagsNotPresent = true;
    addUnique(ctx.absent!, 'saved vulnerable household members are not currently with user');
  }

  if (rawMessage.trim()) ctx.notes = [...(ctx.notes ?? []), rawMessage.trim().slice(0, 140)].slice(-6);
  return ctx;
}

async function saveSmsSituation(
  pb: ReturnType<typeof getPb>,
  mobile: string,
  user: UserRecord | null,
  existing: SmsSituationRecord | null,
  situation: RiskContext['situation'],
  userMessage: string,
  reply: string
): Promise<void> {
  const now = new Date().toISOString();
  const history = [
    ...(existing?.history ?? []),
    { role: 'user' as const, content: userMessage.trim().slice(0, 180), at: now },
    { role: 'assistant' as const, content: reply.slice(0, 180), at: now },
  ].slice(-8);
  const payload = { mobile, userId: user?.id ?? existing?.userId ?? '', situation, history, lastMessageAt: now };
  if (existing) await pb.collection('sms_situations').update(existing.id, payload);
  else await pb.collection('sms_situations').create(payload);
}

function hasCompanionSignal(message: string): boolean {
  return /\b(dad|father|mom|mother|grandma|grandmother|lola|grandpa|lolo|cousin|brother|sister|neighbor|neighbour|baby|infant|child|kid|dog|cat|pet)\b/i.test(message);
}

function smsChecklist(context: RiskContext): string {
  const items = ['IDs/docs', 'meds', 'water/food', 'phone/charger'];
  if (context.situation?.needs?.some(n => /wheelchair|mobility/i.test(n))) items.unshift('mobility aid');
  if (context.situation?.companions?.some(c => /pet/i.test(c))) items.push('pet leash/carrier');
  if (context.situation?.profileFlagsNotPresent) items.push('text absent family');
  return sms([`[MonsoonAI] Checklist: ${items.slice(0, 6).join(', ')}. Avoid floodwater. Reply EVAC for route.`]);
}

export function isSmsDisasterModeEnabled(): boolean {
  return config.sms.disasterMode === 'critical';
}

export function smsCriticalStatusReply(context: RiskContext): string {
  const center = context.evacCenter?.name ?? 'nearest evac center';
  const rainfall = context.conditions?.rainfall ?? DISASTER_SCENARIO.rainfall24h;
  const river = context.conditions?.riverLevel ?? DISASTER_SCENARIO.riverLevel;
  return sms([
    `[MonsoonAI] CRITICAL FLOOD: ${rainfall}mm/24h rain, river ${river}m, Signal #${DISASTER_SCENARIO.signal}.`,
    `Go to ${center}. Reply CHECKLIST.`,
  ]);
}

function statefulSmsReply(message: string, context: RiskContext): string | null {
  const active = context.alertLevel === 'critical' || context.alertLevel === 'high';
  if (!active) return null;
  const lower = message.toLowerCase();
  const center = context.evacCenter ? context.evacCenter.name : 'nearest evac center';

  if (context.situation?.profileFlagsNotPresent && /\b(not with us|not here|elsewhere|away)\b/.test(lower)) {
    return sms(['[MonsoonAI] Got it. Evacuate people/pets with you now.', 'If safe, text/call absent vulnerable family and share alert. Call responders if at risk.']);
  }
  if (/\b(checklist|pack|bring)\b/.test(lower)) return smsChecklist(context);
  if (hasCompanionSignal(message)) {
    return sms([`[MonsoonAI] Got it. Keep everyone/pets together. Go to ${center}.`, 'Can everyone leave safely? Reply YES or NO.']);
  }
  if (context.situation?.canLeaveSafely === 'yes' && /\b(yes|can leave|able to leave|safe to leave)\b/.test(lower)) {
    return sms([`[MonsoonAI] Good. Leave now for ${center}.`, 'Bring IDs, meds, water, phone/charger. Avoid floodwater.']);
  }
  if (context.situation?.canLeaveSafely === 'no' && /\b(no|trapped|stuck|cannot leave|can't leave|cant leave)\b/.test(lower)) {
    return sms(['[MonsoonAI] Stay high and visible. Call 911/barangay now.', 'Share location. Avoid floodwater and wires.']);
  }
  return null;
}

async function buildSmsContext(
  pb: ReturnType<typeof getPb>,
  user: UserRecord | null,
  situation?: RiskContext['situation'],
  disasterMode = false
): Promise<RiskContext> {
  let alertLevel: AlertLevel = 'none';
  let trigger: AlertRecord['type'] | null = null;
  try {
    const alerts = user
      ? await pb.collection('alerts').getList<AlertRecord>(1, 1, {
        filter: `userId="${escapePbString(user.id)}" && resolved=false`,
      })
      : { items: [] as AlertRecord[] };
    alertLevel = alerts.items[0]?.level ?? 'none';
    trigger = alerts.items[0]?.type ?? null;
  } catch { /* no alerts */ }

  const center = (user?.lat && user?.lng) ? await findNearestCenterNear(user.lat, user.lng) : null;
  const conditions = user?.lat && user?.lng
    ? await getLocalizedConditions(user.lat, user.lng)
    : null;
  const context: RiskContext = {
    alertLevel,
    trigger,
    location: user?.address || 'Philippines',
    household: user ? {
      homeType: user.homeType,
      floor: user.floor,
      householdSize: user.householdSize,
      hasPWD: user.hasPWD,
      hasElderly: user.hasElderly,
      hasInfant: user.hasInfant,
      hasPregnant: user.hasPregnant,
      riskTier: user.riskTier,
      isOnRescueList: user.isOnRescueList,
    } : null,
    situation: situation ?? null,
    evacCenter: center && user?.lat && user?.lng ? {
      name: center.name,
      address: center.address,
      distKm: distanceKm(user.lat, user.lng, center.lat, center.lng).toFixed(1),
    } : null,
    conditions: conditions ? {
      heatIndex: conditions.heatIndex,
      airQuality: conditions.airQuality,
      riverLevel: conditions.riverLevel,
      rainfall: conditions.rainfall,
      forecast7day: [],
    } : null,
  };
  return disasterMode ? applyDisasterContext(context) : context;
}

router.post('/api/sms/inbound', smsWebhookLimiter, async (req, res) => {
  if (isHttpSmsWebhook(req.body) && !verifyHttpSmsWebhook(req)) {
    res.status(401).json({ error: 'Invalid httpSMS webhook signature' });
    return;
  }

  const inbound = normalizeInboundSms(req.body);
  if (!inbound.shouldProcess) {
    res.status(200).json({ success: true, ignored: inbound.eventType ?? 'unknown' });
    return;
  }

  const originalFrom = inbound.from;
  const from = normalizeSmsMobile(originalFrom);
  const rawMessage = inbound.message;
  if (!from || !rawMessage.trim()) {
    res.status(400).json({ error: 'Missing SMS sender or message' });
    return;
  }

  const keyword = rawMessage.trim().toUpperCase().split(/\s+/)[0];

  res.status(200).json({ success: true });

  let reply: string;

  try {
    const pb = getPb();
    let user: UserRecord | null = await findSmsUser(from, originalFrom);
    const smsDisasterMode = isSmsDisasterModeEnabled();

    if (keyword === 'STOP') {
      if (user) await getPb().collection('users').update(user.id, { smsOptIn: false });
      reply = sms(['[MonsoonAI] Unsubscribed from alerts. Reply START to re-subscribe. Emergencies: call 911.']);
      if (from) await sendSms(from, reply);
      return;
    }

    if (['VERSION', 'DEBUG', 'PING'].includes(keyword)) {
      reply = sms([`[MonsoonAI] ${SMS_BUILD_ID}. Disaster=${isSmsDisasterModeEnabled() ? 'critical' : 'off'}. Reply JOIN to register.`]);
      if (from) await sendSms(from, reply);
      return;
    }

    const onboarding = await handleSmsOnboarding(pb, from, rawMessage, user);
    if (onboarding.handled) {
      if (onboarding.user) user = onboarding.user;
      reply = onboarding.reply ?? '[MonsoonAI] Reply HELP for commands.';
      if (from) await sendSms(from, reply);
      return;
    }

    const situationRecord = await findSmsSituation(pb, from);
    const situation = updateSituationFromSms(situationRecord?.situation, rawMessage);

    switch (keyword) {
      case 'ASK': {
        const question = rawMessage.trim().replace(/^ASK\b/i, '').trim();
        if (!question) {
          reply = sms(['[MonsoonAI] Text ASK plus your question. Example: ASK what to do after a flood?']);
          break;
        }
        const context = await buildSmsContext(pb, user, situation, smsDisasterMode);
        const stateReply = statefulSmsReply(question, context);
        if (stateReply) {
          reply = stateReply;
          break;
        }
        const locale: Locale = (user?.locale as Locale) ?? 'en';
        reply = await smsReply(question, locale, context);
        break;
      }

      case 'STATUS': {
        if (!user) {
          reply = sms(['[MonsoonAI] Not registered yet. Reply JOIN to register by SMS.']);
          break;
        }
        const context = await buildSmsContext(pb, user, situation, smsDisasterMode);
        if (context.alertLevel === 'critical' || context.alertLevel === 'high') {
          reply = smsCriticalStatusReply(context);
          break;
        }
        let alerts;
        try {
          alerts = await pb.collection('alerts').getList<AlertRecord>(1, 1, {
            filter: `userId="${user.id}" && resolved=false`,
          });
        } catch { alerts = { items: [] }; }

        const alert = alerts.items[0];
        if (alert) {
          const center = (user.lat && user.lng) ? await findNearestCenterNear(user.lat, user.lng) : null;
          const evacInfo = center && user.lat && user.lng
            ? `Go to: ${center.name} (${distanceKm(user.lat, user.lng, center.lat, center.lng).toFixed(1)}km).`
            : 'Contact barangay hall for evac center.';
          reply = sms([`[MonsoonAI] ${alert.level.toUpperCase()} ALERT. Evac in ${alert.evacuateWithin}min.`, evacInfo, 'Call 911. Reply EVAC for route.']);
        } else {
          reply = sms(['[MonsoonAI] No active alerts. Stay prepared. Reply HELP for commands.']);
        }
        break;
      }

      case 'EVAC': {
        if (!user) {
          reply = sms(['[MonsoonAI] Reply JOIN to register by SMS and save your nearest evac info.']);
          break;
        }
        const center = (user.lat && user.lng) ? await findNearestCenterNear(user.lat, user.lng) : null;
        if (center && user.lat && user.lng) {
          const dist = distanceKm(user.lat, user.lng, center.lat, center.lng);
          const eta = Math.ceil((dist / 4.0) * 60);
          reply = sms([`[MonsoonAI] Nearest evac: ${center.name}, ${center.address}.`, `~${dist.toFixed(1)}km, ${eta}min walk. Call 911 for rescue.`]);
        } else {
          reply = sms(['[MonsoonAI] Go to nearest barangay hall or high ground. Call 911 for rescue.']);
        }
        break;
      }

      case 'CHECKLIST': {
        const context = await buildSmsContext(pb, user, situation, smsDisasterMode);
        reply = smsChecklist(context);
        break;
      }

      case 'FLOOD': {
        const cond = smsDisasterMode ? disasterConditions() : await getLocalizedConditions(user?.lat, user?.lng);
        const status = cond.glofasCritical ? 'CRITICAL river discharge!' : cond.riverLevel >= 2.0 ? 'River level HIGH.' : 'River level normal.';
        reply = sms([`[MonsoonAI] Rain: ${cond.rainfall}mm. River: ${cond.riverLevel}m.`, status, 'Reply EVAC if flooding.']);
        break;
      }

      case 'HAZE': {
        const tropomi = getTropomiData();
        const cond = await getLocalizedConditions(user?.lat, user?.lng);
        const aqiStatus = cond.airQuality >= 150 ? 'UNHEALTHY - stay indoors, use N95.' : cond.airQuality >= 100 ? 'Sensitive groups avoid outdoors.' : 'Air quality acceptable.';
        reply = sms([`[MonsoonAI] AQI: ${cond.airQuality}. AOD: ${tropomi.aerosolOpticalDepth}.`, aqiStatus]);
        break;
      }

      case 'TEMP': {
        const cond = await getLocalizedConditions(user?.lat, user?.lng);
        const cat = cond.heatIndex >= 42 ? 'DANGER - limit outdoors, hydrate.' : cond.heatIndex >= 33 ? 'CAUTION - rest often, drink water.' : 'Safe. Stay hydrated.';
        reply = sms([`[MonsoonAI] Heat index: ${cond.heatIndex}C.`, cat]);
        break;
      }

      case 'HELP': {
        reply = sms(['[MonsoonAI] Commands: JOIN, ASK, STATUS, EVAC, CHECKLIST, FLOOD, HAZE, TEMP, STOP, START. Call 911 for emergencies.']);
        break;
      }

      case 'START': {
        if (user) await getPb().collection('users').update(user.id, { smsOptIn: true });
        reply = sms(['[MonsoonAI] Subscribed to alerts. Reply HELP for commands. Reply STOP to unsubscribe.']);
        break;
      }

      default: {
        // Unknown keyword — try RAG + LLM
        const context = await buildSmsContext(pb, user, situation, smsDisasterMode);

        const locale: Locale = (user?.locale as Locale) ?? 'en';
        reply = statefulSmsReply(rawMessage.trim(), context) ?? await smsReply(rawMessage.trim(), locale, context);
      }
    }
    try {
      await saveSmsSituation(pb, from, user, situationRecord, situation, rawMessage, reply);
    } catch { /* situation state is best-effort */ }
  } catch {
    reply = '[MonsoonAI] Service unavailable. Call 911 for emergencies.';
  }

  if (from) await sendSms(from, reply);
});

export default router;
