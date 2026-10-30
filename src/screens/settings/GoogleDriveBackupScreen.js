import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import Button from '../../components/Button';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import {
  isDriveConnected,
  connectGoogleDrive,
  disconnectGoogleDrive,
  getLastBackupAt,
  finishPendingGoogleAuth,
} from '../../services/googleDriveService';
import { backUpCompanyToDrive } from '../../services/companyBackupService';
import { registerDailyBackup, unregisterDailyBackup } from '../../services/backupBackgroundTask';

export default function GoogleDriveBackupScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const insets = useSafeAreaInsets();
  const { userData } = useAuth();

  const [connected, setConnected] = useState(false);
  const [lastBackup, setLastBackup] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  // TEMPORARY: the toast banner truncates long error text, hiding the exact
  // detail Google's server sends back — shown here in full, persistently,
  // until the sign-in issue is confirmed fixed.
  const [debugError, setDebugError] = useState(null);

  const load = useCallback(async () => {
    // Covers the case where Android killed the app while the Google
    // sign-in browser tab was open: connectGoogleDrive()'s own promise never
    // got to finish, but the redirect was captured independently and is
    // waiting here to be completed as soon as any screen checks for it.
    try {
      const finished = await finishPendingGoogleAuth();
      if (finished) {
        if (userData?.company_id) await registerDailyBackup(userData.company_id);
        Toast.show({ type: 'success', text1: 'Google Drive connected' });
      }
    } catch (error) {
      setDebugError(error.message);
      Toast.show({ type: 'error', text1: 'Could not connect Google Drive', text2: error.message });
    }
    const [isConnected, last] = await Promise.all([isDriveConnected(), getLastBackupAt()]);
    setConnected(isConnected);
    setLastBackup(last);
  }, [userData]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleConnect() {
    setConnecting(true);
    setDebugError(null);
    try {
      const result = await connectGoogleDrive();
      if (result.cancelled) return;
      await registerDailyBackup(userData.company_id);
      setConnected(true);
      Toast.show({ type: 'success', text1: 'Google Drive connected' });
    } catch (error) {
      setDebugError(error.message);
      Toast.show({ type: 'error', text1: 'Could not connect Google Drive', text2: error.message });
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    try {
      await unregisterDailyBackup();
      await disconnectGoogleDrive();
      setConnected(false);
      setLastBackup(null);
      Toast.show({ type: 'success', text1: 'Google Drive disconnected' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not disconnect', text2: error.message });
    }
  }

  async function handleBackupNow() {
    setBackingUp(true);
    try {
      await backUpCompanyToDrive(userData.company_id);
      const last = await getLastBackupAt();
      setLastBackup(last);
      Toast.show({ type: 'success', text1: 'Backup complete' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Backup failed', text2: error.message });
    } finally {
      setBackingUp(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Google Drive Backup</Text>
        <View style={styles.backSpacer} />
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons name="google-drive" size={28} color={colors.accent} />
          </View>
          <Text style={styles.cardTitle}>
            {connected ? 'Connected to your Google Drive' : 'Back up your data to Google Drive'}
          </Text>
          <Text style={styles.cardDesc}>
            {connected
              ? 'Employees, attendance, payroll, and branch setup are backed up automatically once a day, into a "Hazri Backups" folder in your own Drive.'
              : 'Connect your own Google account to keep an independent copy of your company\'s data — employees, attendance, payroll, and branch setup — as Excel files in your Drive.'}
          </Text>

          {connected && (
            <Text style={styles.lastBackup}>
              {lastBackup
                ? `Last backed up: ${new Date(lastBackup).toLocaleString()}`
                : 'No backup yet — tap "Back up now" to create the first one.'}
            </Text>
          )}

          {connected ? (
            <>
              <Button title="Back up now" onPress={handleBackupNow} loading={backingUp} />
              <View style={{ height: 10 }} />
              <Button title="Disconnect" variant="outline" onPress={handleDisconnect} />
            </>
          ) : (
            <Button title="Connect Google Drive" onPress={handleConnect} loading={connecting} />
          )}

          {debugError ? <Text style={styles.debugError}>{debugError}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingBottom: 12,
    },
    backText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
    backSpacer: { width: 40 },
    title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
    content: { padding: 20 },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radiusLg,
      padding: 20,
      alignItems: 'center',
    },
    iconWrap: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: 8,
    },
    cardDesc: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 19,
      marginBottom: 16,
    },
    lastBackup: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 16,
    },
    debugError: {
      fontSize: 12,
      color: colors.danger ?? '#d33',
      marginTop: 14,
      textAlign: 'center',
      lineHeight: 18,
    },
  });
}

