export {};
const BASE = 'https://monsoon-ai-production.up.railway.app';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjb2xsZWN0aW9uSWQiOiJfcGJfdXNlcnNfYXV0aF8iLCJleHAiOjE3NzkwMTg2NzIsImlkIjoicnJsYzZjbGFza2F6ZWYyIiwicmVmcmVzaGFibGUiOnRydWUsInR5cGUiOiJhdXRoIn0.Tv1xfBxh78rVE39PwCmCvIITS_sHYuxmEVnRoUPGcGE';

// These should show where personalization is missing (no evac center, no alert level)
// vs where it works (live_conditions path)
const SCENARIOS: [string, string][] = [
  // RAG path — emergency_guidance — currently NO context injected
  ['our house is flooding, what do we do',       'RAG: flood → should mention evac?'],
  ['the water is rising fast',                   'RAG: flood → should advise evacuate?'],
  ['can i shower during a typhoon',              'RAG: electrical → no personalization'],
  ['how do i clean after the flood',             'RAG: general → no personalization'],
  ['should i evacuate right now',                'RAG or live? → key test'],

  // live_conditions path — gets full context (alert, location, evac center)
  ['should we evacuate',                         'LIVE: personalized with alert + center'],
  ['when can we go back home',                   'LIVE: personalized'],
  ['is it safe outside',                         'LIVE: personalized'],
];

async function ask(message: string): Promise<{ reply: string; suggestedCommands?: string[] }> {
  const res = await fetch(`${BASE}/api/chat/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ message, sessionId: 'ctx-test-' + Date.now(), locale: 'en' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ reply: string; suggestedCommands?: string[] }>;
}

console.log('\n=== CONTEXT PERSONALIZATION TEST ===\n');

for (const [scenario, label] of SCENARIOS) {
  console.log(`${'─'.repeat(70)}`);
  console.log(`[${label}]`);
  console.log(`Q: "${scenario}"`);
  try {
    const result = await ask(scenario);
    console.log(`A: ${result.reply}`);
    if (result.suggestedCommands?.length) {
      console.log(`   Suggested: ${result.suggestedCommands.join(' | ')}`);
    }
  } catch (err) {
    console.log(`ERROR: ${err instanceof Error ? err.message : err}`);
  }
  await new Promise(r => setTimeout(r, 800));
}

console.log(`${'─'.repeat(70)}\nDone.\n`);
