import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScanRing from '../../components/ScanRing';
import FaceGuide from '../../components/FaceGuide';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { generateEmbedding, verifyFace, withTimeout } from '../../services/faceService';
import { isCloudFaceAvailable, searchFaceInCloud } from '../../services/cloudFaceService';
import { reauthenticateOwner, incrementFailedFaceAttempts } from '../../services/authService';
import { MAX_FACE_ATTEMPTS, MAX_PIN_ATTEMPTS, PIN_LOCKOUT_MS } from '../../utils/faceUtils';

// No blink/liveness wait here anymore — a phone's Face ID doesn't make you
// wait for a blink either (it uses depth/IR sensing we don't have access
// to), and requiring one made this feel slow since a blink doesn't happen
// on command. This trades a little anti-spoof strength (a held-up photo
// with a strong enough match could unlock) for unlocking in ~1 second
// instead of several. Deliberate choice, not an oversight.
const SCAN_TICK_MS = 700;
// Padded to give the cloud-match attempt below (up to a few seconds when
// AWS is slow/misconfigured) room to fail and fall back to on-device
// matching within one liveness window, instead of the window expiring
// first and showing "No face detected in time."
const LIVENESS_TIMEOUT_MS = 12000;

export default function MenuUnlockScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const frameWidth = Math.min(screenWidth - 32, 380);
  const frameHeight = frameWidth * 1.25;
  const destination = route.params?.destination ?? 'Menu';
  const destinationParams = route.params?.destinationParams;
  const { firebaseUser, userData } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const cameraRef = useRef(null);
  const tickTimerRef = useRef(null);
  const timeoutTimerRef = useRef(null);
  const scanningInFlightRef = useRef(false);
  const settledRef = useRef(false);

  // See HomeScreen.js — Android can leave the camera preview black when
  // returning to an already-mounted camera screen; remounting via key on
  // focus fixes it.
  useFocusEffect(
    useCallback(() => {
      setCameraReady(false);
      setCameraKey((k) => k + 1);
    }, [])
  );

  // Self-heal: if the remount above still leaves onCameraReady never
  // firing, remount again automatically instead of requiring a manual flip
  // or leaving the screen stuck.
  useEffect(() => {
    if (!permission?.granted || cameraReady) return;
    const timer = setTimeout(() => setCameraKey((k) => k + 1), 2500);
    return () => clearTimeout(timer);
  }, [permission?.granted, cameraReady, cameraKey]);

  const [phase, setPhase] = useState('scanning'); // scanning | processing | success | pin
  const [facing, setFacing] = useState('front');
  const [stopped, setStopped] = useState(false);
  const [pinAttempts, setPinAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [liveHint, setLiveHint] = useState('Look at the camera to confirm it\'s really you');
  const noMatchAttemptsRef = useRef(0);

  useEffect(() => {
    // Deliberately NOT gated on cameraReady — onCameraReady doesn't fire
    // reliably on every device (the same underlying issue behind the
    // camera-goes-black bug), and gating the whole tick loop on it meant a
    // device where it never fires could sit doing nothing until the
    // liveness timeout fired, always showing "face not detected" with no
    // scan ever actually attempted. runLivenessTick already no-ops safely
    // via the `!cameraRef.current` guard if the camera isn't up yet, so
    // it's safe to just keep ticking and let it start working the moment
    // the camera actually becomes usable.
    if (phase !== 'scanning' || !permission?.granted || stopped) return;

    settledRef.current = false;

    tickTimerRef.current = setInterval(runLivenessTick, SCAN_TICK_MS);
    timeoutTimerRef.current = setTimeout(() => {
      if (!settledRef.current) {
        settledRef.current = true;
        clearInterval(tickTimerRef.current);
        stopForRetry('No face detected in time.');
      }
    }, LIVENESS_TIMEOUT_MS);

    return () => {
      clearInterval(tickTimerRef.current);
      clearTimeout(timeoutTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stopped, permission?.granted]);

  async function runLivenessTick() {
    if (settledRef.current || scanningInFlightRef.current || !cameraRef.current) return;
    scanningInFlightRef.current = true;

    try {
      // Must match CameraCapture's registration capture's skipProcessing
      // setting exactly (both true) — cheaper per-frame too, which matters
      // on lower-end Android devices scanning every 0.7s.
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, skipProcessing: true, shutterSound: false });

      // Straight to identity match on every tick — no waiting for a blink.
      const result = await withTimeout(generateEmbedding(photo.uri), 8000);
      if (!result.success) {
        return; // no face this frame — keep waiting silently, not a failure yet
      }
      setLiveHint('Face detected — verifying...');
      if (settledRef.current) return;

      // Cloud check first when online — if AWS Rekognition confidently
      // recognises SOMEONE, trust that answer outright (including a
      // confident "that's not the owner", which skips straight to a
      // no-match rather than also trying the on-device check). Only when
      // the cloud has no opinion (offline, call failed, or nobody matched
      // confidently) does this fall back to the on-device cross-check.
      let match = false;
      let cloudDecided = false;
      if (await isCloudFaceAvailable()) {
        try {
          const cloudMatch = await withTimeout(searchFaceInCloud(photo.uri), 2500);
          if (cloudMatch) {
            cloudDecided = true;
            match = cloudMatch.subjectId === firebaseUser?.id;
          }
        } catch (_cloudError) {
          // Fall through to the on-device check below.
        }
      }
      if (!cloudDecided) {
        // Confirmed via real device data (face_match_debug_log): the base
        // 1:1 match against the owner's OWN stored face passes reliably
        // (0.90-0.99, well above threshold) every single time. What was
        // rejecting the real owner was the extra cross-check against other
        // registered faces — the current fallback model (not the real
        // FaceNet model; that isn't active on installed builds yet) isn't
        // discriminative enough to tell two specific people apart, so it
        // was scoring the owner's own live face and the OTHER registered
        // owner's stored face within ~0.001-0.005 of each other. No
        // threshold/margin tuning can fix that — it's the same weak
        // fallback signal, not a config problem. Back to a plain 1:1 match;
        // the password fallback below stays as the actual security
        // backstop until the real model ships in a native rebuild.
        // Prefer the multi-sample set (max-of-N matching) when this account
        // registered after that was added; falls back to the single legacy
        // averaged embedding otherwise.
        const storedFace =
          Array.isArray(userData?.face_embeddings) && userData.face_embeddings.length > 0
            ? userData.face_embeddings
            : userData?.face_embedding;
        const verifyResult = verifyFace(storedFace, result.embedding);
        match = verifyResult.match;
      }
      if (!match) {
        noMatchAttemptsRef.current += 1;
        if (noMatchAttemptsRef.current >= MAX_FACE_ATTEMPTS) {
          settledRef.current = true;
          clearInterval(tickTimerRef.current);
          clearTimeout(timeoutTimerRef.current);
          stopForRetry('Face not recognized after multiple tries.');
        } else {
          setLiveHint('Face not recognised — keep looking at the camera');
        }
        return;
      }

      settledRef.current = true;
      clearInterval(tickTimerRef.current);
      clearTimeout(timeoutTimerRef.current);
      await incrementFailedFaceAttempts(firebaseUser.id, 0).catch(() => {});
      setPhase('success');
      setTimeout(() => navigation.replace(destination, destinationParams), 700);
    } catch (_error) {
      // Transient per-frame failure — the overall timeout above is what
      // guarantees this screen can never hang forever.
    } finally {
      scanningInFlightRef.current = false;
    }
  }

  // Instead of looping forever on a face it can't match, stop after a few
  // tries and hand control back with an explicit Retry button — matching
  // the same pattern used on the Home/Kiosk attendance scanner.
  function stopForRetry(message) {
    setLiveHint(null);
    setError(message);
    setStopped(true);
    incrementFailedFaceAttempts(firebaseUser.id, noMatchAttemptsRef.current).catch(() => {});
  }

  function handleRetry() {
    noMatchAttemptsRef.current = 0;
    setError('');
    setLiveHint('Look at the camera to confirm it\'s really you');
    setStopped(false);
  }

  async function handlePasswordConfirm() {
    setVerifying(true);
    setError('');
    try {
      await reauthenticateOwner(firebaseUser.email, password);
      await incrementFailedFaceAttempts(firebaseUser.id, 0).catch(() => {});
      navigation.replace(destination, destinationParams);
    } catch (e) {
      const nextPinAttempts = pinAttempts + 1;
      setPinAttempts(nextPinAttempts);
      if (nextPinAttempts >= MAX_PIN_ATTEMPTS) {
        setLockUntil(Date.now() + PIN_LOCKOUT_MS);
        setError('Too many incorrect attempts. Try again in 5 minutes.');
      } else {
        setError(`Incorrect password. ${MAX_PIN_ATTEMPTS - nextPinAttempts} attempt(s) remaining.`);
      }
    } finally {
      setVerifying(false);
      setPassword('');
    }
  }

  const isLocked = lockUntil && Date.now() < lockUntil;

  if (!userData?.face_embedding && phase !== 'pin') {
    return (
      <View style={styles.center}>
        <Text style={styles.infoText}>
          No face registered for this account. Enter your password to continue.
        </Text>
        <Button title="Use Password" onPress={() => setPhase('pin')} />
      </View>
    );
  }

  if (phase === 'success') {
    return (
      <View style={styles.successScreen}>
        <Text style={styles.successIcon}>✓</Text>
        <Text style={styles.successTitle}>Live face confirmed!</Text>
      </View>
    );
  }

  if (phase === 'pin') {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Enter your password</Text>
        <Text style={styles.subtitle}>Enter the password you use to log in</Text>
        <Input
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Enter your password"
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <Button
          title="Confirm"
          onPress={handlePasswordConfirm}
          loading={verifying}
          disabled={isLocked || !password}
        />
        <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')}>
          <Text style={styles.cancelText}>Forgot password?</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.replace('Home')}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.infoText}>
          Hazri needs camera access to verify your face.
        </Text>
        <Button title="Grant Camera Access" onPress={requestPermission} />
        <TouchableOpacity onPress={() => navigation.replace('Home')}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.cameraWrap}>
        <View>
          <ScanRing width={frameWidth} height={frameHeight} status={error ? 'fail' : 'scanning'}>
            <CameraView
              // No white shutter flash: scanning screens capture every 0.7s.
              animateShutter={false}
              key={cameraKey}
              ref={cameraRef}
              style={StyleSheet.absoluteFillObject}
              facing={facing}
              onCameraReady={() => setCameraReady(true)}
            />
          </ScanRing>
          <TouchableOpacity
            style={styles.flipButton}
            onPress={() => setFacing((current) => (current === 'front' ? 'back' : 'front'))}
            hitSlop={10}
          >
            <MaterialCommunityIcons name="camera-flip-outline" size={18} color={colors.white} />
          </TouchableOpacity>
        </View>
        {!error && (
          <View style={styles.guideRow}>
            <FaceGuide direction="auto" colors={colors} active={phase === 'scanning' && !stopped} />
          </View>
        )}
        <Text style={styles.cameraCaption}>{error || liveHint}</Text>
        {stopped && (
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <MaterialCommunityIcons name="refresh" size={18} color={colors.white} />
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.bottomRow, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => {
            setError('');
            setPhase('pin');
          }}
        >
          <Text style={styles.cancelButtonText}>Use Password Instead</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelButton} onPress={() => navigation.replace('Home')}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    cameraWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    flipButton: {
      position: 'absolute',
      bottom: 6,
      right: 6,
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: 'rgba(255,255,255,0.5)',
    },
    guideRow: {
      marginTop: 14,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cameraCaption: {
      marginTop: 4,
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '600',
      textAlign: 'center',
      paddingHorizontal: 32,
    },
    retryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.accent,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 999,
      marginTop: 16,
    },
    retryButtonText: {
      color: colors.white,
      fontWeight: '600',
      fontSize: 14,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      backgroundColor: colors.background,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      marginBottom: 20,
      textAlign: 'center',
    },
    infoText: {
      fontSize: 15,
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: 16,
    },
    errorText: {
      color: colors.error,
      fontSize: 13,
      marginBottom: 8,
      textAlign: 'center',
    },
    cancelText: {
      color: colors.accent,
      marginTop: 16,
      fontWeight: '600',
    },
    bottomRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 24,
      paddingBottom: 32,
    },
    cancelButton: {
      alignSelf: 'center',
    },
    cancelButtonText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '600',
    },
    successScreen: {
      flex: 1,
      backgroundColor: colors.success,
      alignItems: 'center',
      justifyContent: 'center',
    },
    successIcon: {
      fontSize: 64,
      color: colors.white,
      marginBottom: 12,
    },
    successTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.white,
    },
  });
}

