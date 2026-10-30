import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScanRing from '../../components/ScanRing';
import FaceGuide from '../../components/FaceGuide';
import OfflineBanner from '../../components/OfflineBanner';
import AmbientGlow from '../../components/AmbientGlow';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useAttendanceScanner } from '../../hooks/useAttendanceScanner';
import { getEmployeeCount, FREE_EMPLOYEE_LIMIT } from '../../services/employeeService';
import { getBranchAttendanceSummary } from '../../services/recordsService';
import { colorForIndex } from '../../constants/designTokens';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function todayLabel() {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

// The app's front door: a live, always-on ScanRing that scans and marks
// attendance automatically — no tap needed, walk up and it recognizes you —
// plus quick jumps to Settings, Help, the (face-gated) Menu, and adding an
// employee. Everything else, including the stats Dashboard, lives behind Menu.
export default function HomeScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  // The ring used to be sized off screen width alone — fine until the
  // branch strip above it started eating vertical space. A flex:1 wrap
  // doesn't clip its content, so an oversized ring just overflowed upward
  // and sat on top of the branch cards instead of shrinking to fit.
  // Measuring the actual wrap via onLayout and capping the ring to what's
  // really left (minus room for the guide row / caption / retry button
  // below it) fixes that on any screen size or branch-strip height.
  const [wrapSize, setWrapSize] = useState({ width: 0, height: 0 });
  const maxWidthFromHeight = wrapSize.height > 0 ? (wrapSize.height - 90) / 1.25 : Infinity;
  const frameWidth = Math.max(160, Math.min(screenWidth - 32, 380, maxWidthFromHeight));
  const frameHeight = frameWidth * 1.25;
  const { userData } = useAuth();
  const companyId = userData?.company_id;
  const [permission, requestPermission] = useCameraPermissions();
  // Defaults to the back camera — the front camera on this device is the
  // one that gets stuck on a black preview after returning from Menu;
  // starting on back avoids that entirely, and it can still be flipped to
  // front manually if a kiosk stand ever needs it.
  const [facing, setFacing] = useState('back');
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [branches, setBranches] = useState([]);
  const cameraRef = useRef(null);

  useFocusEffect(
    useCallback(() => {
      if (!companyId) return;
      getBranchAttendanceSummary(companyId).then(setBranches).catch(() => {});
    }, [companyId])
  );

  // Android sometimes leaves the camera's native preview surface black when
  // returning to this screen (e.g. back from Menu) — the JS side has no way
  // to ask it to resume, but changing this key fully remounts CameraView,
  // which reliably brings the live feed back without needing a manual
  // front/back flip to force it.
  useFocusEffect(
    useCallback(() => {
      setCameraReady(false);
      setCameraKey((k) => k + 1);
    }, [])
  );

  // The remount above still occasionally leaves the native preview black
  // (onCameraReady just never fires) — previously the only fix was manually
  // flipping the camera. Self-heal instead: if it hasn't reported ready
  // within a few seconds, remount again automatically.
  useEffect(() => {
    if (!permission?.granted || cameraReady) return;
    const timer = setTimeout(() => setCameraKey((k) => k + 1), 2500);
    return () => clearTimeout(timer);
  }, [permission?.granted, cameraReady, cameraKey]);

  const { loadingRoster, scanning, result, liveHint, isConnected, pendingCount, lastSyncedAt, idle, resumeScanning } =
    useAttendanceScanner({
      companyId,
      cameraRef,
      // The remounted CameraView isn't actually streaming live frames the
      // instant it mounts — capturing before onCameraReady fires was
      // grabbing a stale/black frame right after coming back to this
      // screen, which could feed a bogus match into the scanner.
      enabled: Boolean(permission?.granted) && cameraReady,
    });

  const role = userData?.role;
  const isOwner = role === 'owner';
  const isManager = role === 'manager';
  const canAddEmployee =
    isOwner ||
    role === 'partner_edit' ||
    role === 'partner_view' ||
    (isManager && Boolean(userData?.permissions?.can_add_employees));
  // Only Owner/Admin get full (editable) Settings — everyone else only
  // ever sees their own read-only account info via Profile.
  const canEditSettings = isOwner || role === 'partner_edit';

  async function handleAddEmployee() {
    try {
      const count = await getEmployeeCount(userData.company_id);
      if (count >= FREE_EMPLOYEE_LIMIT) {
        navigation.navigate('EmployeesList');
        return;
      }
      navigation.navigate('AddEmployee');
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not check employee limit', text2: error.message });
    }
  }

  const ringStatus = !permission?.granted
    ? 'idle'
    : result
    ? result.type === 'success'
      ? 'success'
      : 'fail'
    : scanning
    ? 'scanning'
    : 'idle';

  const caption = !permission?.granted
    ? 'Camera not set up yet — tap to enable'
    : result
    ? result.message
    : loadingRoster
    ? 'Loading employee roster...'
    : !cameraReady
    ? 'Starting camera...'
    : idle
    ? 'No face detected — tap Scan when you\'re ready'
    : liveHint || 'Show your face to check in / out';

  const showRetryButton = permission?.granted && (idle || result?.type === 'error');

  return (
    <View style={styles.container}>
      <AmbientGlow />
      <OfflineBanner visible={!isConnected} pendingCount={pendingCount} lastSyncedAt={lastSyncedAt} />

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => navigation.navigate(canEditSettings ? 'Settings' : 'Profile')}
        >
          <MaterialCommunityIcons name="cog-outline" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate('Help')}>
          <MaterialCommunityIcons name="help-circle-outline" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.greetingBlock}>
        <Text style={styles.greeting}>
          {greeting()}{userData?.name ? `, ${userData.name.split(' ')[0]}` : ''}
        </Text>
        <Text style={styles.dateLabel}>{todayLabel()}</Text>
      </View>

      {branches.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.branchStrip} contentContainerStyle={styles.branchStripContent}>
          {branches.map((branch, index) => {
            const branchColor = colorForIndex(index);
            return (
              <TouchableOpacity
                key={branch.id}
                style={[styles.branchCard, { borderLeftColor: branchColor }]}
                onPress={() => navigation.navigate('MenuUnlock', { destination: 'Dashboard', destinationParams: { branchId: branch.id } })}
              >
                <Text style={styles.branchCardName} numberOfLines={1}>{branch.name}</Text>
                <Text style={[styles.branchCardCount, { color: branchColor }]}>
                  {branch.present}
                  <Text style={styles.branchCardTotal}>/{branch.total}</Text>
                </Text>
                <Text style={styles.branchCardLabel}>present</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <View
        style={styles.cameraWrap}
        onLayout={(e) => setWrapSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      >
        <View>
          <TouchableOpacity
            activeOpacity={permission?.granted ? 1 : 0.85}
            disabled={permission?.granted}
            onPress={() => requestPermission()}
          >
            <ScanRing width={frameWidth} height={frameHeight} status={ringStatus}>
              {!permission ? (
                <ActivityIndicator color={colors.white} />
              ) : permission.granted ? (
                <CameraView
                  key={cameraKey}
                  ref={cameraRef}
                  style={StyleSheet.absoluteFillObject}
                  facing={facing}
                  onCameraReady={() => setCameraReady(true)}
                />
              ) : (
                <View style={styles.missingCamera}>
                  <MaterialCommunityIcons name="camera-off-outline" size={30} color={colors.white} style={{ marginBottom: 8 }} />
                  <Text style={styles.missingCameraText}>Camera access missing</Text>
                  <Text style={styles.missingCameraHint}>Tap to enable</Text>
                </View>
              )}
            </ScanRing>
          </TouchableOpacity>
          {permission?.granted && (
            <TouchableOpacity
              style={styles.flipButton}
              onPress={() => {
                setCameraReady(false);
                setFacing((current) => (current === 'front' ? 'back' : 'front'));
              }}
              hitSlop={10}
            >
              <MaterialCommunityIcons name="camera-flip-outline" size={20} color={colors.white} />
            </TouchableOpacity>
          )}
        </View>
        {permission?.granted && cameraReady && !result && (
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
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
        <TouchableOpacity
          style={[styles.footerButton, styles.footerButtonPrimary]}
          onPress={() => navigation.navigate('MenuUnlock')}
        >
          <MaterialCommunityIcons name="view-grid-outline" size={20} color={colors.white} />
          <Text style={[styles.footerButtonText, { color: colors.white }]}>Menu</Text>
        </TouchableOpacity>
        {canAddEmployee && (
          <TouchableOpacity style={[styles.footerButton, styles.footerButtonSecondary]} onPress={handleAddEmployee}>
            <MaterialCommunityIcons name="account-plus-outline" size={20} color={colors.accent} />
            <Text style={[styles.footerButtonText, { color: colors.accent }]}>Add Employee</Text>
          </TouchableOpacity>
        )}
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
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 44,
    },
    iconButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    greetingBlock: {
      paddingHorizontal: 20,
      paddingTop: 16,
    },
    greeting: {
      fontFamily: 'Sora_700Bold',
      fontSize: 20,
      color: colors.textPrimary,
    },
    dateLabel: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 2,
    },
    branchStrip: {
      marginTop: 14,
      flexGrow: 0,
    },
    branchStripContent: {
      paddingHorizontal: 20,
      gap: 10,
    },
    branchCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radiusMd,
      borderWidth: 1,
      borderColor: colors.border,
      borderLeftWidth: 4,
      paddingVertical: 10,
      paddingHorizontal: 14,
      minWidth: 110,
    },
    branchCardName: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 12,
      color: colors.textPrimary,
    },
    branchCardCount: {
      fontFamily: 'Sora_700Bold',
      fontSize: 18,
      marginTop: 2,
    },
    branchCardTotal: {
      fontFamily: 'Inter_400Regular',
      fontWeight: '400',
      fontSize: 12,
      color: colors.textSecondary,
    },
    branchCardLabel: {
      fontFamily: 'Inter_400Regular',
      fontSize: 11,
      color: colors.textSecondary,
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
    missingCamera: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    missingCameraText: {
      color: colors.white,
      fontFamily: 'Inter_600SemiBold',
      fontSize: 14,
      textAlign: 'center',
    },
    missingCameraHint: {
      color: colors.white,
      opacity: 0.75,
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      marginTop: 6,
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
      flexDirection: 'row',
      gap: 12,
      paddingHorizontal: 20,
      paddingBottom: 32,
      paddingTop: 12,
    },
    footerButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 56,
      borderRadius: colors.radiusPill,
    },
    footerButtonPrimary: {
      backgroundColor: colors.accent,
    },
    footerButtonSecondary: {
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: colors.accent,
    },
    footerButtonText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 15,
    },
  });
}

