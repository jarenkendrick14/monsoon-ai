export type Locale = 'en' | 'tl' | 'vi';
export type UserRole = 'citizen' | 'government';
export type HomeType = 'bungalow' | 'standalone' | 'townhouse' | 'apartment' | 'condo' | 'duplex' | 'nipa_hut' | 'studio';
export type RiskTier = 'critical' | 'high' | 'medium' | 'low';
export type AlertLevel = 'critical' | 'high' | 'medium' | 'low' | 'none';
export type HouseholdStatus = 'pending' | 'dispatched' | 'evacuated' | 'safe';

export type RiskTrigger =
  | 'CRITICAL_FLOOD'
  | 'CRITICAL_RIVERINE'
  | 'HIGH_FLOOD'
  | 'SMOKE_CRITICAL'
  | 'FIRE_ADVISORY'
  | 'HEAT_DANGER'
  | 'HEAT_CAUTION';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: UserRole;
  locale: Locale;
  lat: number;
  lng: number;
  address: string;
  homeType: HomeType;
  floor: number;
  householdSize: number;
  hasPWD: boolean;
  hasElderly: boolean;
  hasInfant: boolean;
  hasPregnant: boolean;
  riskScore: number;
  riskTier: RiskTier;
  isOnRescueList: boolean;
  alertOptIn: boolean;
  smsOptIn: boolean;
  created: string;
  updated: string;
}

export interface AlertRecord {
  id: string;
  userId: string;
  level: AlertLevel;
  type: RiskTrigger;
  rainfall: number;
  floodZone: string;
  riverDischarge: number;
  evacuateWithin: number;
  reasons: AlertReason[];
  checklist: string[];
  issuedAt: string;
  reEvalAt: string;
  resolved: boolean;
}

export interface AlertReason {
  title: string;
  detail: string;
}

export interface ConditionsSnapshot {
  rainfall: number;
  heatIndex: number;
  airQuality: number;
  riverLevel: number;
  aerosolOpticalDepth: number;
  firePts: number;
  pagasaSignal: number;
  glofasCritical: boolean;
  fetchedAt: string;
}

export interface ForecastDay {
  day: string;
  riskLevel: AlertLevel;
  temp: number;
}

export interface EvacCenter {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  capacity: number;
  type: string;
}

export interface EvacRoute {
  etaMinutes: number;
  distanceKm: number;
  routingNote: string;
  center: EvacCenter;
  steps: string[];
}

export interface GovHousehold {
  id: string;
  userId: string;
  rank: number;
  inasafeScore: number;
  tier: RiskTier;
  riskFactors: string[];
  assignedTeam: string;
  status: HouseholdStatus;
  name: string;
  address: string;
  phone: string;
}

export interface RiskEngineInput {
  user: UserRecord;
  conditions: ConditionsSnapshot;
}

export interface RiskEngineResult {
  trigger: RiskTrigger | null;
  level: AlertLevel;
  evacuateWithin: number;
  reasons: AlertReason[];
  checklist: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatReply {
  reply: string;
  attachments?: { type: string; url: string }[];
  suggestedCommands?: string[];
}

export interface RiskContext {
  alertLevel: AlertLevel;
  trigger: RiskTrigger | null;
  location: string;
}
