import { config } from '../config.js';

export interface TropomiData {
  aerosolOpticalDepth: number;
  smokeCritical: boolean;
}

export function getTropomiData(): TropomiData {
  const aai = config.mocks.tropomiAai;
  return {
    aerosolOpticalDepth: aai,
    smokeCritical: aai > 2.5,
  };
}
