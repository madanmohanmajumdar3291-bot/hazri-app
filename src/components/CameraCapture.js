import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ScanRing from './ScanRing';
import FaceGuide, { directionFromInstruction } from './FaceGuide';
import { useTheme } from '../context/ThemeContext';
import { generateEmbedding } from '../services/faceService';

// Phone-unlock-speed live scanning: check for a face several times a second
// instead of once — the guide ring reacts almost instantly to being framed.
const LIVE_SCAN_INTERVAL_MS = 700;
// How long a face has to stay steadily detected before auto-capturing —
// long enough to avoid firing on a single lucky frame, short enough to feel
// instant, mirroring how phone face unlock "holds" briefly before accepting.
const AUTO_CAPTURE_HOLD_MS = 500;
// Android needs a beat after takePictureAsync resolves before the file is
// reliably readable from disk — capturing immediately can hand back a URI
// that isn't fully flushed yet.
const POST_CAPTURE_DELAY_MS = 300;
// A face only counts once it has been seen inside the scan square on this
// many live frames in a row — one stray frame (or a result left over from
// the previous angle) can no longer trigger a capture on its own.
const STEADY_FRAMES_REQUIRED = 2;
// If the parent never flips `processing` after a capture, unlock capturing
// again after this long so the screen can't get stuck.
const CAPTURE_LOCK_FALLBACK_MS = 4000;

// The photo covers more than the on-screen square shows, so a face detected
// at the edge of the photo can be outside the square the person is looking
// at. Accept only a face that sits well inside the frame, near its centre,
// and big enough to fill a fair part of it. The bounds are symmetric so
// they hold whichever way the raw (skipProcessing) photo is rotated.
const SQUARE_EDGE_MARGIN = 0.06;
const SQUARE_CENTER_TOLERANCE = 0.2;
const MIN_FACE_FRACTION = 0.2;

export function isFaceInSquare(faceBox) {
  if (!faceBox || !faceBox.imageWidth || !faceBox.imageHeight) return true;
  const { left, top, width, height, imageWidth, imageHeight } = faceBox;
  const x0 = left / imageWidth;
  const y0 = top / imageHeight;
  const x1 = (left + width) / imageWidth;
  const y1 = (top + height) / imageHeight;
  const insideEdges =
    x0 >= SQUARE_EDGE_MARGIN && y0 >= SQUARE_EDGE_MARGIN && x1 <= 1 - SQUARE_EDGE_MARGIN && y1 <= 1 - SQUARE_EDGE_MARGIN;
  const centered =
    Math.abs((x0 + x1) / 2 - 0.5) <= SQUARE_CENTER_TOLERANCE && Math.abs((y0 + y1) / 2 - 0.5) <= SQUARE_CENTER_TOLERANCE;
  const bigEnough = Math.min(width, height) / Math.min(imageWidth, imageHeight) >= MIN_FACE_FRACTION;
  return insideEdges && centered && bigEnough;
}

