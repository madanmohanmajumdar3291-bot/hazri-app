import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScanRing from '../../components/ScanRing';
import FaceGuide from '../../components/FaceGuide';
import Button from '../../components/Button';
import OfflineBanner from '../../components/OfflineBanner';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useAttendanceScanner } from '../../hooks/useAttendanceScanner';

// Same circular ScanRing viewfinder as the Home screen's landing-page
// scanner — a shared walk-up station should look like a bigger version of
// the same check-in moment, not a visually distinct "kiosk mode".
export default function KioskScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const frameWidth = Math.min(screenWidth - 24, 420);
  const frameHeight = frameWidth * 1.25;
  const { userData } = useAuth();
  const companyId = userData?.company_id;
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState('front');
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const cameraRef = useRef(null);

  // See HomeScreen.js — Android can leave the camera preview black on
  // returning to this screen; remounting via key on focus fixes it.
  useFocusEffect(
    useCallback(() => {
      setCameraReady(false);
      setCameraKey((k) => k + 1);
    }, [])
  );

  // Self-heal: if the remount above still leaves onCameraReady never
  // firing, remount again automatically instead of requiring a manual flip.
  useEffect(() => {
    if (!permission?.granted || cameraReady) return;
    const timer = setTimeout(() => setCameraKey((k) => k + 1), 2500);
    return () => clearTimeout(timer);
  }, [permission?.granted, cameraReady, cameraKey]);

  const { loadingRoster, scanning, result, liveHint, isConnected, pendingCount, lastSyncedAt, idle, resumeScanning, pictureSize } =
    useAttendanceScanner({
      companyId,
      cameraRef,
      // See HomeScreen.js — don't let the scanner capture from the
      // remounted CameraView before it's actually streaming live frames.
      enabled: Boolean(permission?.granted) && cameraReady,
      isKiosk: true,
      facing,
    });

  function toggleFacing() {
    setCameraReady(false);
    setFacing((current) => (current === 'front' ? 'back' : 'front'));
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
        <Text style={styles.infoText}>Hazri needs camera access for kiosk mode.</Text>
        <Button title="Grant Camera Access" onPress={requestPermission} />
        <TouchableOpacity onPress={() => navigation.replace('Menu')}>
          <Text style={styles.backLink}>Back to Menu</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const ringStatus = result ? (result.type === 'success' ? 'success' : 'fail') : scanning ? 'scanning' : 'idle';
  const caption = result
    ? result.message
    : loadingRoster
    ? 'Loading employee roster...'
    : !cameraReady
    ? 'Starting camera...'
    : idle
    ? 'No face detected — tap Scan when you\'re ready'
    : liveHint || 'Show your face to check in / out';
  const showRetryButton = idle || result?.type === 'error';

  return (
    <View style={styles.container}>
      <OfflineBanner visible={!isConnected} pendingCount={pendingCount} lastSyncedAt={lastSyncedAt} />

      <View style={styles.title}>
        <Text style={styles.titleText}>Kiosk Mode</Text>
      </View>

      <View style={styles.cameraWrap}>
        <View>
          <ScanRing width={frameWidth} height={frameHeight} status={ringStatus}>
            <CameraView
              key={cameraKey}
              ref={cameraRef}
              style={StyleSheet.absoluteFillObject}
              facing={facing}
              pictureSize={pictureSize ?? undefined}
              onCameraReady={() => setCameraReady(true)}
            />
          </ScanRing>
          <TouchableOpacity style={styles.flipButton} onPress={toggleFacing} hitSlop={10}>
            <MaterialCommunityIcons name="camera-flip-outline" size={22} color={colors.white} />
          </TouchableOpacity>
        </View>
        {cameraReady && !result && (
          <View style={styles.guideRow}>
            <FaceGuide direction="auto" colors={colors} active={!scanning} />
          </View>
        )}
        <Text style={styles.cameraCaption}>{caption}</Text>
        {showRetryButton && (
          <TouchableOpacity style={styles.retryButton} onPress={resumeScanning}>
            <MaterialCommunityIcons name="camera-outline" size={18} color={colors.white} />
            <Text style={styles.retryButtonText}>Scan Again</Text>
          </TouchableOpacity>
        )}
        {isConnected && pendingCount > 0 ? (
          <Text style={styles.syncStatus}>{pendingCount} record(s) pending sync</Text>
        ) : null}
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
        <TouchableOpacity style={styles.footerButton} onPress={() => navigation.replace('Menu')}>
          <MaterialCommunityIcons name="view-grid-outline" size={20} color={colors.accent} />
          <Text style={styles.footerButtonText}>Back to Menu</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      backgroundColor: colors.background,
    },
    infoText: {
      fontSize: 15,
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: 16,
    },
    backLink: {
      color: colors.accent,
      marginTop: 16,
      fontWeight: '600',
    },
    title: {
      paddingHorizontal: 20,
      paddingTop: 44,
    },
    titleText: {
      fontFamily: 'Sora_700Bold',
      fontSize: 20,
      color: colors.textPrimary,
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
      marginTop: 16,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cameraCaption: {
      marginTop: 4,
      fontFamily: 'Inter_600SemiBold',
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 32,
    },
    syncStatus: {
      marginTop: 8,
      color: colors.textSecondary,
      opacity: 0.7,
      fontSize: 11,
      textAlign: 'center',
    },
    retryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.accent,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: colors.radiusPill,
      marginTop: 16,
    },
    retryButtonText: {
      color: colors.white,
      fontFamily: 'Inter_600SemiBold',
      fontSize: 14,
    },
    footer: {
      paddingHorizontal: 20,
      paddingBottom: 32,
      paddingTop: 12,
    },
    footerButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 56,
      borderRadius: colors.radiusPill,
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: colors.accent,
    },
    footerButtonText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 15,
      color: colors.accent,
    },
  });
}

