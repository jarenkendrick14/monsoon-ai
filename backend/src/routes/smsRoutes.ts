import { Router } from 'express';
import { getPb } from '../pb.js';
import { isHttpSmsWebhook, normalizeInboundSms, sendSms, verifyHttpSmsWebhook } from '../integrations/sms.js';
import { getCurrentConditions } from '../utils/conditionsCache.js';
import { findNearestCenter, distanceKm } from '../integrations/evacCenters.js';
import { smsWebhookLimiter } from '../middleware/rateLimiter.js';
import { getTropomiData } from '../integrations/tropomi.js';
import { smsReply } from '../integrations/gemini.js';
import type { UserRecord, AlertRecord, AlertLevel, RiskContext, Locale } from '../types/index.js';

const router = Router();

// Hard cap at 155 chars — standard SMS is 160, 5-char buffer for carrier headers
function sms(parts: string[]): string {
  const msg = parts.filter(Boolean).join(' ');
  return msg.length > 155 ? msg.slice(0, 152) + '...' : msg;
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

  const from = inbound.from;
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
    let user: UserRecord | null = null;

    try {
      const result = await pb.collection('users').getList<UserRecord>(1, 1, {
        filter: `mobile="${from}"`,
      });
      user = result.items[0] ?? null;
    } catch { /* unknown sender */ }

    switch (keyword) {
      case 'STATUS': {
        if (!user) {
          reply = sms(['[MonsoonAI] Not registered yet. Register in the app to get risk status. Reply HELP for commands.']);
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
          const center = (user.lat && user.lng) ? findNearestCenter(user.lat, user.lng) : null;
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
          reply = sms(['[MonsoonAI] Not registered yet. Register in the app to find your evac center.']);
          break;
        }
        const center = (user.lat && user.lng) ? findNearestCenter(user.lat, user.lng) : null;
        if (center && user.lat && user.lng) {
          const dist = distanceKm(user.lat, user.lng, center.lat, center.lng);
          const eta = Math.ceil((dist / 4.0) * 60);
          reply = sms([`[MonsoonAI] Nearest evac: ${center.name}, ${center.address}.`, `~${dist.toFixed(1)}km, ${eta}min walk. Call 911 for rescue.`]);
        } else {
          reply = sms(['[MonsoonAI] Go to nearest barangay hall or high ground. Call 911 for rescue.']);
        }
        break;
      }

      case 'FLOOD': {
        const cond = await getCurrentConditions();
        const status = cond.glofasCritical ? 'CRITICAL river discharge!' : cond.riverLevel >= 2.0 ? 'River level HIGH.' : 'River level normal.';
        reply = sms([`[MonsoonAI] Rain: ${cond.rainfall}mm. River: ${cond.riverLevel}m.`, status, 'Reply EVAC if flooding.']);
        break;
      }

      case 'HAZE': {
        const tropomi = getTropomiData();
        const cond = await getCurrentConditions();
        const aqiStatus = cond.airQuality >= 150 ? 'UNHEALTHY - stay indoors, use N95.' : cond.airQuality >= 100 ? 'Sensitive groups avoid outdoors.' : 'Air quality acceptable.';
        reply = sms([`[MonsoonAI] AQI: ${cond.airQuality}. AOD: ${tropomi.aerosolOpticalDepth}.`, aqiStatus]);
        break;
      }

      case 'TEMP': {
        const cond = await getCurrentConditions();
        const cat = cond.heatIndex >= 42 ? 'DANGER - limit outdoors, hydrate.' : cond.heatIndex >= 33 ? 'CAUTION - rest often, drink water.' : 'Safe. Stay hydrated.';
        reply = sms([`[MonsoonAI] Heat index: ${cond.heatIndex}C.`, cat]);
        break;
      }

      case 'HELP': {
        reply = sms(['[MonsoonAI] Commands: STATUS, EVAC, FLOOD, HAZE, TEMP, STOP, START. Emergencies: call 911.']);
        break;
      }

      case 'STOP': {
        if (user) await getPb().collection('users').update(user.id, { smsOptIn: false });
        reply = sms(['[MonsoonAI] Unsubscribed from alerts. Reply START to re-subscribe. Emergencies: call 911.']);
        break;
      }

      case 'START': {
        if (user) await getPb().collection('users').update(user.id, { smsOptIn: true });
        reply = sms(['[MonsoonAI] Subscribed to alerts. Reply HELP for commands. Reply STOP to unsubscribe.']);
        break;
      }

      default: {
        // Unknown keyword — try RAG + LLM
        let alertLevel: AlertLevel = 'none';
        try {
          const alerts = await pb.collection('alerts').getList<AlertRecord>(1, 1, {
            filter: user ? `userId="${user.id}" && resolved=false` : 'resolved=false',
          });
          alertLevel = alerts.items[0]?.level ?? 'none';
        } catch { /* no alerts */ }

        const center = (user?.lat && user?.lng) ? findNearestCenter(user.lat, user.lng) : null;
        const context: RiskContext = {
          alertLevel,
          trigger: null,
          location: user?.address || 'Philippines',
          evacCenter: center && user?.lat && user?.lng ? {
            name: center.name,
            address: center.address,
            distKm: distanceKm(user.lat, user.lng, center.lat, center.lng).toFixed(1),
          } : null,
        };

        const locale: Locale = (user?.locale as Locale) ?? 'en';
        reply = await smsReply(rawMessage.trim(), locale, context);
      }
    }
  } catch {
    reply = '[MonsoonAI] Service unavailable. Call 911 for emergencies.';
  }

  if (from) await sendSms(from, reply);
});

export default router;
