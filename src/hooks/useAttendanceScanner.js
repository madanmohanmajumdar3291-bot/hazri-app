import { useEffect, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import { generateEmbedding, withTimeout } from '../services/faceService';
import { getCompanyEmployees, findMatchingEmployee, recordAttendance } from '../services/attendanceService';
import { getPendingCount, getLastSyncedAt, subscribeToNetwork, syncPendingAttendance } from '../services/syncService';
import { isCloudFaceAvailable, searchFaceInCloud } from '../services/cloudFaceService';

// No blink-liveness wait here anymore, matching the same call already made
// for Menu Unlock — waiting for a natural blink made this scanner sit there
// indefinitely on frames where the blink detector's eye-openness signal
// didn't read cleanly (lighting/angle/blink speed vs. poll rate), which
// looked like "not marking attendance" to a walking-up employee. Straight to
// identity match on every tick instead; trades some anti-spoof strength for
// actually working reliably.
const SCAN_INTERVAL_MS = 700;
const RESULT_DISPLAY_MS = 2500;
// Capturing a photo + running detection every tick forever — even with no
// one ever in frame — is real, needless battery/CPU drain. After this many
// consecutive empty frames (~4.2s of nobody there), stop polling entirely
// until a person is physically present to tap Scan. Safe to pause fully
// here (unlike pausing on a failed MATCH) because nobody is mid-interaction
// when the camera's just sitting there empty.
const IDLE_AFTER_MISSES = 6;

// Shared walk-up-and-go attendance engine: loads the company roster, polls
// the camera for a face, matches it, and records the check-in/check-out —
// with no tap required. Used by both Kiosk Mode (a dedicated full-screen
// station) and the Home screen (the same scan running right on the landing
// screen), so the matching logic only lives in one place.
export function useAttendanceScanner({ companyId, cameraRef, enabled, isKiosk = false }) {
  const [employees, setEmployees] = useState([]);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [isConnected, setIsConnected] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [liveHint, setLiveHint] = useState(null);
  const [idle, setIdle] = useState(false);

  const scanningRef = useRef(false);
  const pausedRef = useRef(false);
  const idleRef = useRef(false);
  const noFaceStreakRef = useRef(0);
  const timerRef = useRef(null);
  const consecutiveErrorsRef = useRef(0);
  // Who was matched last, and whether their face has genuinely left the
  // frame since — a timer can't tell "still standing there" apart from
  // "left and came back", but "did the camera stop seeing this face at
  // least once" can. This is what stops a check-in from silently flipping
  // to checkout just because someone kept looking at their own phone.
  const lastMatchedIdRef = useRef(null);
  const hasLeftFrameRef = useRef(true);

  async function refreshSyncStatus() {
    try {
      const [count, syncedAt] = await Promise.all([getPendingCount(), getLastSyncedAt()]);
      setPendingCount(count);
      setLastSyncedAt(syncedAt);
    } catch (_e) {
      // non-critical UI status, ignore failures
    }
  }

  useEffect(() => {
    refreshSyncStatus();
    // NetInfo's listener only fires on a connectivity CHANGE, not on mount
    // — a device that's been online the whole time would otherwise never
    // get this first flush, leaving anything already queued (e.g. from
    // before this device last restarted) stuck until the network happens
    // to toggle. Try once immediately in addition to the change-triggered
    // syncs below.
    syncPendingAttendance().catch(() => {}).finally(refreshSyncStatus);
    const interval = setInterval(refreshSyncStatus, 5000);

    const unsubscribe = subscribeToNetwork((online) => {
      setIsConnected(online);
      if (online) {
        syncPendingAttendance()
          .catch(() => {})
          .finally(refreshSyncStatus);
      }
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadRoster() {
      if (!companyId) return;
      try {
        const data = await getCompanyEmployees(companyId);
        if (!cancelled) setEmployees(data);
      } catch (error) {
        // Without this, a failed roster fetch left the scanner stuck on
        // "Loading employee roster..." forever with no way to tell why.
        if (!cancelled) {
          Toast.show({ type: 'error', text1: 'Could not load employee roster', text2: error.message });
        }
      } finally {
        if (!cancelled) setLoadingRoster(false);
      }
    }
    loadRoster();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  useEffect(() => {
    if (!enabled || loadingRoster) return;

    timerRef.current = setInterval(() => {
      if (!scanningRef.current && !pausedRef.current && !idleRef.current) {
        runScan();
      }
    }, SCAN_INTERVAL_MS);

    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, loadingRoster, employees]);

  async function runScan() {
    if (!cameraRef.current) return;
    scanningRef.current = true;
    setScanning(true);

    try {
      // Must match CameraCapture's registration capture's skipProcessing
      // setting exactly (both true) — what breaks matching is the two
      // sides disagreeing on orientation handling, not which one they pick.
      // skipProcessing:true is also considerably cheaper per-frame, which
      // matters running every 0.7s on lower-end Android devices.
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, skipProcessing: true, shutterSound: false });

      const embeddingResult = await withTimeout(generateEmbedding(photo.uri), 8000);
      if (!embeddingResult.success) {
        noFaceStreakRef.current += 1;
        if (noFaceStreakRef.current >= IDLE_AFTER_MISSES) {
          idleRef.current = true;
          setIdle(true);
        }
        // Nobody's face is in frame at all right now, so whoever was last
        // matched has, by definition, left — clears the way for them to be
        // matched again next time they show up.
        hasLeftFrameRef.current = true;
        return; // no face this frame — keep waiting silently, not a failure yet
      }
      noFaceStreakRef.current = 0;
      setLiveHint('Face detected — verifying...');

      // Cloud match (AWS Rekognition, via search-face) is tried first when
      // online — a real trained model beats the on-device embedding
      // comparison for telling similar-looking people apart. Falls back to
      // the on-device match (works offline, and for anyone not yet
      // cloud-indexed) whenever the cloud call is unavailable, times out, or
      // simply doesn't find a confident match.
      let match = null;
      if (await isCloudFaceAvailable()) {
        try {
          // Kept short deliberately — with AWS not configured yet every call
          // here fails, and this runs before every on-device fallback match.
          // At 6s it was eating almost the whole scan cycle on a dead cloud
          // path; short-circuiting fast keeps the on-device path responsive.
          const cloudMatch = await withTimeout(searchFaceInCloud(photo.uri), 2500);
          if (cloudMatch) {
            const employee = employees.find((e) => e.id === cloudMatch.subjectId);
            if (employee) match = { employee, score: cloudMatch.confidence };
          }
        } catch (_cloudError) {
          // Fall through to on-device matching below.
        }
      }
      if (!match) {
        match = findMatchingEmployee(embeddingResult.embedding, employees);
      }
      consecutiveErrorsRef.current = 0;
      if (!match) {
        // Never stop the walk-up scanner over this — someone else can walk
        // up and scan successfully on the very next tick, and a shared
        // station serving a whole company can't be left waiting on one
        // person to notice and tap a Retry button.
        setLiveHint(null);
        showResult('error', 'Face not recognized. Please contact your manager.');
        return;
      }

      if (match.employee.id !== lastMatchedIdRef.current) {
        // A genuinely different person than whoever was matched last —
        // that alone means the previous person isn't the one in frame
        // anymore, so it counts as having left too.
        hasLeftFrameRef.current = true;
      }

      if (!hasLeftFrameRef.current) {
        // Same person, continuously in frame since their last successful
        // scan — they haven't actually left, so don't flip check-in
        // straight to checkout just because time passed. Keep waiting
        // silently rather than showing an error.
        return;
      }

      lastMatchedIdRef.current = match.employee.id;
      hasLeftFrameRef.current = false;

      setLiveHint(null);
      const attendance = await recordAttendance(match.employee, companyId, { isKiosk });
      if (attendance.type === 'check-in') {
        const time = new Date(attendance.record.check_in).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        showResult('success', `Checked in: ${match.employee.name}\n${time}`);
      } else if (attendance.type === 'check-out') {
        const hours = Math.floor(attendance.durationMinutes / 60);
        const minutes = attendance.durationMinutes % 60;
        showResult('success', `Checked out: ${match.employee.name}\nWorked ${hours}h ${minutes}m`);
      } else {
        showResult('success', `${match.employee.name} already completed attendance today.`);
      }
      refreshSyncStatus();
    } catch (error) {
      // A single dropped frame (camera briefly busy/warming up) is normal on
      // slower devices and shouldn't flash a scary error at the user — only
      // surface it once the camera has genuinely failed several times in a
      // row, and log the real cause so future device reports are debuggable.
      consecutiveErrorsRef.current += 1;
      console.warn('[attendance-scan] capture/match failed:', error?.message || error);
      if (consecutiveErrorsRef.current >= 5) {
        consecutiveErrorsRef.current = 0;
        showResult('error', 'Camera trouble — please try again.');
      }
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }

  function showResult(type, message) {
    pausedRef.current = true;
    setResult({ type, message });
    setTimeout(() => {
      setResult(null);
      pausedRef.current = false;
    }, RESULT_DISPLAY_MS);
  }

  // Manual wake-up — tapping Retry/Scan after the camera went idle from no
  // one being there, or just wanting an immediate re-check right now.
  function resumeScanning() {
    noFaceStreakRef.current = 0;
    idleRef.current = false;
    setIdle(false);
    if (!scanningRef.current) runScan();
  }

  return {
    loadingRoster,
    scanning,
    result,
    liveHint,
    isConnected,
    pendingCount,
    lastSyncedAt,
    idle,
    resumeScanning,
  };
}

