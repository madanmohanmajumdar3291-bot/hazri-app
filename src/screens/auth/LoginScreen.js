import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { useTheme } from '../../context/ThemeContext';
import { validationRules } from '../../utils/validation';
import { getAuthErrorMessage } from '../../utils/errorMessages';
import { loginOwner } from '../../services/authService';
import { useAuth } from '../../context/AuthContext';

export default function LoginScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const { setUserData } = useAuth();
  const { control, handleSubmit, formState: { errors } } = useForm({
    defaultValues: { identifier: '', password: '' },
  });

  async function onSubmit(values) {
    setFormError('');
    setLoading(true);
    try {
      const userData = await loginOwner({ ...values, identifier: values.identifier.trim() });
      setUserData(userData);
    } catch (error) {
      if (error.code === 'app/invalid-role') {
        setFormError('This account is not authorized to use the Owner app.');
      } else {
        setFormError(getAuthErrorMessage(error));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.brand}>Hazri</Text>
        <Text style={styles.title}>Welcome to Hazri</Text>
        <Text style={styles.subtitle}>Log in to manage your business</Text>

        <Controller
          control={control}
          name="identifier"
          rules={{ required: 'Phone number or email is required' }}
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Phone Number or Email"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.identifier?.message}
              autoCapitalize="none"
              placeholder="Your phone number or email"
            />
          )}
        />

        <Controller
          control={control}
          name="password"
          rules={{ required: 'Password is required' }}
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Password"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.password?.message}
              secureTextEntry
              placeholder="Enter your password"
            />
          )}
        />

        {formError ? <Text style={styles.formError}>{formError}</Text> : null}

        <Button title="Log In" onPress={handleSubmit(onSubmit)} loading={loading} />

        <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')}>
          <Text style={styles.link}>Forgot password?</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('OwnerSignup')}>
          <Text style={styles.link}>Don't have an account? Sign up</Text>
        </TouchableOpacity>
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
    brand: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.accent,
      letterSpacing: 0.5,
      marginBottom: 12,
    },
    title: {
      fontSize: 28,
      fontWeight: '800',
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
      fontWeight: '600',
    },
  });
}

