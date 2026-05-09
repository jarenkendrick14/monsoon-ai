import { getPb } from '../pb.js';
import { evaluateRisk } from '../engine/riskEngine.js';
import { getCondition } from '../utils/conditionsCache.js';
import { broadcastAlert } from '../ws.js';
import { logger } from '../utils/logger.js';
import type { ConditionsSnapshot, UserRecord } from '../types/index.js';
import type { OpenMeteoData } from '../integrations/openmeteo.js';
import type { PagasaData } from '../integrations/pagasa.js';
import type { FirmsHotspot } from '../integrations/firms.js';
import { getTropomiData } from '../integrations/tropomi.js';
import { countHotspotsNear } from '../integrations/firms.js';
import { sendSms } from '../integrations/semaphore.js';
import { findNearestCenter, distanceKm } from '../integrations/evacCenters.js';

export async function runRiskEval(): Promise<void> {
  logger.info('Running riskEval job');
  const pb = getPb();

  try {
    const weather = await getCondition<OpenMeteoData>('weather');
    const pagasa = await getCondition<PagasaData>('pagasa');
    const firms = await getCondition<FirmsHotspot[]>('firms') ?? [];
    const cachedConditions = await getCondition<{ airQuality: number; riverDischarge: number; glofasCritical: boolean }>('conditions');
    const tropomi = getTropomiData();

    const allUsers = await pb.collection('users').getFullList<UserRecord>();
    const users = allUsers.filter(u => u.alertOptIn !== false);

    for (const user of users) {
      try {
        const firePts = countHotspotsNear(firms, user.lat, user.lng);

        const conditions: ConditionsSnapshot = {
          rainfall: weather?.rainfall ?? 0,
          heatIndex: weather?.heatIndex ?? 32,
          airQuality: cachedConditions?.airQuality ?? 50,
          riverLevel: cachedConditions?.riverDischarge ?? 1.2,
          aerosolOpticalDepth: tropomi.aerosolOpticalDepth,
          firePts,
          pagasaSignal: pagasa?.signal ?? 0,
          glofasCritical: cachedConditions?.glofasCritical ?? false,
          fetchedAt: new Date().toISOString(),
        };

        const result = evaluateRisk({ user, conditions });

        if (result.trigger) {
          const reEvalAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

          const existing = await pb.collection('alerts').getList(1, 1, {
            filter: `userId="${user.id}" && resolved=false`,
          });

          if (existing.items.length === 0) {
            await pb.collection('alerts').create({
              userId: user.id,
              level: result.level,
              type: result.trigger,
              rainfall: conditions.rainfall,
              floodZone: '',
              riverDischarge: cachedConditions?.riverDischarge ?? 0,
              evacuateWithin: result.evacuateWithin,
              reasons: result.reasons,
              checklist: result.checklist,
              issuedAt: new Date().toISOString(),
              reEvalAt,
              resolved: false,
            });

            if (user.smsOptIn && user.mobile) {
              const center = (user.lat && user.lng) ? findNearestCenter(user.lat, user.lng) : null;
              const evacInfo = center && user.lat && user.lng
                ? `Go to: ${center.name} (${distanceKm(user.lat, user.lng, center.lat, center.lng).toFixed(1)}km).`
                : 'Contact barangay hall for evac center.';
              const msg = `[MonsoonAI] ${result.level.toUpperCase()} ALERT: ${result.trigger?.replace(/_/g, ' ')}. Evac in ${result.evacuateWithin}min. ${evacInfo} Call 911.`;
              await sendSms(user.mobile, msg.length > 155 ? msg.slice(0, 152) + '...' : msg);
            }
          }

          broadcastAlert(user.id, {
            type: 'ALERT_UPDATE',
            payload: { level: result.level, trigger: result.trigger },
          });
        } else {
          await pb.collection('alerts').getList(1, 50, {
            filter: `userId="${user.id}" && resolved=false`,
          }).then(async (list) => {
            for (const alert of list.items) {
              await pb.collection('alerts').update(alert.id, { resolved: true });
            }
          });
        }
      } catch (userErr: unknown) {
        const msg = (userErr as Error)?.message?.split('\n')[0] ?? String(userErr);
        logger.debug(`riskEval failed for user ${user.id}: ${msg}`);
      }
    }

    logger.info(`riskEval complete for ${users.length} users`);
  } catch (err: unknown) {
    const msg = (err as Error)?.message?.split('\n')[0] ?? String(err);
    logger.error(`riskEval job failed: ${msg}`);
  }
}
