import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import Button from '../../components/Button';
import { getAvatarColor, getInitials } from '../../components/EmployeeCard';
import PasswordConfirmModal from '../../components/PasswordConfirmModal';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getPartner, removePartner } from '../../services/partnerService';
import { reauthenticateOwner } from '../../services/authService';

export default function PartnerDetailScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { partnerId, adminNumber } = route.params;
  const { firebaseUser } = useAuth();
  const [partner, setPartner] = useState(null);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState(false);
  const [reauthVisible, setReauthVisible] = useState(false);
  const [reauthLoading, setReauthLoading] = useState(false);
  const [reauthError, setReauthError] = useState('');

  function handleFacePress() {
    if (!partner.face_registered) {
      navigation.navigate('PartnerFaceSetup', { partnerId });
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
      navigation.navigate('PartnerFaceSetup', { partnerId });
    } catch (error) {
      setReauthError('Incorrect password. Please try again.');
    } finally {
      setReauthLoading(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPartner(partnerId);
      setPartner(data);
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not load partner', text2: error.message });
    } finally {
      setLoading(false);
    }
  }, [partnerId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function handleRemove() {
    Alert.alert(
      'Remove access?',
      `Are you sure you want to remove ${partner?.name}? This will delete their account completely.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            try {
              await removePartner(partnerId);
              Toast.show({ type: 'success', text1: `${partner?.name} has been removed.` });
              navigation.navigate('PartnersList');
            } catch (error) {
              Toast.show({ type: 'error', text1: 'Could not remove account', text2: error.message });
            } finally {
              setRemoving(false);
            }
          },
        },
      ]
    );
  }

  if (loading || !partner) {
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

      <View style={[styles.avatar, { backgroundColor: getAvatarColor(partner.name) }]}>
        <Text style={styles.avatarText}>{getInitials(partner.name)}</Text>
      </View>
      <Text style={styles.name}>{partner.name}</Text>
      <View style={styles.roleBadge}>
        <Text style={styles.roleBadgeText}>
          {partner.role === 'partner_edit' ? `Admin${adminNumber ? ` ${adminNumber}` : ''}` : 'User'}
        </Text>
      </View>

      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Email</Text>
          <Text style={styles.infoValue}>{partner.email}</Text>
        </View>
        <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
          <Text style={styles.infoLabel}>Phone</Text>
          <Text style={styles.infoValue}>{partner.phone}</Text>
        </View>
      </View>

      <View style={styles.faceSection}>
        {partner.face_registered ? (
          <Text style={styles.faceRegistered}>
            ✅ Face registered on{' '}
            {partner.face_registered_at ? new Date(partner.face_registered_at).toLocaleDateString() : '—'}
          </Text>
        ) : (
          <Text style={styles.faceNotRegistered}>⚠️ Face not registered</Text>
        )}
        <Button
          title={partner.face_registered ? 'Re-register Face' : 'Register Face'}
          onPress={handleFacePress}
        />
      </View>

      <Text style={styles.label}>Access Level</Text>
      <View style={styles.tierCard}>
        <Text style={styles.tierCardTitle}>
          {partner.role === 'partner_edit' ? 'Edit Access' : 'View + Attendance Marking'}
        </Text>
        <Text style={styles.tierCardDesc}>
          {partner.role === 'partner_edit'
            ? 'Full access — same as the owner.'
            : 'Can view data and mark attendance, manually or via Kiosk Mode. Cannot add or edit anything else.'}
        </Text>
      </View>

      <View style={styles.removeButton}>
        <Button title="Remove Access" variant="outline" onPress={handleRemove} loading={removing} />
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
    tierCard: {
      width: '100%',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      padding: 14,
      marginBottom: 12,
      backgroundColor: colors.card,
    },
    tierCardTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 4,
    },
    tierCardDesc: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    removeButton: {
      width: '100%',
      marginTop: 24,
    },
  });
}

