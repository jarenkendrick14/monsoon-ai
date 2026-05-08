import { UserRecord } from '../types/index.js';

export interface EvacWindowResult {
  etaMinutes: number;
  routingNote: string;
}

export function computeEvacWindow(distanceKm: number, user: UserRecord): EvacWindowResult {
  const walkingSpeedKmh = 4.0;
  let eta = (distanceKm / walkingSpeedKmh) * 60;

  let mobilityAdjusted = false;

  if (user.hasPWD || user.hasElderly) {
    eta *= 1.4;
    mobilityAdjusted = true;
  }

  if (user.hasInfant) {
    eta *= 1.2;
    mobilityAdjusted = true;
  }

  const etaMinutes = Math.ceil(eta);
  const routingNote = mobilityAdjusted
    ? 'Route adjusted for mobility needs — allow extra time'
    : 'Standard walking route';

  return { etaMinutes, routingNote };
}
