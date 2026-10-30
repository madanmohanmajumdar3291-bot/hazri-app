import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  FlatList,
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import Toast from 'react-native-toast-message';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { validationRules, confirmPasswordValidate } from '../../utils/validation';
import { createPartner } from '../../services/partnerService';
import { getEmployees } from '../../services/employeeService';

export default function CreatePartnerScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { userData } = useAuth();
  const tier = route.params?.tier === 'partner_view' ? 'partner_view' : 'partner_edit';
  const isAdmin = tier === 'partner_edit';
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [employees, setEmployees] = useState([]);
  const [linkedEmployeeId, setLinkedEmployeeId] = useState(null);

  useEffect(() => {
    if (isAdmin || !userData?.company_id) return;
    getEmployees(userData.company_id).then(setEmployees).catch(() => {});
  }, [isAdmin, userData?.company_id]);

  const { control, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: { fullName: '', email: '', phone: '', password: '', confirmPassword: '' },
  });
  const password = watch('password');

  async function onSubmit(values) {
    setFormError('');
    if (!isAdmin && !linkedEmployeeId) {
      setFormError('Select which employee this User account belongs to.');
      return;
    }
    setSubmitting(true);
    try {
      const partner = await createPartner({
        name: values.fullName,
        phone: values.phone,
        email: values.email,
        password: values.password,
        tier,
        linked_employee_id: linkedEmployeeId,
      });
      Toast.show({ type: 'success', text1: isAdmin ? 'Admin added successfully' : 'User added successfully' });
      navigation.replace('PartnerDetail', { partnerId: partner.id });
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
        <Text style={styles.title}>{isAdmin ? 'Invite Admin' : 'Invite User'}</Text>
        <Text style={styles.subtitle}>
          {isAdmin
            ? "Give another person full editing access to your company's data, same as you."
            : "Creates a login for one employee's own phone — used to mark their attendance and manage their own leave."}
        </Text>

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
              placeholder="Partner's full name"
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
              placeholder="partner@example.com"
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

        {!isAdmin && (
          <View style={{ marginBottom: 12 }}>
            <Text style={styles.label}>Employee this account belongs to</Text>
            <Text style={styles.linkHint}>
              A User account represents one specific employee's own phone — required so they can mark their own
              attendance and submit leave requests only for themselves.
            </Text>
            <FlatList
              data={employees}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ gap: 8 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.employeeChip, linkedEmployeeId === item.id && styles.employeeChipSelected]}
                  onPress={() => setLinkedEmployeeId(linkedEmployeeId === item.id ? null : item.id)}
                >
                  <Text
                    style={[
                      styles.employeeChipText,
                      linkedEmployeeId === item.id && styles.employeeChipTextSelected,
                    ]}
                  >
                    {item.name}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}

        <View style={styles.tierCard}>
          <Text style={styles.tierCardTitle}>{isAdmin ? 'Edit Access' : 'View + Attendance Marking'}</Text>
          <Text style={styles.tierCardDesc}>
            {isAdmin
              ? 'Full access — same as the owner. Can add/edit employees, manage shifts and managers, mark attendance, everything.'
              : 'Can log in and view the dashboard, employees, attendance records, and reports, and mark attendance — manually or via Kiosk Mode. Cannot add or edit anything else.'}
          </Text>
        </View>

        {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

        <Button title={isAdmin ? 'Invite Admin' : 'Invite User'} onPress={handleSubmit(onSubmit)} loading={submitting} />
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
      marginBottom: 4,
    },
    linkHint: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 10,
      lineHeight: 17,
    },
    employeeChip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: colors.card,
    },
    employeeChipSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    employeeChipText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    employeeChipTextSelected: {
      color: colors.white,
    },
    tierCard: {
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
      lineHeight: 17,
    },
    errorText: {
      color: colors.error,
      fontSize: 13,
      marginBottom: 8,
      textAlign: 'center',
    },
  });
}

