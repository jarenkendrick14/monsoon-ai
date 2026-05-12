import { applyDisasterContext, disasterConditions, DISASTER_SCENARIO } from './src/utils/disasterMode.js';
import { smsCriticalStatusReply } from './src/routes/smsRoutes.js';
import type { RiskContext } from './src/types/index.js';

const baseContext: RiskContext = {
  alertLevel: 'none',
  trigger: null,
  location: '225 San Nicolas 1st Lubao, Pampanga',
  household: {
    hasElderly: true,
    hasInfant: true,
    hasPWD: false,
    hasPregnant: false,
    householdSize: 4,
    floor: 0,
    homeType: 'standalone',
    riskTier: 'medium',
    isOnRescueList: false,
  },
  situation: {
    companions: ['parent/adult family member'],
    needs: [],
    absent: [],
    profileFlagsNotPresent: false,
    waterLevel: null,
    canLeaveSafely: null,
    notes: [],
  },
  evacCenter: {
    name: 'Saint Nicholas Academy',
    address: 'Lubao, Pampanga',
    distKm: '0.8',
  },
  conditions: null,
};

const disasterContext = applyDisasterContext(baseContext);
const cond = disasterConditions();
const status = smsCriticalStatusReply(disasterContext);

if (disasterContext.alertLevel !== 'critical') throw new Error('Expected critical SMS disaster alert level');
if (disasterContext.trigger !== 'CRITICAL_FLOOD') throw new Error(`Expected CRITICAL_FLOOD, got ${disasterContext.trigger}`);
if (disasterContext.conditions?.rainfall !== DISASTER_SCENARIO.rainfall24h) throw new Error('Expected disaster rainfall in SMS context');
if (disasterContext.conditions?.riverLevel !== DISASTER_SCENARIO.riverLevel) throw new Error('Expected disaster river level in SMS context');
if (cond.rainfall !== DISASTER_SCENARIO.rainfall24h) throw new Error('Expected disasterConditions rainfall');
if (cond.riverLevel !== DISASTER_SCENARIO.riverLevel) throw new Error('Expected disasterConditions river level');
if (!status.includes('CRITICAL FLOOD')) throw new Error(`Expected critical flood SMS status, got ${status}`);
if (!status.includes(`${DISASTER_SCENARIO.rainfall24h}mm`)) throw new Error(`Expected rainfall in SMS status, got ${status}`);
if (!status.includes(`river ${DISASTER_SCENARIO.riverLevel}m`)) throw new Error(`Expected river level in SMS status, got ${status}`);
if (!status.includes(`Signal #${DISASTER_SCENARIO.signal}`)) throw new Error(`Expected Signal number in SMS status, got ${status}`);
if (!status.includes('Saint Nicholas Academy')) throw new Error(`Expected evac center in SMS status, got ${status}`);

console.log('SMS disaster mode tests passed');
