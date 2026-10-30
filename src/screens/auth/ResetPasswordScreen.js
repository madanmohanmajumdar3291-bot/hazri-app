import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { useTheme } from '../../context/ThemeContext';
import { supabase } from '../../services/supabase';
import { useAuth } from '../../context/AuthContext';

export default function ResetPasswordScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { setPasswordRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setDone(true);
      setTimeout(async () => {
        await supabase.auth.signOut();
        setPasswordRecovery(false);
      }, 1500);
    } catch (e) {
      setError(e.message || 'Could not update password. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Set New Password</Text>

        {done ? (
          <Text style={styles.subtitle}>Password updated! Redirecting to log in...</Text>
        ) : (
          <>
            <Text style={styles.subtitle}>Choose a new password for your account.</Text>
            <Input
              label="New Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Enter new password"
            />
            <Input
              label="Confirm Password"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              placeholder="Confirm new password"
            />
            {error ? <Text style={styles.formError}>{error}</Text> : null}
            <Button title="Update Password" onPress={handleSubmit} loading={loading} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.background },
    container: {
      flexGrow: 1,
      padding: 24,
      justifyContent: 'center',
    },
    title: {
      fontSize: 26,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      marginBottom: 24,
    },
    formError: {
      color: colors.error,
      fontSize: 14,
      marginBottom: 8,
      textAlign: 'center',
    },
  });
}