// Same circular ScanRing viewfinder as the Home screen's check-in scanner —
// every face-capture moment in the app (enrollment, re-registration, kiosk)
// now shares one recognizable visual, instead of each screen having its own
// full-screen camera + oval-overlay design.
export default function CameraCapture({
  onCapture,
  onCancel,
  instruction,
  processing = false,
  status = 'idle',
  // Self-registration wants the front (selfie) camera — but registering
  // someone ELSE's face (an employee, manager, partner) needs the back
  // camera, since the admin has to hold the phone facing outward at that
  // person. Defaulting to front for that case forced the admin to hold the
  // phone backwards-facing at arm's length to line up the shot, which is
  // hard to keep steady — auto-capture (needs the face held still) kept
  // missing as a result, making employee registration feel unreliable
  // compared to the identical self-registration flow.
  defaultFacing = 'front',
}) {
  const { colors } = useTheme();
  const styles = useStyles(colors);
  const { width: screenWidth } = useWindowDimensions();
  const frameWidth = Math.min(screenWidth - 32, 380);
  const frameHeight = frameWidth * 1.25;
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState(defaultFacing);
  const [liveDetected, setLiveDetected] = useState(false);
  const [faceOutside, setFaceOutside] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const cameraRef = useRef(null);
  const liveScanningRef = useRef(false);
  // Bumped on every capture and every new instruction, so a live-scan result
  // that started before either is thrown away instead of counting toward
  // the next angle.
  const generationRef = useRef(0);
  const steadyFramesRef = useRef(0);
  const capturingRef = useRef(false);
  const captureLockTimerRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(captureLockTimerRef.current);
    };
  }, []);

  // Live pre-capture feedback: continuously scan the preview so the ring
  // turns green the moment a face is detected, before the user taps
  // capture — instead of only finding out after the fact that it failed.
  useEffect(() => {
    if (!permission?.granted || !cameraReady || processing) return;

    const timer = setInterval(async () => {
      if (liveScanningRef.current || capturingRef.current || processing || !cameraRef.current) return;
      liveScanningRef.current = true;
      const generation = generationRef.current;
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.3, skipProcessing: true, shutterSound: false });
        const result = await generateEmbedding(photo.uri);
        if (!mountedRef.current || generation !== generationRef.current) return;
        const inSquare = result.success && isFaceInSquare(result.faceBox);
        steadyFramesRef.current = inSquare ? steadyFramesRef.current + 1 : 0;
        setFaceOutside(result.success && !inSquare);
        setLiveDetected(steadyFramesRef.current >= STEADY_FRAMES_REQUIRED);
      } catch (_e) {
        if (mountedRef.current && generation === generationRef.current) {
          steadyFramesRef.current = 0;
          setLiveDetected(false);
        }
      } finally {
        liveScanningRef.current = false;
      }
    }, LIVE_SCAN_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [permission?.granted, cameraReady, processing]);

  function resetLiveDetection() {
    generationRef.current += 1;
    steadyFramesRef.current = 0;
    setLiveDetected(false);
    setFaceOutside(false);
  }

  function releaseCaptureLock() {
    clearTimeout(captureLockTimerRef.current);
    capturingRef.current = false;
  }

  // New angle: start detection from scratch and allow the next capture.
  useEffect(() => {
    resetLiveDetection();
    releaseCaptureLock();
  }, [instruction]);

  // The parent finished handling a capture (e.g. it failed and asks again
  // for the same angle): allow capturing again.
  useEffect(() => {
    if (!processing) releaseCaptureLock();
  }, [processing]);

  const handleCapture = useCallback(async () => {
    // One capture at a time: auto-capture and the manual button used to be
    // able to fire together, saving the same angle twice.
    if (!cameraRef.current || processing || !cameraReady || capturingRef.current) return;
    capturingRef.current = true;
    resetLiveDetection();
    captureLockTimerRef.current = setTimeout(() => {
      capturingRef.current = false;
    }, CAPTURE_LOCK_FALLBACK_MS);
    // skipProcessing:true here to match every live-scan capture elsewhere in
    // the app (Home/Kiosk attendance, Menu Unlock) — what matters for a
    // correct match later is that registration and live-scanning treat
    // orientation the SAME way, not which convention they use. Skipping
    // processing on both sides is also far cheaper per-frame, which matters
    // a lot on lower-end Android devices doing this repeatedly.
    let photo;
    try {
      photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: false,
        exif: false,
        skipProcessing: true,
        shutterSound: false,
      });
    } catch (_e) {
      releaseCaptureLock();
      return;
    }
    // Give Android a moment to finish writing the file before we read it.
    setTimeout(() => onCapture(photo.uri), POST_CAPTURE_DELAY_MS);
  }, [processing, cameraReady, onCapture]);

  // Auto-capture, like phone face unlock: once the face has been held
  // steadily in frame for AUTO_CAPTURE_HOLD_MS, capture automatically —
  // no tap needed. The manual capture button below still works as a
  // fallback for anyone whose face isn't reading cleanly.
  useEffect(() => {
    if (!liveDetected || processing || !cameraReady) return;
    const timer = setTimeout(() => {
      handleCapture();
    }, AUTO_CAPTURE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [liveDetected, processing, cameraReady, handleCapture]);

  if (!permission) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.permissionText}>Hazri needs camera access to register and verify your face.</Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Grant Camera Access</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelLink} onPress={onCancel}>
            <Text style={styles.cancelLinkText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function toggleFacing() {
    setFacing((current) => (current === 'front' ? 'back' : 'front'));
  }

  const ringStatus = processing ? 'scanning' : status === 'error' ? 'fail' : liveDetected ? 'success' : 'idle';
  const guideDirection = directionFromInstruction(instruction);
  const guideActive = cameraReady && !processing && !liveDetected;

  return (
    <View style={styles.container}>
      <View style={styles.ringWrap}>
        <View>
          <ScanRing width={frameWidth} height={frameHeight} status={ringStatus}>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFillObject}
              facing={facing}
              onCameraReady={() => setCameraReady(true)}
            />
            {!cameraReady && (
              <View style={styles.startingOverlay}>
                <ActivityIndicator color={colors.white} />
              </View>
            )}
          </ScanRing>
          <TouchableOpacity style={styles.flipButton} onPress={toggleFacing} hitSlop={10}>
            <MaterialCommunityIcons name="camera-flip-outline" size={20} color={colors.white} />
          </TouchableOpacity>
        </View>

        <View style={styles.guideRow}>
          <FaceGuide direction={guideDirection} colors={colors} active={guideActive} />
        </View>

        {instruction ? <Text style={styles.instruction}>{instruction}</Text> : null}
        <Text style={styles.caption}>
          {processing
            ? 'Processing face...'
            : liveDetected
            ? "Face detected ✓ — hold still..."
            : faceOutside
            ? 'Move your face into the square'
            : 'Line up your face in the square'}
        </Text>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlButton} onPress={onCancel}>
          <Text style={styles.controlText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.captureButton, (processing || !cameraReady) && styles.disabled]}
          onPress={handleCapture}
          disabled={processing || !cameraReady}
        >
          <View style={styles.captureInner} />
        </TouchableOpacity>
        <View style={styles.controlButton} />
      </View>
    </View>
  );
}

