import { Router } from 'express';
import { getPb } from '../pb.js';
import { sendSms } from '../integrations/semaphore.js';
import { getCurrentConditions } from '../utils/conditionsCache.js';
import { findNearestCenter, distanceKm } from '../integrations/evacCenters.js';
import { smsWebhookLimiter } from '../middleware/rateLimiter.js';
import { getTropomiData } from '../integrations/tropomi.js';
import type { UserRecord, AlertRecord } from '../types/index.js';

const router = Router();

// Semaphore inbound webhook — POSTs JSON: { from, message, to, network, received_at }
router.post('/api/sms/inbound', smsWebhookLimiter, async (req, res) => {
  const body = req.body as Record<string, string>;
  const from: string = body['from'] ?? body['From'] ?? '';
  const rawMessage: string = body['message'] ?? body['Body'] ?? '';
  const keyword = rawMessage.trim().toUpperCase().split(/\s+/)[0];

  // Acknowledge immediately — Semaphore doesn't read the response body
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
        if (!user) { reply = 'Register at monsoon-ai.app to get your risk status.'; break; }
        const alerts = await pb.collection('alerts').getList<AlertRecord>(1, 1, {
          filter: `userId="${user.id}" && resolved=false`,
        });
        const alert = alerts.items[0];
        reply = alert
          ? `Alert: ${alert.level.toUpperCase()} - ${alert.type?.replace(/_/g, ' ')}. Evacuate within ${alert.evacuateWithin} min.`
          : 'No active alerts for your area. Stay prepared. Reply HELP for commands.';
        break;
      }

      case 'EVAC': {
        if (!user) { reply = 'Register at monsoon-ai.app to find your evac center.'; break; }
        const center = findNearestCenter(user.lat, user.lng);
        if (center) {
          const dist = distanceKm(user.lat, user.lng, center.lat, center.lng);
          reply = `Nearest evac: ${center.name}, ${center.address}. ~${dist.toFixed(1)}km away.`;
        } else {
          reply = 'Go to your nearest barangay hall or high ground. Call 911 for emergency rescue.';
        }
        break;
      }

      case 'FLOOD': {
        const cond = await getCurrentConditions();
        reply = `Rainfall: ${cond.rainfall}mm. River level: ${cond.riverLevel}m. ${cond.glofasCritical ? 'CRITICAL river discharge detected!' : 'River levels normal.'}`;
        break;
      }

      case 'HAZE': {
        const tropomi = getTropomiData();
        reply = `Air quality AOD: ${tropomi.aerosolOpticalDepth}. ${tropomi.smokeCritical ? 'CRITICAL smoke - stay indoors, use N95.' : 'Air quality acceptable.'}`;
        break;
      }

      case 'TEMP': {
        const cond = await getCurrentConditions();
        const cat = cond.heatIndex >= 42 ? 'DANGER' : cond.heatIndex >= 33 ? 'Caution' : 'Safe';
        reply = `Heat index: ${cond.heatIndex}C (${cat}). Stay hydrated, avoid midday sun.`;
        break;
      }

      case 'HELP': {
        reply = 'MonsoonAI commands: STATUS, EVAC, FLOOD, HAZE, TEMP, STOP, START. Call 911 for emergencies.';
        break;
      }

      case 'STOP': {
        if (user) await getPb().collection('users').update(user.id, { smsOptIn: false });
        reply = 'You have unsubscribed from MonsoonAI alerts. Reply START to re-subscribe.';
        break;
      }

      case 'START': {
        if (user) await getPb().collection('users').update(user.id, { smsOptIn: true });
        reply = 'You are now subscribed to MonsoonAI alerts. Reply HELP for commands. Reply STOP to unsubscribe.';
        break;
      }

      default: {
        reply = 'Unknown command. Reply HELP for available commands.';
      }
    }
  } catch {
    reply = 'Service temporarily unavailable. Call 911 for emergencies.';
  }

  // Send reply via Semaphore outbound
  if (from) await sendSms(from, reply);
});

export default router;
