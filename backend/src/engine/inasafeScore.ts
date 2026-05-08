import { HomeType, RiskTier, UserRecord } from '../types/index.js';

const STRUCTURAL_SCORES: Record<HomeType, number> = {
  nipa_hut: 0.3,
  standalone: 0.6,
  bungalow: 0.6,
  duplex: 0.6,
  townhouse: 0.7,
  apartment: 0.7,
  condo: 0.85,
  studio: 0.85,
};

export interface InaSAFEResult {
  score: number;
  tier: RiskTier;
  riskFactors: string[];
}

export function computeInaSAFEScore(user: UserRecord): InaSAFEResult {
  const structuralBase = STRUCTURAL_SCORES[user.homeType] ?? 0.6;
  const floorPenalty = user.floor === 0 || user.floor === 1 ? 1.2 : 1.0;
  const structuralScore = structuralBase * floorPenalty;

  let demographicScore = 1.0;
  const riskFactors: string[] = [];

  if (user.hasPWD) { demographicScore += 0.3; riskFactors.push('Person with disability'); }
  if (user.hasElderly) { demographicScore += 0.3; riskFactors.push('Elderly member'); }
  if (user.hasInfant) { demographicScore += 0.3; riskFactors.push('Infant present'); }
  if (user.hasPregnant) { demographicScore += 0.3; riskFactors.push('Pregnant member'); }

  if (user.homeType === 'nipa_hut') riskFactors.push('Nipa hut (high structural risk)');
  if (user.floor <= 1) riskFactors.push('Ground floor (flood exposure)');

  const rawScore = structuralScore * demographicScore;
  const score = Math.min(100, Math.round((rawScore / (0.85 * 2.2)) * 100));

  let tier: RiskTier;
  if (score >= 80) tier = 'critical';
  else if (score >= 60) tier = 'high';
  else if (score >= 40) tier = 'medium';
  else tier = 'low';

  return { score, tier, riskFactors };
}
