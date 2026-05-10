import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import PocketBase from 'pocketbase';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv();
loadEnv({ path: resolve(__dirname, '../.env'), override: false });

const PB_URL = process.env['PB_URL'] ?? 'http://localhost:8090';
const PB_EMAIL = process.env['PB_ADMIN_EMAIL'] ?? 'admin@monsoon.ai';
const PB_PASS = process.env['PB_ADMIN_PASSWORD'] ?? '';

const pb = new PocketBase(PB_URL);

const GOV_ACCOUNTS = [
  {
    email: 'officer@mdrrmo.gov.ph',
    password: 'MonsoonDemo2026!',
    name: 'Ramon Cruz',
    role: 'government',
    username: 'officer.cruz',
  },
  {
    email: 'dispatch@mdrrmo.gov.ph',
    password: 'MonsoonDemo2026!',
    name: 'Grace Ocampo',
    role: 'government',
    username: 'officer.ocampo',
  },
];

// Demo citizens with varied risk profiles around Angeles City, Pampanga
const CITIZENS = [
  {
    email: 'maria.santos@demo.ph', password: 'Demo1234!', username: 'maria.santos',
    name: 'Maria Santos', mobile: '+639171234001',
    lat: 15.1450, lng: 120.5887, address: 'Purok 3, Cutcut, Angeles City',
    homeType: 'nipa', floor: 0, householdSize: 5,
    hasPWD: true, hasElderly: true, hasInfant: false, hasPregnant: false,
    alertOptIn: true, smsOptIn: true, locale: 'tl',
  },
  {
    email: 'jose.reyes@demo.ph', password: 'Demo1234!', username: 'jose.reyes',
    name: 'Jose Reyes', mobile: '+639171234002',
    lat: 15.1502, lng: 120.5901, address: '14 Maharlika St, Pampang, Angeles City',
    homeType: 'standalone', floor: 0, householdSize: 4,
    hasPWD: false, hasElderly: true, hasInfant: true, hasPregnant: false,
    alertOptIn: true, smsOptIn: true, locale: 'tl',
  },
  {
    email: 'ana.dela.cruz@demo.ph', password: 'Demo1234!', username: 'ana.delacruz',
    name: 'Ana Dela Cruz', mobile: '+639171234003',
    lat: 15.1388, lng: 120.5842, address: 'Blk 7 Lot 3, Anunas, Angeles City',
    homeType: 'nipa', floor: 0, householdSize: 6,
    hasPWD: true, hasElderly: false, hasInfant: true, hasPregnant: true,
    alertOptIn: true, smsOptIn: true, locale: 'tl',
  },
  {
    email: 'pedro.garcia@demo.ph', password: 'Demo1234!', username: 'pedro.garcia',
    name: 'Pedro Garcia', mobile: '+639171234004',
    lat: 15.1601, lng: 120.5955, address: '22 Rizal Ave, Balibago, Angeles City',
    homeType: 'townhouse', floor: 1, householdSize: 3,
    hasPWD: false, hasElderly: false, hasInfant: false, hasPregnant: false,
    alertOptIn: true, smsOptIn: false, locale: 'en',
  },
  {
    email: 'lita.flores@demo.ph', password: 'Demo1234!', username: 'lita.flores',
    name: 'Lita Flores', mobile: '+639171234005',
    lat: 15.1521, lng: 120.5812, address: 'Sitio Mabini, Calibutbut, Bacolor',
    homeType: 'nipa', floor: 0, householdSize: 7,
    hasPWD: false, hasElderly: true, hasInfant: true, hasPregnant: false,
    alertOptIn: true, smsOptIn: true, locale: 'tl',
  },
  {
    email: 'roberto.tan@demo.ph', password: 'Demo1234!', username: 'roberto.tan',
    name: 'Roberto Tan', mobile: '+639171234006',
    lat: 15.1445, lng: 120.5990, address: '5F Robinsons Place, Angeles City',
    homeType: 'condo', floor: 5, householdSize: 2,
    hasPWD: false, hasElderly: false, hasInfant: false, hasPregnant: false,
    alertOptIn: true, smsOptIn: false, locale: 'en',
  },
  {
    email: 'carmen.villanueva@demo.ph', password: 'Demo1234!', username: 'carmen.villanueva',
    name: 'Carmen Villanueva', mobile: '+639171234007',
    lat: 15.1355, lng: 120.5780, address: 'Purok Pagasa, Dolores, San Fernando',
    homeType: 'standalone', floor: 0, householdSize: 5,
    hasPWD: true, hasElderly: false, hasInfant: false, hasPregnant: true,
    alertOptIn: true, smsOptIn: true, locale: 'tl',
  },
  {
    email: 'danilo.Cruz@demo.ph', password: 'Demo1234!', username: 'danilo.cruz',
    name: 'Danilo Cruz', mobile: '+639171234008',
    lat: 15.1588, lng: 120.5866, address: 'Blk 2 Purok 1, Malabanias, Angeles City',
    homeType: 'duplex', floor: 0, householdSize: 4,
    hasPWD: false, hasElderly: true, hasInfant: false, hasPregnant: false,
    alertOptIn: true, smsOptIn: true, locale: 'tl',
  },
  {
    email: 'susan.mendoza@demo.ph', password: 'Demo1234!', username: 'susan.mendoza',
    name: 'Susan Mendoza', mobile: '+639171234009',
    lat: 15.1422, lng: 120.5934, address: '88 MacArthur Hwy, Sindalan, San Fernando',
    homeType: 'apartment', floor: 2, householdSize: 3,
    hasPWD: false, hasElderly: false, hasInfant: true, hasPregnant: false,
    alertOptIn: true, smsOptIn: true, locale: 'en',
  },
  {
    email: 'andres.bautista@demo.ph', password: 'Demo1234!', username: 'andres.bautista',
    name: 'Andres Bautista', mobile: '+639171234010',
    lat: 15.1490, lng: 120.5860, address: 'Purok Dalisay, Telabastagan, San Fernando',
    homeType: 'nipa', floor: 0, householdSize: 8,
    hasPWD: true, hasElderly: true, hasInfant: true, hasPregnant: false,
    alertOptIn: true, smsOptIn: true, locale: 'tl',
  },
];

