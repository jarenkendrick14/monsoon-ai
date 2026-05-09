const API_BASE = 'https://monsoon-ai-production.up.railway.app';
const WS_BASE = 'wss://monsoon-ai-production.up.railway.app';

function _getToken() {
  return localStorage.getItem('monsoon_gov_token') || localStorage.getItem('monsoon_token') || '';
}

function authHeaders(extra = {}) {
  const token = _getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function apiFetch(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    let err;
    try { err = await res.json(); } catch { err = { error: res.statusText }; }
    throw err;
  }
  return res.json();
}

function connectAlertWS(userId, onMessage) {
  const ws = new WebSocket(`${WS_BASE}/ws/alerts?userId=${userId}`);
  ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch {} };
  ws.onerror = () => {};
  ws.onclose = () => { setTimeout(() => connectAlertWS(userId, onMessage), 5000); };
  return ws;
}

function connectGovWS(onMessage) {
  const token = localStorage.getItem('monsoon_gov_token') || '';
  const ws = new WebSocket(`${WS_BASE}/ws/gov?token=${token}`);
  ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch {} };
  ws.onerror = () => {};
  ws.onclose = () => { setTimeout(() => connectGovWS(onMessage), 5000); };
  return ws;
}

function getUser() {
  try { return JSON.parse(localStorage.getItem('monsoon_user') || 'null'); } catch { return null; }
}

function getGovOfficer() {
  try { return JSON.parse(localStorage.getItem('monsoon_gov_officer') || 'null'); } catch { return null; }
}
