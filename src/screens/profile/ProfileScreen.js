import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { getAvatarColor, getInitials } from '../../components/EmployeeCard';
import PasswordConfirmModal from '../../components/PasswordConfirmModal';
import Button from '../../components/Button';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getCompany } from '../../services/companyService';
import { reauthenticateOwner, logoutOwner } from '../../services/authService';

export default function ProfileScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { userData, firebaseUser, faceRegistered } = useAuth();
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reauthVisible, setReauthVisible] = useState(false);
  const [reauthLoading, setReauthLoading] = useState(false);
  const [reauthError, setReauthError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

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

  function handleFacePress() {
    if (!faceRegistered) {
      navigation.navigate('FaceSetup');
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
      navigation.navigate('FaceSetup');
    } catch (error) {
      setReauthError('Incorrect password. Please try again.');
    } finally {
      setReauthLoading(false);
    }
  }

  const load = useCallback(async () => {
    if (!userData?.company_id) return;
    setLoading(true);
    try {
      const data = await getCompany(userData.company_id);
      setCompany(data);
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not load profile', text2: error.message });
    } finally {
      setLoading(false);
    }
  }, [userData?.company_id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.replace('Menu')}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={[styles.avatar, { backgroundColor: getAvatarColor(userData?.name) }]}>
        <Text style={styles.avatarText}>{getInitials(userData?.name)}</Text>
      </View>
      <Text style={styles.name}>{userData?.name || 'Owner'}</Text>
      <View style={styles.roleBadge}>
        <Text style={styles.roleBadgeText}>
          {
            {
              manager: 'User',
              partner_edit: 'Partner (Edit Access)',
              partner_view: 'Partner (View Only)',
            }[userData?.role] ?? 'Owner'
          }
        </Text>
      </View>

      {company?.customer_id ? (
        <View style={styles.customerIdCard}>
          <Text style={styles.customerIdLabel}>Customer ID</Text>
          <Text style={styles.customerIdValue}>{company.customer_id}</Text>
        </View>
      ) : null}

      <View style={styles.infoCard}>
        <Text style={styles.sectionLabel}>Account</Text>
        <InfoRow label="Email" value={userData?.email} />
        <InfoRow label="Phone" value={userData?.phone} />
        <InfoRow
          label="Account Created"
          value={userData?.created_at ? new Date(userData.created_at).toLocaleDateString() : '—'}
          last
        />
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.sectionLabel}>Company</Text>
        <InfoRow label="Company Name" value={company?.company_name} />
        <InfoRow label="Address" value={company?.address} last />
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.sectionLabel}>Security</Text>
        <InfoRow
          label="Face Unlock"
          value={faceRegistered ? '✅ Registered' : '⚠️ Not registered'}
          last
        />
        <TouchableOpacity onPress={handleFacePress} style={styles.setupLink}>
          <Text style={styles.setupLinkText}>
            {faceRegistered ? 'Re-register face' : 'Set up face unlock'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={{ width: '100%', marginTop: 8 }}>
        <Button title="Log Out" onPress={handleLogout} loading={loggingOut} variant="outline" />
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

function InfoRow({ label, value, last }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.infoRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>
        {value || '—'}
      </Text>
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20, alignItems: 'center', paddingBottom: 40 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      marginBottom: 16,
    },
    backText: { color: colors.accent, fontSize: 15 },
    title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
    avatar: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    avatarText: { color: colors.white, fontSize: 28, fontWeight: '700' },
    name: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
    roleBadge: {
      backgroundColor: colors.accentSoft,
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 12,
      marginTop: 6,
      marginBottom: 16,
    },
    roleBadgeText: { fontSize: 12, fontWeight: '600', color: colors.accent },
    customerIdCard: {
      width: '100%',
      backgroundColor: colors.accentSoft,
      borderRadius: 10,
      padding: 16,
      alignItems: 'center',
      marginBottom: 16,
    },
    customerIdLabel: { fontSize: 12, color: colors.accent, fontWeight: '600', marginBottom: 4 },
    customerIdValue: { fontSize: 22, fontWeight: '700', color: colors.accent, letterSpacing: 1 },
    infoCard: {
      width: '100%',
      backgroundColor: colors.card,
      borderRadius: 10,
      padding: 16,
      marginBottom: 16,
    },
    sectionLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
      marginBottom: 8,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 12,
    },
    infoLabel: { fontSize: 13, color: colors.textSecondary },
    infoValue: { fontSize: 13, color: colors.textPrimary, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
    setupLink: { marginTop: 8 },
    setupLinkText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  });
}

