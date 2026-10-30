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
import { validationRules, confirmPasswordValidate } from '../../utils/validation';
import { getAuthErrorMessage } from '../../utils/errorMessages';
import { signupOwner } from '../../services/authService';
import { useAuth } from '../../context/AuthContext';

export default function SignupScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const { setUserData, setPendingFaceSetup } = useAuth();
  const { control, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: {
      fullName: '',
      companyName: '',
      companyAddress: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
    },
  });
  const password = watch('password');

  async function onSubmit(values) {
    setFormError('');
    setLoading(true);
    setPendingFaceSetup(true);
    try {
      const userData = await signupOwner(values);
      setUserData(userData);
    } catch (error) {
      setPendingFaceSetup(false);
      setFormError(getAuthErrorMessage(error));
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
        <Text style={styles.title}>Create Your Account</Text>
        <Text style={styles.subtitle}>Set up your business on FaceMark</Text>

        <Controller
          control={control}
          name="fullName"
          rules={validationRules.fullName}
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Full Name"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.fullName?.message}
              autoCapitalize="words"
              placeholder="Your full name"
            />
          )}
        />

        <Controller
          control={control}
          name="companyName"
          rules={validationRules.companyName}
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Company Name"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.companyName?.message}
              autoCapitalize="words"
              placeholder="Your shop or business name"
            />
          )}
        />

        <Controller
          control={control}
          name="companyAddress"
          rules={validationRules.companyAddress}
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Company Address"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.companyAddress?.message}
              placeholder="Full business address"
              multiline
            />
          )}
        />

        <Controller
          control={control}
          name="email"
          rules={validationRules.email}
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Email Address"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.email?.message}
              keyboardType="email-address"
              placeholder="you@example.com"
            />
          )}
        />

        <Controller
          control={control}
          name="phone"
          rules={validationRules.phone}
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Phone Number"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.phone?.message}
              keyboardType="number-pad"
              placeholder="10-digit mobile number"
            />
          )}
        />

        <Controller
          control={control}
          name="password"
          rules={validationRules.password}
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Password"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.password?.message}
              secureTextEntry
              placeholder="Min. 8 characters, 1 number, 1 uppercase"
            />
          )}
        />

        <Controller
          control={control}
          name="confirmPassword"
          rules={{
            required: 'Please confirm your password',
            validate: confirmPasswordValidate(password),
          }}
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Confirm Password"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.confirmPassword?.message}
              secureTextEntry
              placeholder="Re-enter your password"
            />
          )}
        />

        {formError ? <Text style={styles.formError}>{formError}</Text> : null}

        <Button title="Sign Up" onPress={handleSubmit(onSubmit)} loading={loading} />

        <TouchableOpacity onPress={() => navigation.navigate('OwnerLogin')}>
          <Text style={styles.link}>Already have an account? Log in</Text>
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
      fontWeight: '600',
    },
  });
}

