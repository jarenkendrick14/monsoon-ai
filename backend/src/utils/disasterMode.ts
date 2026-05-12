import type { AlertRecord, ConditionsSnapshot, RiskContext, UserRecord } from '../types/index.js';

export const DISASTER_MODE_HEADER = 'x-monsoon-disaster-mode';

export const DISASTER_SCENARIO = {
  name: 'Typhoon Flood Drill',
  bulletinTitle: 'Severe Tropical Storm Kristine - Local Flood Response Drill',
  signal: 3,
  rainfall24h: 248,
  rainfall6h: 82,
  riverLevel: 3.7,
  riverDischarge: 3180,
  floodZone: '25-year flood hazard zone',
  floodDepth: '0.8-1.4 m expected along low-lying streets',
  heatIndex: 29,
  airQuality: 54,
  evacWithin: 45,
} as const;

export const DISASTER_FORECAST = [
  { day: 'Wed', temp: 29, riskLevel: 'critical' },
  { day: 'Thu', temp: 29, riskLevel: 'critical' },
  { day: 'Fri', temp: 30, riskLevel: 'high' },
  { day: 'Sat', temp: 31, riskLevel: 'medium' },
  { day: 'Sun', temp: 32, riskLevel: 'low' },
  { day: 'Mon', temp: 32, riskLevel: 'low' },
  { day: 'Tue', temp: 33, riskLevel: 'medium' },
];

export function isDisasterMode(req: { get(name: string): string | undefined; body?: unknown; query?: unknown }): boolean {
  const header = req.get(DISASTER_MODE_HEADER);
  const bodyMode = typeof req.body === 'object' && req.body !== null
    ? (req.body as Record<string, unknown>)['disasterMode']
    : undefined;
  const queryMode = typeof req.query === 'object' && req.query !== null
    ? (req.query as Record<string, unknown>)['disasterMode']
    : undefined;
  return header === 'critical' || bodyMode === 'critical' || queryMode === 'critical';
}

export function disasterConditions(): ConditionsSnapshot {
  return {
    rainfall: DISASTER_SCENARIO.rainfall24h,
    heatIndex: DISASTER_SCENARIO.heatIndex,
    airQuality: DISASTER_SCENARIO.airQuality,
    riverLevel: DISASTER_SCENARIO.riverLevel,
    aerosolOpticalDepth: 1.2,
    firePts: 0,
    pagasaSignal: DISASTER_SCENARIO.signal,
    glofasCritical: true,
    fetchedAt: new Date().toISOString(),
  };
}

export function disasterAlert(user: UserRecord): Omit<AlertRecord, 'id'> & { id: string } {
  const now = new Date();
  return {
    id: 'disaster-mode-critical-flood',
    userId: user.id,
    level: 'critical',
    type: 'CRITICAL_FLOOD',
    rainfall: DISASTER_SCENARIO.rainfall24h,
    floodZone: DISASTER_SCENARIO.floodZone,
    riverDischarge: DISASTER_SCENARIO.riverDischarge,
    evacuateWithin: DISASTER_SCENARIO.evacWithin,
    reasons: [
      { title: 'Extreme 24-hour rainfall', detail: `${DISASTER_SCENARIO.rainfall24h} mm/24h in the active disaster scenario.` },
      { title: 'Flood hazard zone', detail: `Saved address is tested against the ${DISASTER_SCENARIO.floodZone}.` },
      { title: 'Critical river level', detail: `${DISASTER_SCENARIO.riverLevel} m NHWL and ${DISASTER_SCENARIO.riverDischarge} m3/s discharge.` },
    ],
    checklist: [
      'Bring IDs and local permits',
      'Pack medications for 3 days',
      'Bring drinking water and ready-to-eat food',
      'Charge phone and power bank',
      'Avoid walking through floodwater',
    ],
    issuedAt: now.toISOString(),
    reEvalAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    resolved: false,
  };
}

export function applyDisasterContext(context: RiskContext): RiskContext {
  return {
    ...context,
    alertLevel: 'critical',
    trigger: 'CRITICAL_FLOOD',
    conditions: {
      heatIndex: DISASTER_SCENARIO.heatIndex,
      airQuality: DISASTER_SCENARIO.airQuality,
      riverLevel: DISASTER_SCENARIO.riverLevel,
      rainfall: DISASTER_SCENARIO.rainfall24h,
      forecast7day: DISASTER_FORECAST,
    },
  };
}

