const API_BASE = 'https://monsoon-ai-production.up.railway.app';
const WS_BASE = 'wss://monsoon-ai-production.up.railway.app';

const DEMO_SCENARIO = {
  name: 'Flood Scenario Overlay',
  bulletinTitle: 'Severe Tropical Storm Kristine - Local Flood Response Drill',
  signal: 3,
  rainfall24h: 248,
  rainfall6h: 82,
  riverLevel: 3.7,
  riverDischarge: 3180,
  floodDepth: '0.8-1.4 m expected along low-lying streets',
  floodZone: '25-year flood hazard zone',
  heatIndex: 29,
  airQuality: 54,
  evacWithin: 45,
};

function getDisasterMode() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('disaster') || params.get('demo') || params.get('scenario');
  if (mode === 'off') {
    localStorage.removeItem('monsoon_disaster_mode');
    localStorage.removeItem('monsoon_demo_mode');
    return '';
  }
  if (mode) {
    const normalizedMode = mode === 'on' || mode === 'typhoon' || mode === 'flood' || mode === 'disaster' ? 'critical' : mode;
    localStorage.setItem('monsoon_disaster_mode', normalizedMode);
    localStorage.setItem('monsoon_demo_mode', normalizedMode);
  }
  return localStorage.getItem('monsoon_disaster_mode') || localStorage.getItem('monsoon_demo_mode') || '';
}

function isDisasterMode() {
  return getDisasterMode() === 'critical';
}

function getDisasterScenario() {
  return isDisasterMode() ? { ...DEMO_SCENARIO } : null;
}

function _mockForecast() {
  return [
    { day: 'Wed', temp: 29, riskLevel: 'critical' },
    { day: 'Thu', temp: 29, riskLevel: 'critical' },
    { day: 'Fri', temp: 30, riskLevel: 'high' },
    { day: 'Sat', temp: 31, riskLevel: 'medium' },
    { day: 'Sun', temp: 32, riskLevel: 'low' },
    { day: 'Mon', temp: 32, riskLevel: 'low' },
    { day: 'Tue', temp: 33, riskLevel: 'medium' },
  ];
}

