import { getPb } from '../pb.js';
import { getCondition } from '../utils/conditionsCache.js';
import { sendBulkSms } from '../integrations/sms.js';
import { countHotspotsNear, FirmsHotspot } from '../integrations/firms.js';
import { logger } from '../utils/logger.js';
import type { UserRecord } from '../types/index.js';

export async function runAlertFire(): Promise<void> {
  logger.info('Running alertFire job');

  try {
    const firms = await getCondition<FirmsHotspot[]>('firms') ?? [];
    if (firms.length === 0) return;

    const pb = getPb();
    const users = await pb.collection('users').getFullList<UserRecord>({
      filter: 'smsOptIn=true',
    });

    const affectedNumbers: string[] = [];

    for (const user of users) {
      if (!user.mobile) continue;
      const firePts = countHotspotsNear(firms, user.lat, user.lng, 20);
      if (firePts > 0) {
        affectedNumbers.push(user.mobile);
      }
    }

    if (affectedNumbers.length > 0) {
      const message = `[MonsoonAI FIRE ADVISORY] Active fire hotspots detected near your area. Stay indoors, close windows, prepare N95 masks. Reply HAZE for air quality. Reply STOP to unsubscribe.`;
      await sendBulkSms(affectedNumbers, message);
      logger.info(`alertFire: SMS sent to ${affectedNumbers.length} users`);
    }
  } catch (err) {
    logger.error('alertFire job failed', err);
  }
}
