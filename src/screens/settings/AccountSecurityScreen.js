import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import Toast from 'react-native-toast-message';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { changePassword, logoutOtherSessions } from '../../services/authService';
import { validationRules, confirmPasswordValidate } from '../../utils/validation';

export default function AccountSecurityScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { firebaseUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loggingOutOthers, setLoggingOutOthers] = useState(false);

  async function handleChangePassword() {
    setError('');
    if (!currentPassword) {
      setError('Enter your current password');
      return;
    }
    const passwordRule = validationRules.password;
    if (!passwordRule.pattern.value.test(newPassword)) {
      setError(passwordRule.pattern.message);
      return;
    }
    const confirmError = confirmPasswordValidate(newPassword)(confirmPassword);
    if (confirmError !== true) {
      setError(confirmError);
      return;
    }

    setSaving(true);
    try {
      await changePassword(firebaseUser.email, currentPassword, newPassword);
      Toast.show({ type: 'success', text1: 'Password updated' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e) {
      setError(e.message || 'Could not update password. Check your current password and try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleLogoutOthers() {
    Alert.alert(
      'Log out of all other devices?',
      'Anyone else currently signed into this account elsewhere will be signed out. This device stays signed in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out Others',
          style: 'destructive',
          onPress: async () => {
            setLoggingOutOthers(true);
            try {
              await logoutOtherSessions();
              Toast.show({ type: 'success', text1: 'Other sessions signed out' });
            } catch (e) {
              Toast.show({ type: 'error', text1: 'Could not sign out other sessions', text2: e.message });
            } finally {
              setLoggingOutOthers(false);
            }
          },
        },
      ]
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Account Security</Text>
        <View style={{ width: 40 }} />
      </View>

      <Text style={styles.label}>Change Password</Text>
      <Input
        label="Current Password"
        value={currentPassword}
        onChangeText={setCurrentPassword}
        secureTextEntry
        placeholder="Enter your current password"
      />
      <Input
        label="New Password"
        value={newPassword}
        onChangeText={setNewPassword}
        secureTextEntry
        placeholder="Min. 8 characters, 1 number, 1 uppercase"
      />
      <Input
        label="Confirm New Password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        placeholder="Re-enter the new password"
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <Button title="Update Password" onPress={handleChangePassword} loading={saving} />

      <View style={styles.divider} />

      <Text style={styles.label}>Active Sessions</Text>
      <Text style={styles.sectionDesc}>
        If you've logged in on another device or browser and want to make sure it's signed out.
      </Text>
      <Button
        title="Log Out of All Other Devices"
        variant="outline"
        onPress={handleLogoutOthers}
        loading={loggingOutOthers}
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
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 20,
    },
    backText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '600',
    },
    title: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 8,
    },
    sectionDesc: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 12,
    },
    errorText: {
      color: colors.error,
      fontSize: 13,
      marginBottom: 8,
      textAlign: 'center',
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 24,
    },
  });
}