function _mockApi(path, options = {}) {
  const cleanPath = path.split('?')[0];
  const now = new Date();

  if (cleanPath === '/api/dashboard') {
    const user = getUser() || {};
    const firstName = (user.name || 'there').split(/\s+/)[0];
    return {
      user: { firstName, address: user.address || '' },
      alertLevel: 'critical',
      forecast7day: _mockForecast(),
      conditions: {
        riverLevel: DEMO_SCENARIO.riverLevel,
        airQuality: DEMO_SCENARIO.airQuality,
        heatIndex: DEMO_SCENARIO.heatIndex,
        rainfall: DEMO_SCENARIO.rainfall24h,
      },
    };
  }

  if (cleanPath === '/api/alerts/active') {
    return {
      alertId: 'demo-alert-critical-flood',
      level: 'critical',
      evacuateWithin: DEMO_SCENARIO.evacWithin,
      rainfall: DEMO_SCENARIO.rainfall24h,
      floodZone: DEMO_SCENARIO.floodZone,
      riverDischarge: DEMO_SCENARIO.riverDischarge,
      issuedAt: now.toISOString(),
      reEvalAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      reasons: [
        { title: 'Extreme 24-hour rainfall', detail: `${DEMO_SCENARIO.rainfall24h} mm recorded/forecast, with ${DEMO_SCENARIO.rainfall6h} mm concentrated in the next 6 hours.` },
        { title: 'Inside 25-year flood hazard zone', detail: `Saved address intersects the ${DEMO_SCENARIO.floodZone}; ${DEMO_SCENARIO.floodDepth}.` },
        { title: 'Critical Pampanga River discharge', detail: `${DEMO_SCENARIO.riverDischarge} m3/s, above the prototype evacuation trigger for low-lying households.` },
        { title: 'Ground-floor household exposure', detail: 'Ground-floor or light-material homes are prioritized for early evacuation before nightfall.' },
      ],
      checklist: [
        'Bring IDs and local permits',
        'Pack medications for 3 days',
        'Bring drinking water and ready-to-eat food',
        'Charge phone and power bank',
        'Avoid walking through floodwater',
      ],
    };
  }

  if (cleanPath === '/api/alerts/active-storm') {
    return {
      signal: DEMO_SCENARIO.signal,
      bulletinTitle: DEMO_SCENARIO.bulletinTitle,
      issuedAt: now.toISOString(),
    };
  }

  if (cleanPath === '/api/conditions/current') {
    return {
      rainfall: DEMO_SCENARIO.rainfall24h,
      riverLevel: DEMO_SCENARIO.riverLevel,
      airQuality: DEMO_SCENARIO.airQuality,
      heatIndex: DEMO_SCENARIO.heatIndex,
      glofasCritical: true,
      fetchedAt: now.toISOString(),
    };
  }

  if (cleanPath === '/api/conditions/haze') {
    return {
      aerosolOpticalDepth: 3.1,
      smokeCritical: false,
      firePts: 0,
      source: 'FIRMS/TROPOMI scenario mock',
      fetchedAt: now.toISOString(),
    };
  }

  if (cleanPath === '/api/chat/message') {
    let message = '';
    try { message = JSON.parse(options.body || '{}').message || ''; } catch {}
    const q = String(message).toLowerCase();
    const location = getUser()?.address || 'your saved address';
    const base = `Disaster Mode is active for ${location}: Signal #${DEMO_SCENARIO.signal}, ${DEMO_SCENARIO.rainfall24h} mm/24h rainfall, river level ${DEMO_SCENARIO.riverLevel} NHWL, ${DEMO_SCENARIO.floodZone}.`;

    if (q.includes('evac') || q.includes('route')) {
      return {
        reply: `${base} Yes, prepare to evacuate now and use the evacuation route in the app. Avoid floodwater and call 911 if you are trapped or in immediate danger.`,
        suggestedCommands: ['Show evac route', 'View checklist', 'Call 911'],
      };
    }

    if (q.includes('status') || q.includes('safe') || q.includes('alert')) {
      return {
        reply: `${base} Status is CRITICAL. Heavy flooding is expected near your saved address. Follow LGU evacuation instructions and keep your go bag ready.`,
        suggestedCommands: ['EVAC', 'View checklist', 'Call 911'],
      };
    }

    if (q.includes('rain') || q.includes('weather') || q.includes('storm') || q.includes('typhoon')) {
      return {
        reply: `${base} Expect heavy rain and flood risk through the next check period. Do not cross moving floodwater.`,
        suggestedCommands: ['STATUS', 'EVAC', 'Check conditions'],
      };
    }

    return {
      reply: `${base} Tell me who is with you, your current water level, and whether anyone needs medicine or mobility help so I can tailor your checklist.`,
      suggestedCommands: ['View checklist', 'EVAC', 'Call 911'],
    };
  }

  if (cleanPath === '/api/reports/hazard-photo') {
    return {
      hazards: ['Flood Water', 'Exposed Wires'],
      confidence: 'medium',
      needsHumanReview: true,
      reportId: 'demo-hazard-report',
      savedAt: now.toISOString(),
      message: 'Report sent to LGU for human review.',
    };
  }

  if (cleanPath === '/api/gov/stats') {
    return {
      totalRegistered: 4812,
      critical: 127,
      high: 438,
      teamsDeployed: 12,
      hazardReports: 9,
    };
  }

  if (cleanPath === '/api/map/flood-zones') {
    const user = getUser() || {};
    const lat = Number(user.lat) || 15.1348;
    const lng = Number(user.lng) || 120.5869;
    const dLat = 0.010;
    const dLng = 0.012;
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            name: 'Disaster Mode 25-year flood extent',
            returnPeriod: '25-year',
            scenario: DEMO_SCENARIO.bulletinTitle,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [lng - dLng, lat - dLat],
              [lng + dLng, lat - dLat * 0.8],
              [lng + dLng * 0.9, lat + dLat],
              [lng - dLng * 0.7, lat + dLat * 0.8],
              [lng - dLng, lat - dLat],
            ]],
          },
        },
      ],
    };
  }

  if (cleanPath === '/api/sms/send-evac' || cleanPath === '/api/user/checklist' || cleanPath === '/api/gov/teams/dispatch') {
    return { success: true };
  }

  return null;
}

function _backendDisasterPath(path) {
  const cleanPath = path.split('?')[0];
  return cleanPath === '/api/dashboard'
    || cleanPath === '/api/alerts/active'
    || cleanPath === '/api/alerts/active-storm'
    || cleanPath.startsWith('/api/alerts/')
    || cleanPath === '/api/conditions/current'
    || cleanPath === '/api/conditions/rivers'
    || cleanPath === '/api/conditions/air'
    || cleanPath === '/api/conditions/heat'
    || cleanPath === '/api/conditions/haze'
    || cleanPath === '/api/map/flood-zones'
    || cleanPath === '/api/chat/message'
    || cleanPath === '/api/user/profile'
    || cleanPath === '/api/user/risk-summary'
    || cleanPath === '/api/risk/score';
}

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
  const disasterMode = getDisasterMode();
  if (disasterMode === 'critical' && !_backendDisasterPath(path)) {
    const mocked = _mockApi(path, options);
    if (mocked) return Promise.resolve(mocked);
  }

  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(disasterMode ? { 'X-Monsoon-Disaster-Mode': disasterMode } : {}),
      ...(options.headers || {}),
    },
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
