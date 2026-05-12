import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { findNearestCenter, getEvacCenters, distanceKm } from '../integrations/evacCenters.js';
import { computeEvacWindow } from '../engine/evacWindow.js';
import { sendSms } from '../integrations/sms.js';
import { computeGoogleWalkingRoute } from '../integrations/googleRoutes.js';

const router = Router();

router.get('/api/evac/route', authMiddleware, async (req, res) => {
  const lat = parseFloat(req.query['lat'] as string);
  const lng = parseFloat(req.query['lng'] as string);

  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: 'lat and lng required' });
    return;
  }

  const user = req.user!;
  const nearest = findNearestCenter(lat, lng);

  if (!nearest) {
    res.json({
      etaMinutes: 30,
      distanceKm: 2.0,
      routingNote: 'No evac center data available. Proceed to nearest high ground.',
      steps: ['Move to higher ground', 'Follow local emergency instructions'],
      center: null,
    });
    return;
  }

  const dist = distanceKm(lat, lng, nearest.lat, nearest.lng);
  const { etaMinutes, routingNote } = computeEvacWindow(dist, user);
  const googleRoute = await computeGoogleWalkingRoute(
    { lat, lng },
    { lat: nearest.lat, lng: nearest.lng }
  );

  const fallbackSteps = [
    `Head toward ${nearest.name}`,
    `Distance: ${dist.toFixed(1)} km`,
    `Estimated arrival: ${etaMinutes} minutes walking`,
    `Address: ${nearest.address}`,
    'Bring ID, important documents, medications',
    'Do not drive through floodwaters',
  ];

  res.json({
    etaMinutes: googleRoute?.etaMinutes ?? etaMinutes,
    distanceKm: googleRoute?.distanceKm ?? parseFloat(dist.toFixed(2)),
    routingNote: googleRoute ? 'Google Maps walking route. Avoid flooded or blocked roads.' : routingNote,
    destination: nearest,
    routePolyline: googleRoute?.polyline ?? [[lat, lng], [nearest.lat, nearest.lng]],
    routeProvider: googleRoute ? 'google_routes' : 'straight_line',
    steps: googleRoute?.steps?.length ? googleRoute.steps : fallbackSteps,
  });
});

router.get('/api/evac/centers', (_req, res) => {
  res.json(getEvacCenters());
});

router.post('/api/sms/send-evac', authMiddleware, async (req, res) => {
  const user = req.user!;
  if (!user.mobile) {
    res.status(400).json({ error: 'No mobile number on profile' });
    return;
  }

  const nearest = findNearestCenter(user.lat, user.lng);
  const dist = nearest ? distanceKm(user.lat, user.lng, nearest.lat, nearest.lng) : 0;
  const { etaMinutes } = computeEvacWindow(dist, user);

  const message = nearest
    ? `[MonsoonAI] Nearest evac center: ${nearest.name}, ${nearest.address}. Distance: ${dist.toFixed(1)}km (~${etaMinutes} min walk). Bring ID & supplies. Stay safe.`
    : '[MonsoonAI] Proceed to nearest high ground or barangay hall. Follow local emergency instructions.';

  await sendSms(user.mobile, message);
  res.json({ success: true });
});

export default router;
