import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getAvatarColor, getInitials } from '../../components/EmployeeCard';
import PasswordConfirmModal from '../../components/PasswordConfirmModal';
import Button from '../../components/Button';
import { getCompany } from '../../services/companyService';
import { reauthenticateOwner, logoutOwner } from '../../services/authService';

const THEME_OPTIONS = [
  { key: 'light', label: 'Light', icon: 'white-balance-sunny' },
  { key: 'dark', label: 'Dark', icon: 'moon-waning-crescent' },
  { key: 'system', label: 'System', icon: 'theme-light-dark' },
];

const ITEM_ICONS = {
  employees: 'account-group-outline',
  'company-profile': 'domain',
  notifications: 'bell-outline',
  export: 'file-export-outline',
  security: 'shield-lock-outline',
  partners: 'account-multiple-plus-outline',
  'google-drive': 'google-drive',
};

const ROLE_LABELS = {
  owner: 'Owner',
  manager: 'User',
  partner_edit: 'Admin',
  partner_view: 'User',
};

export default function SettingsScreen({ navigation }) {
  const { colors, preference, setThemePreference } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { userData, firebaseUser, faceRegistered } = useAuth();
  const isOwner = userData?.role === 'owner';

  const [company, setCompany] = useState(null);
  const [reauthVisible, setReauthVisible] = useState(false);
  const [reauthLoading, setReauthLoading] = useState(false);
  const [reauthError, setReauthError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  const load = useCallback(async () => {
    if (!userData?.company_id) return;
    try {
      const data = await getCompany(userData.company_id);
      setCompany(data);
    } catch (_error) {
      // Non-critical for this screen — the rest of Settings still works.
    }
  }, [userData?.company_id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const items = [
    { key: 'employees', label: 'Employee Details', desc: 'Edit employee info, role, shift, and salary' },
    { key: 'company-profile', label: 'Company Profile', desc: 'Name, address, and logo' },
    { key: 'notifications', label: 'Notification Preferences', desc: 'Late arrivals, absences, employee limit' },
    { key: 'export', label: 'Data Export', desc: 'Download attendance history as PDF/Excel' },
    { key: 'google-drive', label: 'Google Drive Backup', desc: 'Automatic daily backup to your own Drive' },
    { key: 'security', label: 'Account Security', desc: 'Change password, manage active sessions' },
    ...(isOwner
      ? [{ key: 'partners', label: 'Admin & User Access', desc: 'Give another account access to your data' }]
      : []),
  ];

  function handlePress(key) {
    if (key === 'employees') navigation.navigate('EmployeesList');
    else if (key === 'company-profile') navigation.navigate('CompanyProfile');
    else if (key === 'notifications') navigation.navigate('NotificationPreferences');
    else if (key === 'export') navigation.navigate('Reports');
    else if (key === 'google-drive') navigation.navigate('GoogleDriveBackup');
    else if (key === 'security') navigation.navigate('AccountSecurity');
    else if (key === 'partners') navigation.navigate('PartnersList');
  }

  function handleFacePress() {
    if (!faceRegistered) {
      navigation.navigate('FaceSetup');
      return;
    }
    // Already registered — overwriting it needs the acting person's own
    // password confirmed first, not just a tap.
    setReauthError('');
    setReauthVisible(true);
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logoutOwner();
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not log out', text2: error.message });
    } finally {
      setLoggingOut(false);
    }
  }

  async function handleReauthConfirm(password) {
    setReauthLoading(true);
    setReauthError('');
    try {
      await reauthenticateOwner(firebaseUser.email, password);
      setReauthVisible(false);
      navigation.navigate('FaceSetup');
    } catch (error) {
      setReauthError('Incorrect password. Please try again.');
    } finally {
      setReauthLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.backSpacer} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <View style={styles.accountCard}>
              <View style={styles.accountHeader}>
                <View style={[styles.avatar, { backgroundColor: getAvatarColor(userData?.name) }]}>
                  <Text style={styles.avatarText}>{getInitials(userData?.name)}</Text>
                </View>
                <View style={styles.accountInfo}>
                  <Text style={styles.accountName}>{userData?.name ?? '—'}</Text>
                  <Text style={styles.accountRole}>{ROLE_LABELS[userData?.role] ?? userData?.role}</Text>
                </View>
              </View>

              {company?.customer_id ? (
                <View style={styles.profileRow}>
                  <Text style={styles.profileLabel}>Customer ID</Text>
                  <Text style={styles.profileValue}>{company.customer_id}</Text>
                </View>
              ) : null}
              <View style={styles.profileRow}>
                <Text style={styles.profileLabel}>Email</Text>
                <Text style={styles.profileValue}>{userData?.email || '—'}</Text>
              </View>
              <View style={styles.profileRow}>
                <Text style={styles.profileLabel}>Phone</Text>
                <Text style={styles.profileValue}>{userData?.phone || '—'}</Text>
              </View>
              <View style={styles.profileRow}>
                <Text style={styles.profileLabel}>Account Created</Text>
                <Text style={styles.profileValue}>
                  {userData?.created_at ? new Date(userData.created_at).toLocaleDateString() : '—'}
                </Text>
              </View>
              <View style={styles.profileRow}>
                <Text style={styles.profileLabel}>Company</Text>
                <Text style={styles.profileValue}>{company?.company_name || '—'}</Text>
              </View>
              <View style={[styles.profileRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.profileLabel}>Face Unlock</Text>
                <Text style={styles.profileValue}>{faceRegistered ? '✅ Registered' : '⚠️ Not registered'}</Text>
              </View>
              <TouchableOpacity onPress={handleFacePress} style={styles.faceLink}>
                <Text style={styles.faceLinkText}>
                  {faceRegistered ? 'Re-register face' : 'Set up face unlock'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.appearanceCard}>
              <Text style={styles.appearanceLabel}>Appearance</Text>
              <View style={styles.appearanceRow}>
                {THEME_OPTIONS.map((option) => (
                  <TouchableOpacity
                    key={option.key}
                    style={[styles.appearanceChip, preference === option.key && styles.appearanceChipSelected]}
                    onPress={() => setThemePreference(option.key)}
                  >
                    <MaterialCommunityIcons
                      name={option.icon}
                      size={16}
                      color={preference === option.key ? colors.accent : colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.appearanceChipText,
                        preference === option.key && styles.appearanceChipTextSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.item} onPress={() => handlePress(item.key)} activeOpacity={0.8}>
            <View style={styles.itemIconWrap}>
              <MaterialCommunityIcons name={ITEM_ICONS[item.key]} size={20} color={colors.accent} />
            </View>
            <View style={styles.itemTextWrap}>
              <Text style={styles.itemLabel}>{item.label}</Text>
              <Text style={styles.itemDesc}>{item.desc}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
        ListFooterComponent={
          <View style={styles.logoutWrap}>
            <Button title="Log Out" onPress={handleLogout} loading={loggingOut} variant="outline" />
          </View>
        }
      />

      <PasswordConfirmModal
        visible={reauthVisible}
        onCancel={() => setReauthVisible(false)}
        onConfirm={handleReauthConfirm}
        loading={reauthLoading}
        error={reauthError}
      />
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
      paddingTop: 20,
      paddingBottom: 12,
    },
    backText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '600',
    },
    backSpacer: {
      width: 40,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    list: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 24,
    },
    accountCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radiusLg,
      padding: 18,
      marginBottom: 16,
    },
    accountHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
    },
    avatar: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
    },
    avatarText: {
      color: colors.white,
      fontSize: 18,
      fontWeight: '700',
    },
    accountInfo: {
      flex: 1,
    },
    accountName: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    accountRole: {
      fontSize: 12,
      color: colors.accent,
      fontWeight: '600',
      marginTop: 2,
    },
    profileRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 12,
    },
    profileLabel: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    profileValue: {
      fontSize: 13,
      color: colors.textPrimary,
      fontWeight: '600',
      flexShrink: 1,
      textAlign: 'right',
    },
    faceLink: {
      marginTop: 10,
    },
    faceLinkText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '600',
    },
    appearanceCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radiusLg,
      padding: 18,
      marginBottom: 16,
    },
    appearanceLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 10,
    },
    appearanceRow: {
      flexDirection: 'row',
      gap: 8,
    },
    appearanceChip: {
      flex: 1,
      flexDirection: 'row',
      gap: 6,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    appearanceChipSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    appearanceChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    appearanceChipTextSelected: {
      color: colors.accent,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: colors.radiusMd,
      padding: 14,
      marginBottom: 10,
      gap: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: colors.isDark ? 0.25 : 0.04,
      shadowRadius: 6,
      elevation: 1,
    },
    itemIconWrap: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    itemTextWrap: {
      flex: 1,
    },
    itemLabel: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    itemDesc: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    logoutWrap: {
      marginTop: 8,
    },
  });
}

