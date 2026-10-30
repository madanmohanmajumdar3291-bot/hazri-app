import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { getAvatarColor, getInitials } from '../../components/EmployeeCard';
import PasswordConfirmModal from '../../components/PasswordConfirmModal';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getEmployee, updateEmployee, removeEmployee } from '../../services/employeeService';
import { getShifts, assignShiftToEmployee } from '../../services/shiftService';
import { getCompanySites } from '../../services/locationService';
import { getCompanyDepartments } from '../../services/departmentService';
import { reauthenticateOwner } from '../../services/authService';

export default function EmployeeDetailScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { employeeId } = route.params;
  const { userData, firebaseUser } = useAuth();
  const canEdit = userData?.role !== 'partner_view';
  // Salary is more sensitive than the rest of an employee's info — only
  // Owner/Admin (who can also access Payroll) see or edit it here.
  const canSeeSalary = userData?.role === 'owner' || userData?.role === 'partner_edit';
  const [employee, setEmployee] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [sites, setSites] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [reauthVisible, setReauthVisible] = useState(false);
  const [reauthLoading, setReauthLoading] = useState(false);
  const [reauthError, setReauthError] = useState('');
  const [form, setForm] = useState({
    name: '',
    phone: '',
    role: 'employee',
    work_mode: 'office',
    shift_id: null,
    site_id: null,
    department_id: null,
    monthlySalary: '',
    overtimeRate: '',
  });

  function handleFacePress() {
    if (!employee.face_registered) {
      navigation.navigate('EmployeeFaceSetup', { employeeId });
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
      navigation.navigate('EmployeeFaceSetup', { employeeId });
    } catch (error) {
      setReauthError('Incorrect password. Please try again.');
    } finally {
      setReauthLoading(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, shiftList, siteList, departmentList] = await Promise.all([
        getEmployee(employeeId),
        userData?.company_id ? getShifts(userData.company_id) : Promise.resolve([]),
        userData?.company_id ? getCompanySites(userData.company_id) : Promise.resolve([]),
        userData?.company_id ? getCompanyDepartments(userData.company_id) : Promise.resolve([]),
      ]);
      setEmployee(data);
      setShifts(shiftList);
      setSites(siteList);
      setDepartments(departmentList);
      setForm({
        name: data?.name ?? '',
        phone: data?.phone ?? '',
        role: data?.role ?? 'employee',
        work_mode: data?.work_mode ?? 'office',
        shift_id: data?.shift_id ?? null,
        site_id: data?.site_id ?? null,
        department_id: data?.department_id ?? null,
        monthlySalary: data?.monthly_salary != null ? String(data.monthly_salary) : '',
        overtimeRate: data?.overtime_rate != null ? String(data.overtime_rate) : '',
      });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not load employee', text2: error.message });
    } finally {
      setLoading(false);
    }
  }, [employeeId, userData?.company_id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateEmployee(employeeId, {
        name: form.name,
        phone: form.phone,
        role: form.role,
        work_mode: form.work_mode,
        site_id: form.site_id,
        department_id: form.department_id,
        monthly_salary: form.monthlySalary ? Number(form.monthlySalary) : null,
        overtime_rate: form.overtimeRate ? Number(form.overtimeRate) : null,
      });
      await assignShiftToEmployee(employeeId, form.shift_id);
      setEmployee({ ...updated, shift_id: form.shift_id, site_id: form.site_id, department_id: form.department_id });
      setEditing(false);
      Toast.show({ type: 'success', text1: 'Employee updated' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not update employee', text2: error.message });
    } finally {
      setSaving(false);
    }
  }

  function handleRemove() {
    Alert.alert(
      'Permanently delete employee?',
      `This will permanently delete ${employee?.name} and ALL of their data — attendance history, payroll records, and leave requests. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            try {
              await removeEmployee(employeeId, userData.company_id);
              Toast.show({ type: 'success', text1: `${employee?.name} has been permanently deleted.` });
              navigation.navigate('EmployeesList');
            } catch (error) {
              Toast.show({ type: 'error', text1: 'Could not remove employee', text2: error.message });
            } finally {
              setRemoving(false);
            }
          },
        },
      ]
    );
  }

  if (loading || !employee) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const avatarColor = getAvatarColor(employee.name);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: Math.max(insets.top, 12) + 12, paddingBottom: Math.max(insets.bottom, 16) + 24 },
      ]}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        {!editing && canEdit && (
          <TouchableOpacity onPress={() => setEditing(true)}>
            <Text style={styles.editText}>Edit</Text>
          </TouchableOpacity>
        )}
      </View>

      {employee.photo_url ? (
        <Image source={{ uri: employee.photo_url }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
          <Text style={styles.avatarText}>{getInitials(employee.name)}</Text>
        </View>
      )}

      {editing ? (
        <View style={styles.editForm}>
          <Input label="Full Name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
          <Input
            label="Phone Number"
            value={form.phone}
            onChangeText={(v) => setForm({ ...form, phone: v })}
            keyboardType="number-pad"
          />
          <Text style={styles.label}>Role</Text>
          <View style={styles.roleRow}>
            <TouchableOpacity
              style={[styles.roleCard, form.role === 'employee' && styles.roleCardSelected]}
              onPress={() => setForm({ ...form, role: 'employee' })}
            >
              <Text style={[styles.roleCardText, form.role === 'employee' && styles.roleCardTextSelected]}>
                Employee
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.roleCard, form.role === 'manager' && styles.roleCardSelected]}
              onPress={() => setForm({ ...form, role: 'manager' })}
            >
              <Text style={[styles.roleCardText, form.role === 'manager' && styles.roleCardTextSelected]}>
                User
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Work Mode</Text>
          <View style={styles.roleRow}>
            <TouchableOpacity
              style={[styles.roleCard, form.work_mode === 'office' && styles.roleCardSelected]}
              onPress={() => setForm({ ...form, work_mode: 'office' })}
            >
              <Text style={[styles.roleCardText, form.work_mode === 'office' && styles.roleCardTextSelected]}>
                Office
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.roleCard, form.work_mode === 'remote' && styles.roleCardSelected]}
              onPress={() => setForm({ ...form, work_mode: 'remote' })}
            >
              <Text style={[styles.roleCardText, form.work_mode === 'remote' && styles.roleCardTextSelected]}>
                Remote / Field
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Shift</Text>
          <View style={styles.shiftRow}>
            <TouchableOpacity
              style={[styles.shiftChip, !form.shift_id && styles.shiftChipSelected]}
              onPress={() => setForm({ ...form, shift_id: null })}
            >
              <Text style={[styles.shiftChipText, !form.shift_id && styles.shiftChipTextSelected]}>
                No Shift
              </Text>
            </TouchableOpacity>
            {shifts.map((shift) => (
              <TouchableOpacity
                key={shift.id}
                style={[styles.shiftChip, form.shift_id === shift.id && styles.shiftChipSelected]}
                onPress={() => setForm({ ...form, shift_id: shift.id })}
              >
                <Text
                  style={[styles.shiftChipText, form.shift_id === shift.id && styles.shiftChipTextSelected]}
                >
                  {shift.shift_name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Branch</Text>
          <View style={styles.shiftRow}>
            <TouchableOpacity
              style={[styles.shiftChip, !form.site_id && styles.shiftChipSelected]}
              onPress={() => setForm({ ...form, site_id: null })}
            >
              <Text style={[styles.shiftChipText, !form.site_id && styles.shiftChipTextSelected]}>
                No Branch
              </Text>
            </TouchableOpacity>
            {sites.map((site) => (
              <TouchableOpacity
                key={site.id}
                style={[styles.shiftChip, form.site_id === site.id && styles.shiftChipSelected]}
                onPress={() => setForm({ ...form, site_id: site.id })}
              >
                <Text style={[styles.shiftChipText, form.site_id === site.id && styles.shiftChipTextSelected]}>
                  {site.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Department</Text>
          <View style={styles.shiftRow}>
            <TouchableOpacity
              style={[styles.shiftChip, !form.department_id && styles.shiftChipSelected]}
              onPress={() => setForm({ ...form, department_id: null })}
            >
              <Text style={[styles.shiftChipText, !form.department_id && styles.shiftChipTextSelected]}>
                No Department
              </Text>
            </TouchableOpacity>
            {departments.map((department) => (
              <TouchableOpacity
                key={department.id}
                style={[styles.shiftChip, form.department_id === department.id && styles.shiftChipSelected]}
                onPress={() => setForm({ ...form, department_id: department.id })}
              >
                <Text
                  style={[styles.shiftChipText, form.department_id === department.id && styles.shiftChipTextSelected]}
                >
                  {department.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {canSeeSalary && (
            <>
              <Input
                label="Monthly Salary"
                value={form.monthlySalary}
                onChangeText={(v) => setForm({ ...form, monthlySalary: v.replace(/[^0-9.]/g, '') })}
                keyboardType="decimal-pad"
                placeholder="e.g. 15000"
              />
              <Input
                label="Overtime Rate per Hour"
                value={form.overtimeRate}
                onChangeText={(v) => setForm({ ...form, overtimeRate: v.replace(/[^0-9.]/g, '') })}
                keyboardType="decimal-pad"
                placeholder="e.g. 100"
              />
            </>
          )}

          <Button title="Save" onPress={handleSave} loading={saving} />
          <View style={{ height: 8 }} />
          <Button
            title="Cancel"
            variant="outline"
            onPress={() => {
              setEditing(false);
              setForm({
                name: employee.name,
                phone: employee.phone,
                role: employee.role,
                work_mode: employee.work_mode ?? 'office',
                shift_id: employee.shift_id ?? null,
                site_id: employee.site_id ?? null,
                department_id: employee.department_id ?? null,
                monthlySalary: employee.monthly_salary != null ? String(employee.monthly_salary) : '',
                overtimeRate: employee.overtime_rate != null ? String(employee.overtime_rate) : '',
              });
            }}
          />
        </View>
      ) : (
        <>
          <Text style={styles.name}>{employee.name}</Text>
          <View style={[styles.roleBadge, employee.role === 'manager' && styles.roleBadgeManager]}>
            <Text style={[styles.roleBadgeText, employee.role === 'manager' && styles.roleBadgeTextManager]}>
              {employee.role === 'manager' ? 'User' : 'Employee'}
            </Text>
          </View>

          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Employee ID</Text>
              <Text style={styles.infoValue}>{employee.employee_code ?? '—'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>{employee.email || '—'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Phone</Text>
              <Text style={styles.infoValue}>{employee.phone}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Work Mode</Text>
              <Text style={styles.infoValue}>{employee.work_mode === 'remote' ? 'Remote / Field' : 'Office'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Date Added</Text>
              <Text style={styles.infoValue}>
                {new Date(employee.created_at).toLocaleDateString()}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Shift</Text>
              <Text style={styles.infoValue}>
                {shifts.find((s) => s.id === employee.shift_id)?.shift_name ?? 'Not assigned'}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Branch</Text>
              <Text style={styles.infoValue}>
                {sites.find((s) => s.id === employee.site_id)?.name ?? 'Not assigned'}
              </Text>
            </View>
            <View style={canSeeSalary ? styles.infoRow : [styles.infoRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.infoLabel}>Department</Text>
              <Text style={styles.infoValue}>
                {departments.find((d) => d.id === employee.department_id)?.name ?? 'Not assigned'}
              </Text>
            </View>
            {canSeeSalary && (
              <>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Monthly Salary</Text>
                  <Text style={styles.infoValue}>
                    {employee.monthly_salary != null ? `₹${employee.monthly_salary}` : '—'}
                  </Text>
                </View>
                <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.infoLabel}>Overtime Rate</Text>
                  <Text style={styles.infoValue}>
                    {employee.overtime_rate != null ? `₹${employee.overtime_rate}/hr` : '—'}
                  </Text>
                </View>
              </>
            )}
          </View>

          <View style={styles.faceSection}>
            {employee.face_registered ? (
              <Text style={styles.faceRegistered}>
                ✅ Face registered on{' '}
                {employee.face_registered_at
                  ? new Date(employee.face_registered_at).toLocaleDateString()
                  : '—'}
              </Text>
            ) : (
              <Text style={styles.faceNotRegistered}>⚠️ Face not registered</Text>
            )}
            {canEdit && (
              <Button
                title={employee.face_registered ? 'Re-register Face' : 'Register Face'}
                onPress={handleFacePress}
              />
            )}
          </View>

          {canEdit && (
            <View style={styles.removeButton}>
              <Button title="Delete Employee Permanently" variant="outline" onPress={handleRemove} loading={removing} />
            </View>
          )}
        </>
      )}

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
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
      marginBottom: 16,
    },
    backText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '600',
    },
    editText: {
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
      backgroundColor: colors.isDark ? '#2A2D3E' : '#E9ECEF',
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 12,
      marginBottom: 20,
    },
    roleBadgeManager: {
      backgroundColor: colors.accentSoft,
    },
    roleBadgeText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    roleBadgeTextManager: {
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
    removeButton: {
      width: '100%',
    },
    editForm: {
      width: '100%',
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 6,
    },
    roleRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 20,
    },
    roleCard: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: 'center',
      backgroundColor: colors.card,
    },
    roleCardSelected: {
      borderColor: colors.accent,
      borderWidth: 2,
    },
    roleCardText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    roleCardTextSelected: {
      color: colors.accent,
    },
    shiftRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 20,
    },
    shiftChip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: colors.card,
    },
    shiftChipSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    shiftChipText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    shiftChipTextSelected: {
      color: colors.white,
    },
  });
}

