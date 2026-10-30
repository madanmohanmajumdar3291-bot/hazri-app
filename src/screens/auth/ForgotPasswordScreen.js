import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity } from 'react-native';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { useTheme } from '../../context/ThemeContext';
import { requestPasswordReset } from '../../services/authService';

export default function ForgotPasswordScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    if (!identifier.trim()) {
      setError('Enter your phone number or email');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await requestPasswordReset(identifier);
      setSent(true);
    } catch (e) {
      setError(e.message || 'Could not send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Forgot Password</Text>

        {sent ? (
          <>
            <Text style={styles.subtitle}>
              If an account exists for that phone number or email, a password reset link has been
              sent to its registered email address. Check your inbox and follow the link to set a
              new password.
            </Text>
            <Button title="Back to Log In" onPress={() => navigation.goBack()} />
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>Enter your phone number or email and we'll send you a reset link.</Text>
            <Input
              label="Phone Number or Email"
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              placeholder="Your phone number or email"
            />
            {error ? <Text style={styles.formError}>{error}</Text> : null}
            <Button title="Send Reset Link" onPress={handleSubmit} loading={loading} />
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Text style={styles.link}>Back to Log In</Text>
            </TouchableOpacity>
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
    link: {
      color: colors.accent,
      fontSize: 14,
      textAlign: 'center',
      marginTop: 20,
    },
  });
}

