import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getShift, createShift, updateShift, deleteShift, assignShiftToEmployee } from '../../services/shiftService';
import { getEmployees } from '../../services/employeeService';

const BASE_TABS = ['Shift Information', 'Weekly Off', 'Other Calculation'];
const WEEKS = ['I', 'II', 'III', 'IV', 'V'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WO_TYPES = ['None', 'Full Day', 'Half Day'];
const HALF_DAY_OPTIONS = ['None', 'First Half', 'Second Half'];
const PUNCH_POLICIES = ['None', 'Single Punch In', 'Single Punch Out'];

const DEFAULT_FORM = {
  shift_code: '',
  shift_name: '',
  start_time: '00:00',
  end_time: '00:00',
  shift_duration: '00:00',
  remove_duplicate_punch: '00:01',
  max_early_hour_allow: '02:00',
  max_ot_allow: '04:00',
  no_of_present_for_weekly_off: '0',
  ignore_early_allow: false,
  ignore_late_departure: false,
  first_weekly_off: 'Sunday',
  second_weekly_off: 'Sunday',
  second_weekly_off_weeks: [],
  second_wo_type: 'None',
  half_day_shift: 'None',
  single_punch_policy: 'None',
};

export default function ShiftFormScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { shiftId } = route.params || {};
  const { userData } = useAuth();
  const isEditing = Boolean(shiftId);
  const [activeTab, setActiveTab] = useState(0);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [assigningId, setAssigningId] = useState(null);

  // Employees can only be assigned to a shift that already exists — an
  // in-progress "New Shift" has no id yet to assign against, so that tab
  // only shows up once you're editing a saved shift.
  const TABS = isEditing ? [...BASE_TABS, 'Employees'] : BASE_TABS;

  useFocusEffect(
    useCallback(() => {
      if (!shiftId) return;
      setLoading(true);
      getShift(shiftId)
        .then((data) => {
          if (data) {
            setForm({
              ...DEFAULT_FORM,
              ...data,
              no_of_present_for_weekly_off: String(data.no_of_present_for_weekly_off ?? 0),
              second_weekly_off_weeks: data.second_weekly_off_weeks ?? [],
            });
          }
        })
        .catch((error) => Toast.show({ type: 'error', text1: 'Could not load shift', text2: error.message }))
        .finally(() => setLoading(false));
    }, [shiftId])
  );

  useFocusEffect(
    useCallback(() => {
      if (!shiftId || !userData?.company_id) return;
      setEmployeesLoading(true);
      getEmployees(userData.company_id)
        .then(setEmployees)
        .catch((error) => Toast.show({ type: 'error', text1: 'Could not load employees', text2: error.message }))
        .finally(() => setEmployeesLoading(false));
    }, [shiftId, userData?.company_id])
  );

  async function toggleEmployeeShift(employee) {
    const isAssigned = employee.shift_id === shiftId;
    const nextShiftId = isAssigned ? null : shiftId;
    setAssigningId(employee.id);
    try {
      await assignShiftToEmployee(employee.id, nextShiftId);
      setEmployees((prev) => prev.map((e) => (e.id === employee.id ? { ...e, shift_id: nextShiftId } : e)));
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not update employee', text2: error.message });
    } finally {
      setAssigningId(null);
    }
  }

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleWeek(week) {
    setForm((prev) => {
      const has = prev.second_weekly_off_weeks.includes(week);
      return {
        ...prev,
        second_weekly_off_weeks: has
          ? prev.second_weekly_off_weeks.filter((w) => w !== week)
          : [...prev.second_weekly_off_weeks, week],
      };
    });
  }

  async function handleSave() {
    if (!form.shift_name.trim()) {
      Toast.show({ type: 'error', text1: 'Shift Name is required' });
      return;
    }
    if (!form.shift_code.trim() || form.shift_code.length > 3) {
      Toast.show({ type: 'error', text1: 'Shift Code is required (max 3 characters)' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        no_of_present_for_weekly_off: parseInt(form.no_of_present_for_weekly_off, 10) || 0,
      };
      if (isEditing) {
        await updateShift(shiftId, payload);
        Toast.show({ type: 'success', text1: 'Shift updated' });
      } else {
        await createShift(userData.company_id, payload);
        Toast.show({ type: 'success', text1: 'Shift created' });
      }
      navigation.replace('ShiftList');
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not save shift', text2: error.message });
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    Alert.alert('Delete shift?', `Are you sure you want to delete "${form.shift_name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteShift(shiftId);
            Toast.show({ type: 'success', text1: 'Shift deleted' });
            navigation.replace('ShiftList');
          } catch (error) {
            Toast.show({ type: 'error', text1: 'Could not delete shift', text2: error.message });
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity onPress={() => navigation.replace('ShiftList')}>
          <Text style={styles.backText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{isEditing ? 'Edit Shift' : 'New Shift'}</Text>
        <View style={{ width: 50 }} />
      </View>

      <View style={styles.tabRow}>
        {TABS.map((tab, index) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === index && styles.tabActive]}
            onPress={() => setActiveTab(index)}
          >
            <Text style={[styles.tabText, activeTab === index && styles.tabTextActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.formContainer}>
        {activeTab === 0 && (
          <>
            <View style={styles.row}>
              <View style={styles.half}>
                <Input label="Shift Name *" value={form.shift_name} onChangeText={(v) => setField('shift_name', v)} placeholder="e.g. Morning Shift" />
              </View>
              <View style={styles.half}>
                <Input
                  label="Shift Code * (3 char)"
                  value={form.shift_code}
                  onChangeText={(v) => setField('shift_code', v.slice(0, 3).toUpperCase())}
                  placeholder="001"
                  autoCapitalize="characters"
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={styles.third}>
                <Input label="Start Time" value={form.start_time} onChangeText={(v) => setField('start_time', v)} placeholder="09:00" />
              </View>
              <View style={styles.third}>
                <Input label="End Time" value={form.end_time} onChangeText={(v) => setField('end_time', v)} placeholder="18:00" />
              </View>
              <View style={styles.third}>
                <Input label="Duration" value={form.shift_duration} onChangeText={(v) => setField('shift_duration', v)} placeholder="09:00" />
              </View>
            </View>

            <Text style={styles.sectionLabel}>Remove Duplicate Punch</Text>
            <Input value={form.remove_duplicate_punch} onChangeText={(v) => setField('remove_duplicate_punch', v)} placeholder="00:01" />

            <Text style={styles.sectionLabel}>Max Early Hour Allow</Text>
            <Input value={form.max_early_hour_allow} onChangeText={(v) => setField('max_early_hour_allow', v)} placeholder="02:00" />

            <Text style={styles.sectionLabel}>Max OT Allow</Text>
            <Input value={form.max_ot_allow} onChangeText={(v) => setField('max_ot_allow', v)} placeholder="04:00" />

            <Text style={styles.sectionLabel}>No. of Present for Weekly Off</Text>
            <Input
              value={form.no_of_present_for_weekly_off}
              onChangeText={(v) => setField('no_of_present_for_weekly_off', v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="0"
            />

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Ignore Early Allow</Text>
              <Switch
                value={form.ignore_early_allow}
                onValueChange={(v) => setField('ignore_early_allow', v)}
                trackColor={{ true: colors.accent }}
              />
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Ignore Late Departure</Text>
              <Switch
                value={form.ignore_late_departure}
                onValueChange={(v) => setField('ignore_late_departure', v)}
                trackColor={{ true: colors.accent }}
              />
            </View>
          </>
        )}

        {activeTab === 1 && (
          <>
            <Text style={styles.sectionLabel}>First Weekly Off</Text>
            <ChipRow options={DAYS} selected={form.first_weekly_off} onSelect={(v) => setField('first_weekly_off', v)} />

            <Text style={styles.sectionLabel}>Second Weekly Off</Text>
            <ChipRow options={DAYS} selected={form.second_weekly_off} onSelect={(v) => setField('second_weekly_off', v)} />

            <Text style={styles.sectionLabel}>Second Weekly Off — Applies on Week(s) of Month</Text>
            <View style={styles.weekRow}>
              {WEEKS.map((week) => (
                <TouchableOpacity
                  key={week}
                  style={[styles.weekChip, form.second_weekly_off_weeks.includes(week) && styles.weekChipSelected]}
                  onPress={() => toggleWeek(week)}
                >
                  <Text
                    style={[
                      styles.weekChipText,
                      form.second_weekly_off_weeks.includes(week) && styles.weekChipTextSelected,
                    ]}
                  >
                    {week}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Second WO Type</Text>
            <ChipRow options={WO_TYPES} selected={form.second_wo_type} onSelect={(v) => setField('second_wo_type', v)} />

            <Text style={styles.sectionLabel}>Half Day Shift</Text>
            <ChipRow options={HALF_DAY_OPTIONS} selected={form.half_day_shift} onSelect={(v) => setField('half_day_shift', v)} />
          </>
        )}

        {activeTab === 2 && (
          <>
            <Text style={styles.sectionLabel}>Single Punch Policy</Text>
            <ChipRow
              options={PUNCH_POLICIES}
              selected={form.single_punch_policy}
              onSelect={(v) => setField('single_punch_policy', v)}
            />
          </>
        )}

        {activeTab === 3 && isEditing && (
          <>
            <Text style={styles.sectionLabel}>
              Tap an employee to assign them to this shift, or tap again to remove them.
            </Text>
            {employeesLoading ? (
              <Text style={styles.loadingText}>Loading employees...</Text>
            ) : employees.length === 0 ? (
              <Text style={styles.loadingText}>No employees yet.</Text>
            ) : (
              employees.map((employee) => {
                const isAssigned = employee.shift_id === shiftId;
                return (
                  <TouchableOpacity
                    key={employee.id}
                    style={styles.employeeRow}
                    onPress={() => toggleEmployeeShift(employee)}
                    disabled={assigningId === employee.id}
                  >
                    <Text style={styles.employeeName}>{employee.name}</Text>
                    <View style={[styles.assignChip, isAssigned && styles.assignChipSelected]}>
                      <Text style={[styles.assignChipText, isAssigned && styles.assignChipTextSelected]}>
                        {assigningId === employee.id ? '...' : isAssigned ? '✓ Assigned' : 'Assign'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {isEditing && (
          <Button title="Delete" variant="outline" onPress={handleDelete} loading={deleting} />
        )}
        <View style={{ height: 8 }} />
        <Button title="Save" onPress={handleSave} loading={saving} />
      </View>
    </View>
  );
}

function ChipRow({ options, selected, onSelect }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.chipRow}>
      {options.map((option) => (
        <TouchableOpacity
          key={option}
          style={[styles.chip, selected === option && styles.chipSelected]}
          onPress={() => onSelect(option)}
        >
          <Text style={[styles.chipText, selected === option && styles.chipTextSelected]}>{option}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    loadingText: { color: colors.textSecondary },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 8,
    },
    backText: { color: colors.accent, fontSize: 15 },
    title: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
    tabRow: {
      flexDirection: 'row',
      paddingHorizontal: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tab: {
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tabActive: { borderBottomColor: colors.accent },
    tabText: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
    tabTextActive: { color: colors.accent },
    formContainer: { padding: 20, paddingBottom: 40 },
    row: { flexDirection: 'row', gap: 10 },
    half: { flex: 1 },
    third: { flex: 1 },
    sectionLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 6,
      marginTop: 4,
    },
    switchRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    switchLabel: { fontSize: 14, color: colors.textPrimary },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    chip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: colors.card,
    },
    chipSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
    chipText: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
    chipTextSelected: { color: colors.white },
    weekRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    weekChip: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
    },
    weekChipSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
    weekChipText: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
    weekChipTextSelected: { color: colors.white },
    footer: {
      padding: 20,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    employeeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.card,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: 8,
    },
    employeeName: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
      flex: 1,
    },
    assignChip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    assignChipSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    assignChipText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    assignChipTextSelected: {
      color: colors.white,
    },
  });
}

