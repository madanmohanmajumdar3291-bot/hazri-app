import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import Toast from 'react-native-toast-message';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { useTheme } from '../../context/ThemeContext';
import { validationRules, confirmPasswordValidate } from '../../utils/validation';
import { createManager } from '../../services/managerService';

// A manager is just an employee with a designation — Add Employee and
// Manual Attendance are the only two features they can ever reach (see
// MenuScreen.js's MANAGER_ALLOWED_KEYS), so these are the only two toggles
// that mean anything.
const PERMISSION_OPTIONS = [
  { key: 'can_add_employees', label: 'Can Add Employees' },
  { key: 'can_manual_mark', label: 'Can Manually Mark Attendance' },
];

export default function CreateManagerScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [permissions, setPermissions] = useState({
    can_add_employees: false,
    can_manual_mark: false,
  });

  const { control, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: { fullName: '', email: '', phone: '', password: '', confirmPassword: '' },
  });
  const password = watch('password');

  function togglePermission(key) {
    setPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function onSubmit(values) {
    setFormError('');
    setSubmitting(true);
    try {
      const manager = await createManager({
        name: values.fullName,
        phone: values.phone,
        email: values.email,
        password: values.password,
        permissions,
      });
      Toast.show({ type: 'success', text1: 'User created successfully' });
      navigation.replace('ManagerDetail', { managerId: manager.id });
    } catch (error) {
      if (error.message === 'EMAIL_ALREADY_EXISTS') {
        setFormError('This email is already registered. Please use a different email.');
      } else {
        setFormError(error.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.title}>Create User</Text>
        <Text style={styles.subtitle}>Users log in through the Owner App with limited permissions.</Text>

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
              placeholder="User's full name"
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
              placeholder="manager@example.com"
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
          rules={{ required: 'Please confirm the password', validate: confirmPasswordValidate(password) }}
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Confirm Password"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.confirmPassword?.message}
              secureTextEntry
              placeholder="Re-enter the password"
            />
          )}
        />

        <Text style={styles.label}>Permissions</Text>
        <View style={styles.permissionsCard}>
          {PERMISSION_OPTIONS.map((option) => (
            <View key={option.key} style={styles.permissionRow}>
              <Text style={styles.permissionLabel}>{option.label}</Text>
              <Switch
                value={permissions[option.key]}
                onValueChange={() => togglePermission(option.key)}
                trackColor={{ true: colors.accent }}
              />
            </View>
          ))}
        </View>

        {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

        <Button title="Create User" onPress={handleSubmit(onSubmit)} loading={submitting} />
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
    },
    header: {
      marginBottom: 8,
    },
    backText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '600',
    },
    title: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 20,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 8,
    },
    permissionsCard: {
      backgroundColor: colors.card,
      borderRadius: 10,
      padding: 4,
      marginBottom: 20,
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
    errorText: {
      color: colors.error,
      fontSize: 13,
      marginBottom: 8,
      textAlign: 'center',
    },
  });
}