function useStyles(colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    ringWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    startingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    flipButton: {
      position: 'absolute',
      bottom: 6,
      right: 6,
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: 'rgba(255,255,255,0.5)',
    },
    guideRow: {
      marginTop: 18,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
    },
    instruction: {
      marginTop: 4,
      fontFamily: 'Sora_700Bold',
      fontSize: 16,
      color: colors.textPrimary,
      textAlign: 'center',
      paddingHorizontal: 32,
    },
    caption: {
      marginTop: 8,
      fontFamily: 'Inter_600SemiBold',
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 32,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    permissionText: {
      color: colors.textPrimary,
      fontSize: 15,
      textAlign: 'center',
      marginBottom: 20,
    },
    permissionButton: {
      backgroundColor: colors.accent,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: colors.radiusSm,
    },
    permissionButtonText: {
      color: colors.white,
      fontFamily: 'Inter_600SemiBold',
    },
    cancelLink: {
      marginTop: 16,
    },
    cancelLinkText: {
      color: colors.accent,
      opacity: 0.9,
    },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 32,
      paddingVertical: 24,
    },
    controlButton: {
      minWidth: 56,
    },
    controlText: {
      color: colors.accent,
      fontSize: 14,
      fontFamily: 'Inter_600SemiBold',
    },
    captureButton: {
      width: 72,
      height: 72,
      borderRadius: 36,
      borderWidth: 4,
      borderColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    captureInner: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.accent,
    },
    disabled: {
      opacity: 0.5,
    },
  });
}

