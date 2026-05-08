import { getPb } from '../pb.js';
import { evaluateRisk } from '../engine/riskEngine.js';
import { getCondition } from '../utils/conditionsCache.js';
import { broadcastAlert } from '../ws.js';
import { logger } from '../utils/logger.js';
import type { ConditionsSnapshot, UserRecord } from '../types/index.js';
import type { OpenMeteoData } from '../integrations/openmeteo.js';
import type { PagasaData } from '../integrations/pagasa.js';
import type { FirmsHotspot } from '../integrations/firms.js';
import { getGloFASData } from '../integrations/glofas.js';
import { getTropomiData } from '../integrations/tropomi.js';
import { countHotspotsNear } from '../integrations/firms.js';

export async function runRiskEval(): Promise<void> {
  logger.info('Running riskEval job');
  const pb = getPb();

  try {
    const weather = await getCondition<OpenMeteoData>('weather');
    const pagasa = await getCondition<PagasaData>('pagasa');
    const firms = await getCondition<FirmsHotspot[]>('firms') ?? [];
    const glofas = getGloFASData();
    const tropomi = getTropomiData();

    const users = await pb.collection('users').getFullList<UserRecord>({
      filter: 'alertOptIn=true',
    });

    for (const user of users) {
      try {
        const firePts = countHotspotsNear(firms, user.lat, user.lng);

        const conditions: ConditionsSnapshot = {
          rainfall: weather?.rainfall ?? 0,
          heatIndex: weather?.heatIndex ?? 32,
          airQuality: 50,
          riverLevel: 1.2,
          aerosolOpticalDepth: tropomi.aerosolOpticalDepth,
          firePts,
          pagasaSignal: pagasa?.signal ?? 0,
          glofasCritical: glofas.critical,
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
              riverDischarge: glofas.riverDischarge,
              evacuateWithin: result.evacuateWithin,
              reasons: result.reasons,
              checklist: result.checklist,
              issuedAt: new Date().toISOString(),
              reEvalAt,
              resolved: false,
            });
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
      } catch (userErr) {
        logger.debug(`riskEval failed for user ${user.id}`, userErr);
      }
    }

    logger.info(`riskEval complete for ${users.length} users`);
  } catch (err) {
    logger.error('riskEval job failed', err);
  }
}
