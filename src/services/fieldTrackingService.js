import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from './supabase';
import { recordLocationPing } from './locationService';

const BACKGROUND_LOCATION_TASK = 'hazri-field-location-tracking';

// Interval/distance-based, not continuous streaming — battery-reasonable
// for a full field shift (matches the 3-5 min / ~200m cadence agreed on).
const TIME_INTERVAL_MS = 3 * 60 * 1000;
const DISTANCE_INTERVAL_M = 200;

let activeEmployeeId = null;
let activeCompanyId = null;

if (Platform.OS !== 'web' && !TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data || !activeEmployeeId || !activeCompanyId) return;
    const { locations } = data;
    const latest = locations?.[locations.length - 1];
    if (!latest) return;
    try {
      await recordLocationPing({
        employeeId: activeEmployeeId,
        companyId: activeCompanyId,
        position: { latitude: latest.coords.latitude, longitude: latest.coords.longitude, accuracy: latest.coords.accuracy },
        eventType: 'ping',
      });
    } catch (_e) {
      // Dropped ping — the next interval tick will catch up, no need to retry.
    }
  });
}

export async function hasLocationConsent(employee) {
  return Boolean(employee?.location_consent_given_at);
}

export async function grantLocationConsent(employeeId) {
  const { data, error } = await supabase
    .from('employees')
    .update({ location_consent_given_at: new Date().toISOString() })
    .eq('id', employeeId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function startFieldTracking(employeeId, companyId) {
  if (Platform.OS === 'web') return { started: false, reason: 'unsupported-on-web' };

  // The background task is a single shared OS resource — if a shared
  // device (e.g. an office tablet used to check remote employees in
  // before they head out) is already tracking a DIFFERENT employee,
  // starting a new session here would silently steal it, and that
  // employee's checkout would later stop tracking for the wrong person.
  if (activeEmployeeId && activeEmployeeId !== employeeId) {
    console.warn(
      `[fieldTracking] already tracking employee ${activeEmployeeId} on this device; skipping start for ${employeeId}`
    );
    return { started: false, reason: 'device-busy' };
  }

  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return { started: false, reason: 'permission-denied' };
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return { started: false, reason: 'background-permission-denied' };

  activeEmployeeId = employeeId;
  activeCompanyId = companyId;

  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (!alreadyStarted) {
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: TIME_INTERVAL_MS,
      distanceInterval: DISTANCE_INTERVAL_M,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Hazri is tracking your shift location',
        notificationBody: 'Location logging stops automatically when you check out.',
      },
    });
  }

  await supabase.from('employees').update({ location_tracking_active: true }).eq('id', employeeId);
  return { started: true };
}

export async function stopFieldTracking(employeeId) {
  if (Platform.OS === 'web') return;

  // If the device is currently tracking a DIFFERENT employee, this
  // checkout must not tear down that shared session — just clear this
  // employee's own DB flag (their tracking, if any, never actually owned
  // the shared task) and leave the real active session running.
  if (employeeId && activeEmployeeId && employeeId !== activeEmployeeId) {
    await supabase.from('employees').update({ location_tracking_active: false }).eq('id', employeeId);
    return;
  }

  const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (started) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
  activeEmployeeId = null;
  activeCompanyId = null;
  if (employeeId) {
    await supabase.from('employees').update({ location_tracking_active: false }).eq('id', employeeId);
  }
}

