import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import Input from './Input';
import Button from './Button';
import { useTheme } from '../context/ThemeContext';

// Re-registering an already-registered face overwrites someone's biometric
// credential — requiring the acting admin/owner to re-confirm their OWN
// password first (not the target person's, they may not even have one
// anymore) stops a moment of unattended device access from being enough to
// silently swap out whose face unlocks an account.
export default function PasswordConfirmModal({ visible, onCancel, onConfirm, loading, error }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [password, setPassword] = useState('');

  function handleConfirm() {
    onConfirm(password);
  }

  function handleCancel() {
    setPassword('');
    onCancel();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Confirm Your Password</Text>
          <Text style={styles.subtitle}>
            Re-registering a face replaces the existing one. Enter your password to continue.
          </Text>
          <Input
            label="Your Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Enter your password"
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Button title="Confirm & Continue" onPress={handleConfirm} loading={loading} disabled={!password} />
          <TouchableOpacity onPress={handleCancel} style={styles.cancelLink}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 24,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 6,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 16,
      lineHeight: 18,
    },
    errorText: {
      color: colors.error,
      fontSize: 13,
      marginBottom: 8,
      textAlign: 'center',
    },
    cancelLink: {
      marginTop: 14,
      alignItems: 'center',
    },
    cancelText: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: '600',
    },
  });
}
