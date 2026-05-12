const API_BASE = 'https://monsoon-ai-production.up.railway.app';
const WS_BASE = 'wss://monsoon-ai-production.up.railway.app';

function _getToken() {
  if (window.location.pathname.includes('/gov/')) {
    return localStorage.getItem('monsoon_gov_token') || '';
  }
  return localStorage.getItem('monsoon_token') || '';
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

let _googleMapsLoadPromise = null;

async function loadGoogleMaps(libraries = []) {
  if (window.google && window.google.maps) return window.google.maps;
  if (_googleMapsLoadPromise) return _googleMapsLoadPromise;

  _googleMapsLoadPromise = (async () => {
    const cfg = await apiFetch('/api/maps/config');
    if (!cfg.apiKey) throw new Error('Google Maps API key is not configured.');

    await new Promise((resolve, reject) => {
      const callbackName = '__monsoonGoogleMapsReady';
      window[callbackName] = () => {
        delete window[callbackName];
        resolve();
      };

      const params = new URLSearchParams({
        key: cfg.apiKey,
        callback: callbackName,
        v: 'weekly',
      });
      if (libraries.length) params.set('libraries', Array.from(new Set(libraries)).join(','));

      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
      script.async = true;
      script.defer = true;
      script.onerror = () => reject(new Error('Failed to load Google Maps.'));
      document.head.appendChild(script);
    });

    return window.google.maps;
  })();

  return _googleMapsLoadPromise;
}
