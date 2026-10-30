import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import Input from '../../components/Input';
import Button from '../../components/Button';
import CalendarPickerModal from '../../components/CalendarPickerModal';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getEmployees } from '../../services/employeeService';
import {
  markManualAttendance,
  markManualCheckout,
  getAttendanceForEmployeeDate,
} from '../../services/attendanceService';

const STATUS_OPTIONS = [
  { key: 'present', label: 'Present' },
  { key: 'absent', label: 'Absent' },
  { key: 'half_day', label: 'Half Day' },
  { key: 'leave', label: 'Leave' },
  // Not a stored status — a mode that only records a check-out time on a
  // record that already has a check-in.
  { key: 'checkout', label: 'Check-out' },
];

function nowTimeInput() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function isToday(date) {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  );
}

// date.toISOString() converts to UTC — in timezones ahead of UTC (e.g.
// India, UTC+5:30), anything marked between local midnight and 5:30 AM would
// get stamped with the PREVIOUS day's date. Build the string from local
// date parts instead so the date always matches what's shown on screen.
function toDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// ISO timestamp -> "HH:MM" in local time, for prefilling the time inputs
// from whatever's already saved on the record.
function toTimeInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export default function ManualAttendanceScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { userData, firebaseUser } = useAuth();
  const companyId = userData?.company_id;
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [date, setDate] = useState(new Date());
  const [status, setStatus] = useState('present');
  const [note, setNote] = useState('');
  const [checkInTime, setCheckInTime] = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');
  const [existingRecord, setExistingRecord] = useState(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    async function load() {
      if (!companyId) return;
      try {
        const data = await getEmployees(companyId);
        setEmployees(data);
      } catch (error) {
        Toast.show({ type: 'error', text1: 'Could not load employees', text2: error.message });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [companyId]);

  function changeDay(offset) {
    setDate((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + offset);
      return next;
    });
  }

  // Whenever the selected employee or day changes, look up whatever's
  // already on file for that day so editing shows (and corrects) the real
  // record instead of blindly overwriting it — e.g. someone who scanned a
  // check-in but forgot to scan out still keeps their actual check-in time.
  useEffect(() => {
    let cancelled = false;
    if (!selectedEmployee) {
      setExistingRecord(null);
      setStatus('present');
      setNote('');
      setCheckInTime('');
      setCheckOutTime('');
      return;
    }
    setLoadingExisting(true);
    getAttendanceForEmployeeDate(selectedEmployee.id, toDateString(date))
      .then((record) => {
        if (cancelled) return;
        setExistingRecord(record);
        // Stay in Check-out mode if that's what the admin already picked —
        // switching employee/day shouldn't silently bounce them back to Present.
        setStatus((previous) => (previous === 'checkout' ? 'checkout' : record?.status || 'present'));
        setNote(record?.note || '');
        setCheckInTime(toTimeInput(record?.check_in));
        setCheckOutTime(toTimeInput(record?.check_out));
      })
      .catch((error) => {
        if (!cancelled) Toast.show({ type: 'error', text1: 'Could not load existing record', text2: error.message });
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedEmployee, date]);

  function chooseStatus(key) {
    setStatus(key);
    // Picking Check-out on today with nothing typed yet: suggest the current
    // time, since the usual reason is someone who's leaving right now.
    if (key === 'checkout' && !checkOutTime.trim() && isToday(date)) {
      setCheckOutTime(nowTimeInput());
    }
  }

  async function handleSave() {
    if (!selectedEmployee) {
      Toast.show({ type: 'error', text1: 'Select an employee first' });
      return;
    }
    if (status === 'checkout') {
      setSaving(true);
      try {
        await markManualCheckout({
          employee: selectedEmployee,
          companyId,
          date: toDateString(date),
          checkOutTime: checkOutTime.trim() || null,
          note: note.trim() || null,
          markedByUserId: firebaseUser?.id,
          markedByName: userData?.name,
        });
        Toast.show({ type: 'success', text1: 'Check-out saved', text2: `${selectedEmployee.name} — ${checkOutTime.trim()}` });
        setSelectedEmployee(null);
        setNote('');
        setStatus('present');
        setCheckInTime('');
        setCheckOutTime('');
        setExistingRecord(null);
      } catch (error) {
        Toast.show({ type: 'error', text1: 'Could not save check-out', text2: error.message });
      } finally {
        setSaving(false);
      }
      return;
    }
    setSaving(true);
    try {
      await markManualAttendance({
        employee: selectedEmployee,
        companyId,
        date: toDateString(date),
        status,
        note: note.trim() || null,
        markedByUserId: firebaseUser?.id,
        markedByName: userData?.name,
        checkInTime: checkInTime.trim() || null,
        checkOutTime: checkOutTime.trim() || null,
      });
      Toast.show({
        type: 'success',
        text1: existingRecord ? 'Attendance updated' : 'Attendance marked',
        text2: `${selectedEmployee.name} — ${status}`,
      });
      setSelectedEmployee(null);
      setNote('');
      setStatus('present');
      setCheckInTime('');
      setCheckOutTime('');
      setExistingRecord(null);
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not save attendance', text2: error.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity onPress={() => navigation.replace('Menu')}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Manual Attendance</Text>
        <View style={styles.backSpacer} />
      </View>

      <View style={styles.dateRow}>
        <TouchableOpacity onPress={() => changeDay(-1)} style={styles.dateArrow}>
          <Text style={styles.dateArrowText}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dateTapArea} onPress={() => setCalendarOpen(true)}>
          <Text style={styles.dateText}>{formatDisplayDate(date)}</Text>
          <Text style={styles.dateChangeHint}>Tap to pick a date</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => changeDay(1)} style={styles.dateArrow}>
          <Text style={styles.dateArrowText}>›</Text>
        </TouchableOpacity>
      </View>

      <CalendarPickerModal
        visible={calendarOpen}
        value={date}
        maxDate={new Date()}
        onClose={() => setCalendarOpen(false)}
        onSelect={setDate}
      />

      <Text style={styles.sectionLabel}>Select Employee</Text>
      <FlatList
        data={employees}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.employeeList}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.employeeChip, selectedEmployee?.id === item.id && styles.employeeChipSelected]}
            onPress={() => setSelectedEmployee(item)}
          >
            <Text
              style={[
                styles.employeeChipText,
                selectedEmployee?.id === item.id && styles.employeeChipTextSelected,
              ]}
            >
              {item.name}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !loading ? <Text style={styles.emptyText}>No employees found.</Text> : null
        }
      />

      {selectedEmployee && !loadingExisting && (
        <Text style={styles.existingHint}>
          {status === 'checkout'
            ? existingRecord?.check_in
              ? `Checked in at ${toTimeInput(existingRecord.check_in)}${
                  existingRecord.check_out ? ` · already checked out at ${toTimeInput(existingRecord.check_out)} (saving replaces it)` : ''
                }.`
              : 'No check-in recorded for this day yet — mark them Present with a check-in time first.'
            : existingRecord
            ? 'Already has a record for this day — editing it below.'
            : "No record for this day yet — didn't scan? Fill this in."}
        </Text>
      )}

      <Text style={styles.sectionLabel}>Status</Text>
      <View style={styles.statusRow}>
        {STATUS_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.key}
            style={[styles.statusChip, status === option.key && styles.statusChipSelected]}
            onPress={() => chooseStatus(option.key)}
          >
            <Text style={[styles.statusChipText, status === option.key && styles.statusChipTextSelected]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {status === 'checkout' && (
        <Input
          label="Check-out time"
          value={checkOutTime}
          onChangeText={setCheckOutTime}
          placeholder="18:00"
        />
      )}

      {status !== 'absent' && status !== 'leave' && status !== 'checkout' && (
        <View style={styles.timeRow}>
          <View style={styles.timeField}>
            <Input
              label="Check-in time"
              value={checkInTime}
              onChangeText={setCheckInTime}
              placeholder="09:00"
            />
          </View>
          <View style={styles.timeField}>
            <Input
              label="Check-out time (optional)"
              value={checkOutTime}
              onChangeText={setCheckOutTime}
              placeholder="18:00"
            />
          </View>
        </View>
      )}

      <Input
        label="Note (optional)"
        value={note}
        onChangeText={setNote}
        placeholder="Add a note"
        multiline
      />

      <Button
        title={status === 'checkout' ? 'Save Check-out' : existingRecord ? 'Update Attendance' : 'Save Attendance'}
        onPress={handleSave}
        loading={saving}
      />
    </ScrollView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      padding: 20,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    backText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '600',
    },
    backSpacer: {
      width: 40,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    dateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    dateArrow: {
      paddingHorizontal: 16,
      paddingVertical: 6,
    },
    dateArrowText: {
      fontSize: 24,
      color: colors.accent,
    },
    dateTapArea: {
      alignItems: 'center',
      minWidth: 180,
    },
    dateText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textPrimary,
      textAlign: 'center',
    },
    dateChangeHint: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
    },
    sectionLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 8,
    },
    employeeList: {
      paddingBottom: 16,
      gap: 8,
    },
    employeeChip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 8,
      marginRight: 8,
      backgroundColor: colors.card,
    },
    employeeChipSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    employeeChipText: {
      fontSize: 13,
      color: colors.textPrimary,
      fontWeight: '600',
    },
    employeeChipTextSelected: {
      color: colors.white,
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: 13,
    },
    existingHint: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 12,
    },
    statusRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginBottom: 16,
    },
    timeRow: {
      flexDirection: 'row',
      gap: 12,
    },
    timeField: {
      flex: 1,
    },
    statusChip: {
      flexGrow: 1,
      flexBasis: '28%',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
      backgroundColor: colors.card,
    },
    statusChipSelected: {
      borderColor: colors.accent,
      borderWidth: 2,
    },
    statusChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    statusChipTextSelected: {
      color: colors.accent,
    },
  });
}

