import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { EvacCenter } from '../types/index.js';

const CANDIDATE_TYPES = [
  'school',
  'primary_school',
  'secondary_school',
  'university',
  'city_hall',
  'local_government_office',
  'community_center',
] as const;

const TYPE_LABELS: Record<string, string> = {
  school: 'school',
  primary_school: 'school',
  secondary_school: 'school',
  university: 'school',
  city_hall: 'government',
  local_government_office: 'government',
  community_center: 'civic',
};

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
}

interface NearbyPlacesResponse {
  places?: GooglePlace[];
}

export async function discoverEvacCenterCandidates(
  lat: number,
  lng: number,
  radiusMeters = 5000,
  maxResultCount = 15
): Promise<EvacCenter[]> {
  if (!config.googleMaps.apiKey) return [];

  try {
    const resp = await axios.post<NearbyPlacesResponse>(
      `${config.googleMaps.placesBase}/places:searchNearby`,
      {
        includedTypes: CANDIDATE_TYPES,
        maxResultCount,
        rankPreference: 'DISTANCE',
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: Math.min(Math.max(radiusMeters, 500), 50000),
          },
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': config.googleMaps.apiKey,
          'X-Goog-FieldMask': [
            'places.id',
            'places.displayName',
            'places.formattedAddress',
            'places.location',
            'places.primaryType',
            'places.types',
          ].join(','),
        },
        timeout: 12000,
      }
    );

    return (resp.data.places ?? [])
      .map(placeToEvacCandidate)
      .filter((center): center is EvacCenter => center !== null);
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    const msg = (err as Error)?.message?.split('\n')[0] ?? String(err);
    logger.warn(`Google Places evac candidate search failed (${status ?? 'no response'}): ${msg}`);
    return [];
  }
}

function placeToEvacCandidate(place: GooglePlace): EvacCenter | null {
  const lat = Number(place.location?.latitude);
  const lng = Number(place.location?.longitude);
  const name = place.displayName?.text?.trim();
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const type = TYPE_LABELS[place.primaryType ?? '']
    ?? (place.types ?? []).map(t => TYPE_LABELS[t]).find(Boolean)
    ?? 'public_building';

  return {
    id: `google-${place.id ?? `${lat},${lng}`}`,
    placeId: place.id,
    name,
    address: place.formattedAddress ?? '',
    lat,
    lng,
    capacity: 0,
    type,
    source: 'google_places',
    verificationStatus: 'candidate',
  };
}
