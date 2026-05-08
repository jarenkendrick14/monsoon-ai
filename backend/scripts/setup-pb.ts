import PocketBase from 'pocketbase';

const PB_URL = process.env['PB_URL'] ?? 'http://localhost:8090';
const PB_EMAIL = process.env['PB_ADMIN_EMAIL'] ?? 'admin@monsoon.ai';
const PB_PASS = process.env['PB_ADMIN_PASSWORD'] ?? '';

const pb = new PocketBase(PB_URL);

async function main() {
  await pb.admins.authWithPassword(PB_EMAIL, PB_PASS);
  console.log('Authenticated');

  // Add fields to users collection
  const usersCollection = await pb.collections.getOne('users');

  const newFields = [
    { name: 'mobile', type: 'text' },
    { name: 'role', type: 'text' },
    { name: 'locale', type: 'text' },
    { name: 'lat', type: 'number' },
    { name: 'lng', type: 'number' },
    { name: 'address', type: 'text' },
    { name: 'homeType', type: 'text' },
    { name: 'floor', type: 'number' },
    { name: 'householdSize', type: 'number' },
    { name: 'hasPWD', type: 'bool' },
    { name: 'hasElderly', type: 'bool' },
    { name: 'hasInfant', type: 'bool' },
    { name: 'hasPregnant', type: 'bool' },
    { name: 'riskScore', type: 'number' },
    { name: 'riskTier', type: 'text' },
    { name: 'isOnRescueList', type: 'bool' },
    { name: 'alertOptIn', type: 'bool' },
    { name: 'smsOptIn', type: 'bool' },
  ];

  const existingNames = (usersCollection.fields ?? usersCollection.schema ?? [])
    .map((f: Record<string, unknown>) => f['name']);

  const toAdd = newFields.filter(f => !existingNames.includes(f.name));

  if (toAdd.length === 0) {
    console.log('All fields already exist');
  } else {
    await pb.collections.update('users', {
      fields: [
        ...(usersCollection.fields ?? usersCollection.schema ?? []),
        ...toAdd,
      ],
    });
    console.log(`Added ${toAdd.length} fields:`, toAdd.map(f => f.name).join(', '));
  }

  console.log('Done!');
}

main().catch(console.error);
