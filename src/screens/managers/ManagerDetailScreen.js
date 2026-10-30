import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import Button from '../../components/Button';
import { getAvatarColor, getInitials } from '../../components/EmployeeCard';
import PasswordConfirmModal from '../../components/PasswordConfirmModal';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getManager, updateManagerPermissions, removeManager } from '../../services/managerService';
import { reauthenticateOwner } from '../../services/authService';

// A manager is just an employee with a designation — Add Employee and
// Manual Attendance are the only two features they can ever reach (see
// MenuScreen.js's MANAGER_ALLOWED_KEYS), so these are the only two toggles
// that mean anything.
const PERMISSION_OPTIONS = [
  { key: 'can_add_employees', label: 'Can Add Employees' },
  { key: 'can_manual_mark', label: 'Can Manually Mark Attendance' },
];

export default function ManagerDetailScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { managerId } = route.params;
  const { firebaseUser } = useAuth();
  const [manager, setManager] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [reauthVisible, setReauthVisible] = useState(false);
  const [reauthLoading, setReauthLoading] = useState(false);
  const [reauthError, setReauthError] = useState('');

  function handleFacePress() {
    if (!manager.face_registered) {
      navigation.navigate('ManagerFaceSetup', { managerId });
      return;
    }
    setReauthError('');
    setReauthVisible(true);
  }

  async function handleReauthConfirm(password) {
    setReauthLoading(true);
    setReauthError('');
    try {
      await reauthenticateOwner(firebaseUser.email, password);
      setReauthVisible(false);
      navigation.navigate('ManagerFaceSetup', { managerId });
    } catch (error) {
      setReauthError('Incorrect password. Please try again.');
    } finally {
      setReauthLoading(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getManager(managerId);
      setManager(data);
      setPermissions(data?.permissions ?? { can_add_employees: false, can_manual_mark: false });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not load manager', text2: error.message });
    } finally {
      setLoading(false);
    }
  }, [managerId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function togglePermission(key) {
    setPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSavePermissions() {
    setSaving(true);
    try {
      const updated = await updateManagerPermissions(managerId, permissions);
      setManager(updated);
      Toast.show({ type: 'success', text1: 'Permissions updated' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not update permissions', text2: error.message });
    } finally {
      setSaving(false);
    }
  }

  function handleRemove() {
    Alert.alert(
      'Remove manager?',
      `Are you sure you want to remove ${manager?.name}? This will delete their account completely.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            try {
              await removeManager(managerId);
              Toast.show({ type: 'success', text1: `${manager?.name} has been removed.` });
              navigation.navigate('ManagersList');
            } catch (error) {
              Toast.show({ type: 'error', text1: 'Could not remove manager', text2: error.message });
            } finally {
              setRemoving(false);
            }
          },
        },
      ]
    );
  }

  if (loading || !manager) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.avatar, { backgroundColor: getAvatarColor(manager.name) }]}>
        <Text style={styles.avatarText}>{getInitials(manager.name)}</Text>
      </View>
      <Text style={styles.name}>{manager.name}</Text>
      <View style={styles.roleBadge}>
        <Text style={styles.roleBadgeText}>User</Text>
      </View>

      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Email</Text>
          <Text style={styles.infoValue}>{manager.email}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Phone</Text>
          <Text style={styles.infoValue}>{manager.phone}</Text>
        </View>
      </View>

      <View style={styles.faceSection}>
        {manager.face_registered ? (
          <Text style={styles.faceRegistered}>
            ✅ Face registered on{' '}
            {manager.face_registered_at ? new Date(manager.face_registered_at).toLocaleDateString() : '—'}
          </Text>
        ) : (
          <Text style={styles.faceNotRegistered}>⚠️ Face not registered</Text>
        )}
        <Button
          title={manager.face_registered ? 'Re-register Face' : 'Register Face'}
          onPress={handleFacePress}
        />
      </View>

      <Text style={styles.label}>Permissions</Text>
      <View style={styles.permissionsCard}>
        {PERMISSION_OPTIONS.map((option) => (
          <View key={option.key} style={styles.permissionRow}>
            <Text style={styles.permissionLabel}>{option.label}</Text>
            <Switch
              value={Boolean(permissions[option.key])}
              onValueChange={() => togglePermission(option.key)}
              trackColor={{ true: colors.accent }}
            />
          </View>
        ))}
      </View>
      <Button title="Save Permissions" onPress={handleSavePermissions} loading={saving} />

      <View style={styles.removeButton}>
        <Button title="Remove User" variant="outline" onPress={handleRemove} loading={removing} />
      </View>

      <PasswordConfirmModal
        visible={reauthVisible}
        onCancel={() => setReauthVisible(false)}
        onConfirm={handleReauthConfirm}
        loading={reauthLoading}
        error={reauthError}
      />
    </ScrollView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 20,
      alignItems: 'center',
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    loadingText: {
      color: colors.textSecondary,
    },
    header: {
      width: '100%',
      marginBottom: 16,
    },
    backText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '600',
    },
    avatar: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    avatarText: {
      color: colors.white,
      fontSize: 28,
      fontWeight: '700',
    },
    name: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 8,
    },
    roleBadge: {
      backgroundColor: colors.accentSoft,
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 12,
      marginBottom: 20,
    },
    roleBadgeText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.accent,
    },
    infoCard: {
      width: '100%',
      backgroundColor: colors.card,
      borderRadius: 10,
      padding: 16,
      marginBottom: 20,
    },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    infoLabel: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    infoValue: {
      fontSize: 13,
      color: colors.textPrimary,
      fontWeight: '600',
    },
    faceSection: {
      width: '100%',
      alignItems: 'center',
      marginBottom: 24,
    },
    faceRegistered: {
      color: colors.success,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 12,
    },
    faceNotRegistered: {
      color: colors.warning,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 12,
    },
    label: {
      width: '100%',
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 8,
    },
    permissionsCard: {
      width: '100%',
      backgroundColor: colors.card,
      borderRadius: 10,
      padding: 4,
      marginBottom: 16,
    },
    permissionRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    permissionLabel: {
      fontSize: 14,
      color: colors.textPrimary,
      flex: 1,
      marginRight: 12,
    },
    removeButton: {
      width: '100%',
      marginTop: 24,
    },
  });
}