async function upsertUser(data: typeof CITIZENS[0] | typeof GOV_ACCOUNTS[0], isGov = false) {
  try {
    const existing = await pb.collection('users').getList(1, 1, {
      filter: `email="${data.email}"`,
    });
    if (existing.items.length > 0) {
      console.log(`  skip (exists): ${data.email}`);
      return existing.items[0];
    }
  } catch { /* not found, create */ }

  const payload: Record<string, unknown> = {
    email: data.email,
    password: data.password,
    passwordConfirm: data.password,
    name: data.name,
    username: data.username,
    emailVisibility: true,
    role: isGov ? 'government' : 'citizen',
    alertOptIn: true,
    smsOptIn: false,
  };

  if (!isGov) {
    const c = data as typeof CITIZENS[0];
    Object.assign(payload, {
      mobile: c.mobile,
      lat: c.lat,
      lng: c.lng,
      address: c.address,
      homeType: c.homeType,
      floor: c.floor,
      householdSize: c.householdSize,
      hasPWD: c.hasPWD,
      hasElderly: c.hasElderly,
      hasInfant: c.hasInfant,
      hasPregnant: c.hasPregnant,
      alertOptIn: c.alertOptIn,
      smsOptIn: c.smsOptIn,
      locale: c.locale,
    });
  }

  const record = await pb.collection('users').create(payload);
  console.log(`  created: ${data.email}`);
  return record;
}

async function main() {
  await pb.collection('_superusers').authWithPassword(PB_EMAIL, PB_PASS);
  console.log('Authenticated as admin\n');

  console.log('--- Government accounts ---');
  for (const gov of GOV_ACCOUNTS) {
    await upsertUser(gov, true);
  }

  console.log('\n--- Citizen households ---');
  for (const citizen of CITIZENS) {
    await upsertUser(citizen, false);
  }

  console.log('\nDone! Login credentials:');
  console.log('  Gov officer: officer@mdrrmo.gov.ph / MonsoonDemo2026!');
  console.log('  Gov officer: dispatch@mdrrmo.gov.ph / MonsoonDemo2026!');
  console.log('  Citizen:     maria.santos@demo.ph / Demo1234!');
}

main().catch(console.error);
