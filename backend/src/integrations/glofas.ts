import { config } from '../config.js';

export interface GloFASData {
  critical: boolean;
  scenario: string;
  riverDischarge: number;
}

export function getGloFASData(): GloFASData {
  const scenario = config.mocks.glofasScenario;
  return {
    critical: scenario === 'critical',
    scenario,
    riverDischarge: scenario === 'critical' ? 4850 : 1200,
  };
}
