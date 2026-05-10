export {};
const BASE = 'https://monsoon-ai-production.up.railway.app';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjb2xsZWN0aW9uSWQiOiJfcGJfdXNlcnNfYXV0aF8iLCJleHAiOjE3NzkwMTg2NzIsImlkIjoicnJsYzZjbGFza2F6ZWYyIiwicmVmcmVzaGFibGUiOnRydWUsInR5cGUiOiJhdXRoIn0.Tv1xfBxh78rVE39PwCmCvIITS_sHYuxmEVnRoUPGcGE';

async function ask(message: string, sessionId: string): Promise<{ reply: string; suggestedCommands?: string[] }> {
  const res = await fetch(`${BASE}/api/chat/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({ message, sessionId, locale: 'en' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ reply: string; suggestedCommands?: string[] }>;
}

function sid() { return 'test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); }

async function runThread(label: string, messages: string[]) {
  const sessionId = sid();
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`THREAD: ${label}`);
  console.log('═'.repeat(70));
  for (const msg of messages) {
    console.log(`\n  > ${msg}`);
    try {
      const r = await ask(msg, sessionId);
      console.log(`  < ${r.reply}`);
      if (r.suggestedCommands?.length) console.log(`    [${r.suggestedCommands.join(' | ')}]`);
    } catch (err) {
      console.log(`  ERROR: ${err instanceof Error ? err.message : err}`);
    }
    await new Promise(r => setTimeout(r, 900));
  }
}

// ── Thread 1: evacuation follow-ups ──────────────────────────────────────────
await runThread('Evacuation follow-ups — should inherit live_conditions', [
  'should we evacuate',
  'do you know where we could go',
  'where should we go',
  'what about nearby shelters',
]);

// ── Thread 2: flooding emergency with follow-ups ──────────────────────────────
await runThread('Flooding emergency + location follow-up', [
  'our house is flooding',
  'where do we go',
  'is it far',
]);

// ── Thread 3: injury follow-ups ───────────────────────────────────────────────
await runThread('Injury thread — cold pack + still hurts', [
  'i broke my leg',
  'i applied a cold pack and it still hurts',
  'how long should i keep the cold pack on',
]);

// ── Thread 4: casual shouldn't inherit disaster context ───────────────────────
await runThread('Casual message should NOT inherit disaster intent', [
  'our house is flooding',
  'u ok',
  'lol thanks',
]);

// ── Thread 5: everyday safety during disaster ─────────────────────────────────
await runThread('Everyday safety — RAG with context', [
  'can i shower during a typhoon',
  'what about using my generator',
  'can i cook',
  'is the tap water safe to drink',
]);

// ── Thread 6: evacuation decision routing ────────────────────────────────────
await runThread('Evacuation decisions — should be personalized with alert + center', [
  'should i evacuate right now',
  'do i need to evacuate',
  'is it time to leave',
]);

// ── Thread 7: stress test vague messages ─────────────────────────────────────
await runThread('Vague messages — mixed context', [
  'what is the heat index',
  'is it getting worse',
  'what should we do',
  'how bad is it',
]);

console.log('\n\nDone.\n');
