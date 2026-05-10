import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

loadEnv();
loadEnv({ path: resolve(__dirname, '../.env'), override: false });

function require_env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional_env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  port: parseInt(optional_env('PORT', '3000'), 10),
  nodeEnv: optional_env('NODE_ENV', 'development'),
  corsOrigin: optional_env('CORS_ORIGIN', 'http://localhost:3000'),

  pb: {
    url: optional_env('PB_URL', 'http://localhost:8090'),
    adminEmail: optional_env('PB_ADMIN_EMAIL', 'admin@monsoon.ai'),
    adminPassword: optional_env('PB_ADMIN_PASSWORD', ''),
  },

  openmeteo: {
    base: optional_env('OPENMETEO_BASE', 'https://api.open-meteo.com/v1'),
  },

  firms: {
    mapKey: optional_env('FIRMS_MAP_KEY', ''),
  },

  pagasa: {
    parserUrl: optional_env('PAGASA_PARSER_URL', 'https://pagasa.chlod.net/api/v1/bulletin'),
  },

  nominatim: {
    base: optional_env('NOMINATIM_BASE', 'https://nominatim.openstreetmap.org'),
  },

  mocks: {
    glofasScenario: optional_env('GLOFAS_MOCK_SCENARIO', 'normal') as 'normal' | 'critical',
    tropomiAai: parseFloat(optional_env('TROPOMI_MOCK_AAI', '1.2')),
    floodZone: optional_env('FLOOD_ZONE_MOCK', 'none') as 'none' | '100yr' | '25yr',
  },

  openai: {
    apiKey: optional_env('OPENAI_API_KEY', ''),
    model: optional_env('OPENAI_MODEL', 'gemini-3.1-flash-lite'),
  },

  twilio: {
    accountSid: optional_env('TWILIO_ACCOUNT_SID', ''),
    authToken: optional_env('TWILIO_AUTH_TOKEN', ''),
    phoneNumber: optional_env('TWILIO_PHONE_NUMBER', ''),
  },

  semaphore: {
    apiKey: optional_env('SEMAPHORE_API_KEY', ''),
    senderName: optional_env('SEMAPHORE_SENDER_NAME', 'MonsoonAI'),
  },
} as const;
