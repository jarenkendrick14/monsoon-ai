
import {
  AlertLevel,
  AlertReason,
  RiskEngineInput,
  RiskEngineResult,
  RiskTrigger,
} from '../types/index.js';
import { isIn25yrZone, isIn100yrZone } from './floodZone.js';

const FLOOD_CHECKLIST = [
  'Move valuables and documents to higher floors',
  'Prepare a go-bag with 3 days of supplies',
  'Follow evacuation route to the nearest center',
  'Do not walk or drive through floodwaters',
  'Notify family members of your evacuation plan',
];

const FIRE_CHECKLIST = [
  'Close all windows and doors to reduce smoke entry',
  'Prepare N95 masks or wet cloth as makeshift filter',
  'Monitor air quality alerts',
  'Stay indoors until advisory is lifted',
];

const HEAT_CHECKLIST = [
  'Stay hydrated — drink water every 15-30 minutes',
  'Seek air-conditioned spaces or cooling centers',
  'Avoid outdoor activity between 10am–4pm',
  'Check on elderly and young children frequently',
];

export function evaluateRisk(input: RiskEngineInput): RiskEngineResult {
  const { user, conditions } = input;
  const { lat, lng, floor, hasPWD, hasElderly, hasInfant, hasPregnant } = user;
  const {
    rainfall,
    heatIndex,
    glofasCritical,
    pagasaSignal,
    aerosolOpticalDepth,
    firePts,
  } = conditions;

  const vulnerabilityReasons: AlertReason[] = [];
  if (hasPWD) vulnerabilityReasons.push({ title: 'PWD household member', detail: 'Person with disability requires priority evacuation assistance.' });
  if (hasElderly) vulnerabilityReasons.push({ title: 'Elderly household member', detail: 'Elderly members need early evacuation and medical monitoring.' });
  if (hasInfant) vulnerabilityReasons.push({ title: 'Infant present', detail: 'Infants are highly vulnerable to heat and flood conditions.' });
  if (hasPregnant) vulnerabilityReasons.push({ title: 'Pregnant household member', detail: 'Pregnant members require immediate medical priority in evacuation.' });

  const in25yr = isIn25yrZone(lat, lng);
  const in100yr = isIn100yrZone(lat, lng);
  const onGround = floor <= 1;

  // Priority order: CRITICAL_FLOOD > CRITICAL_RIVERINE > HIGH_FLOOD > SMOKE_CRITICAL > FIRE_ADVISORY > HEAT_DANGER > HEAT_CAUTION

  if (rainfall > 50 && in25yr && onGround) {
    return build('CRITICAL_FLOOD', 'critical', 30, [
      { title: 'Extreme rainfall', detail: `Current rainfall: ${rainfall}mm — exceeds critical 50mm threshold.` },
      { title: '25-year flood zone', detail: 'Your location falls within the 25-year flood return period zone (UP NOAH data).' },
      { title: 'Ground floor exposure', detail: 'Ground floor placement significantly increases flood risk.' },
      ...vulnerabilityReasons,
    ], FLOOD_CHECKLIST, conditions.rainfall);
  }

  if (glofasCritical) {
    return build('CRITICAL_RIVERINE', 'critical', 45, [
      { title: 'Critical river discharge', detail: 'GloFAS satellite data shows river discharge exceeding critical threshold.' },
      ...vulnerabilityReasons,
    ], FLOOD_CHECKLIST, rainfall);
  }

  if (rainfall > 30 && in100yr && pagasaSignal >= 2) {
    return build('HIGH_FLOOD', 'high', 90, [
      { title: 'Heavy rainfall', detail: `Current rainfall: ${rainfall}mm — above 30mm with PAGASA Signal ${pagasaSignal}.` },
      { title: '100-year flood zone', detail: 'Your location falls within the 100-year flood zone.' },
      ...vulnerabilityReasons,
    ], FLOOD_CHECKLIST, rainfall);
  }

  if (aerosolOpticalDepth > 2.5) {
    return build('SMOKE_CRITICAL', 'high', 0, [
      { title: 'Critical smoke/haze level', detail: `Aerosol Optical Depth: ${aerosolOpticalDepth} — severe air quality degradation detected (TROPOMI).` },
      ...vulnerabilityReasons,
    ], FIRE_CHECKLIST, rainfall);
  }

  if (firePts > 0) {
    return build('FIRE_ADVISORY', 'high', 0, [
      { title: 'Fire hotspot detected', detail: `${firePts} active fire hotspot(s) detected within 20km of your location (FIRMS).` },
      ...vulnerabilityReasons,
    ], FIRE_CHECKLIST, rainfall);
  }

  if (heatIndex >= 42) {
    return build('HEAT_DANGER', 'high', 0, [
      { title: 'Dangerous heat index', detail: `Heat index: ${heatIndex}°C — at or above the danger threshold of 42°C.` },
      ...vulnerabilityReasons,
    ], HEAT_CHECKLIST, rainfall);
  }

  if (heatIndex >= 33 && vulnerabilityReasons.length > 0) {
    return build('HEAT_CAUTION', 'medium', 0, [
      { title: 'Elevated heat with vulnerable household', detail: `Heat index: ${heatIndex}°C — caution level for vulnerable household members.` },
      ...vulnerabilityReasons,
    ], HEAT_CHECKLIST, rainfall);
  }

  return { trigger: null, level: 'low', evacuateWithin: 0, reasons: [], checklist: [] };
}

function build(
  trigger: RiskTrigger,
  level: AlertLevel,
  evacuateWithin: number,
  reasons: AlertReason[],
  checklist: string[],
  _rainfall: number
): RiskEngineResult {
  return { trigger, level, evacuateWithin, reasons, checklist };
}
