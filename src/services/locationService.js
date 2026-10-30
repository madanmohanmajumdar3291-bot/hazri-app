import * as Location from 'expo-location';
import { supabase } from './supabase';

// Haversine distance in meters — good enough for geofence radii of ~50-500m,
// no need for a more precise ellipsoidal calculation at this scale.
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function requestLocationPermission() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function getCurrentPosition() {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== 'granted') {
    const granted = await requestLocationPermission();
    if (!granted) return null;
  }
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
  };
}

// Free, keyless geocoding via OpenStreetMap's Nominatim — lets an admin
// find a site by typing an address instead of needing to stand there with
// GPS. Rate-limited to light/occasional use, which fits "search once while
// adding a site" fine.
export async function searchAddress(query) {
  if (!query || query.trim().length < 3) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Address search failed');
  const results = await response.json();
  return results.map((r) => ({
    label: r.display_name,
    latitude: parseFloat(r.lat),
    longitude: parseFloat(r.lon),
  }));
}

export async function getCompanySites(companyId) {
  const { data, error } = await supabase
    .from('sites')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true);
  if (error) throw error;
  return data;
}

export async function createSite({ companyId, name, latitude, longitude, radiusMeters }) {
  const { data, error } = await supabase
    .from('sites')
    .insert({ company_id: companyId, name, latitude, longitude, radius_meters: radiusMeters ?? 150 })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateSite(siteId, updates) {
  const { data, error } = await supabase.from('sites').update(updates).eq('id', siteId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteSite(siteId) {
  const { error } = await supabase.from('sites').update({ is_active: false }).eq('id', siteId);
  if (error) throw error;
}

// Finds the nearest active site and reports whether the point falls inside
// its geofence radius. Returns null if the company has no sites configured
// yet (geofencing is opt-in — no sites means no restriction).
export function resolveGeofence(position, sites) {
  if (!sites || sites.length === 0) return null;

  let nearest = null;
  let nearestDistance = Infinity;
  for (const site of sites) {
    const d = distanceMeters(position.latitude, position.longitude, site.latitude, site.longitude);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = site;
    }
  }

  return {
    site: nearest,
    distanceMeters: nearestDistance,
    isWithinGeofence: nearestDistance <= nearest.radius_meters,
  };
}

export async function recordLocationPing({ employeeId, companyId, position, eventType, siteId, isWithinGeofence }) {
  const { error } = await supabase.from('employee_locations').insert({
    employee_id: employeeId,
    company_id: companyId,
    latitude: position.latitude,
    longitude: position.longitude,
    accuracy_meters: position.accuracy ?? null,
    event_type: eventType ?? 'ping',
    site_id: siteId ?? null,
    is_within_geofence: isWithinGeofence ?? null,
  });
  if (error) throw error;
}

export async function getLatestLocationsForCompany(companyId) {
  // One row per employee — the app has no window functions available client
  // side, so pull recent pings and reduce to latest-per-employee here.
  const { data, error } = await supabase
    .from('employee_locations')
    .select('*, employees(name)')
    .eq('company_id', companyId)
    .order('recorded_at', { ascending: false })
    .limit(500);
  if (error) throw error;

  const latestByEmployee = new Map();
  for (const row of data) {
    if (!latestByEmployee.has(row.employee_id)) {
      latestByEmployee.set(row.employee_id, row);
    }
  }
  return Array.from(latestByEmployee.values());
}

export function computeRouteDistanceMeters(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distanceMeters(points[i - 1].latitude, points[i - 1].longitude, points[i].latitude, points[i].longitude);
  }
  return total;
}

export async function getMovementTimeline(employeeId, { fromDate, toDate } = {}) {
  let query = supabase
    .from('employee_locations')
    .select('*')
    .eq('employee_id', employeeId)
    .order('recorded_at', { ascending: true });

  if (fromDate) query = query.gte('recorded_at', fromDate);
  if (toDate) query = query.lte('recorded_at', toDate);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}
