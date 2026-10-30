import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ScrollView } from 'react-native';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getEmployees } from '../../services/employeeService';
import { createLeaveRequest } from '../../services/leaveService';
import Input from '../../components/Input';
import Button from '../../components/Button';

// Paid vs. unpaid is an admin-only decision made when a request is
// approved — the employee only ever picks the leave category here.
const LEAVE_TYPES = ['general', 'sick', 'casual'];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function RequestLeaveScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { userData } = useAuth();
  const companyId = userData?.company_id;

  // Real employees have no login of their own — whoever is holding the
  // store's account (User/Admin/Owner/Manager) submits leave on behalf of
  // whichever employee asked, the same way Manual Attendance works: pick
  // the employee from the team, every time.
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState(null);
  const [leaveType, setLeaveType] = useState('general');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    getEmployees(companyId).then(setEmployees).catch(() => {});
  }, [companyId]);

  async function handleSubmit() {
    if (!employeeId) {
      Toast.show({ type: 'error', text1: 'Select an employee' });
      return;
    }
    setSaving(true);
    try {
      await createLeaveRequest({ companyId, employeeId, leaveType, startDate, endDate, reason });
      Toast.show({ type: 'success', text1: 'Leave request submitted' });
      navigation.goBack();
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not submit', text2: error.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Request Leave</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>Employee</Text>
        <FlatList
          data={employees}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: 8, marginBottom: 16 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.chip, employeeId === item.id && styles.chipSelected]}
              onPress={() => setEmployeeId(item.id)}
            >
              <Text style={[styles.chipText, employeeId === item.id && styles.chipTextSelected]}>{item.name}</Text>
            </TouchableOpacity>
          )}
        />

        <Text style={styles.label}>Leave Type</Text>
        <View style={styles.typeRow}>
          {LEAVE_TYPES.map((type) => (
            <TouchableOpacity
              key={type}
              style={[styles.chip, leaveType === type && styles.chipSelected]}
              onPress={() => setLeaveType(type)}
            >
              <Text style={[styles.chipText, leaveType === type && styles.chipTextSelected]}>{type}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Input label="Start Date (YYYY-MM-DD)" value={startDate} onChangeText={setStartDate} />
        <Input label="End Date (YYYY-MM-DD)" value={endDate} onChangeText={setEndDate} />
        <Input label="Reason (optional)" value={reason} onChangeText={setReason} multiline placeholder="Reason for leave" />

        <Button title="Submit Request" onPress={handleSubmit} loading={saving} />
      </ScrollView>
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 44,
      paddingBottom: 16,
    },
    backText: { color: colors.accent, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
    title: { fontSize: 18, fontFamily: 'Sora_700Bold', color: colors.textPrimary },
    content: { paddingHorizontal: 20, paddingBottom: 32 },
    label: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary, marginBottom: 8, marginTop: 4 },
    typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    chip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radiusPill,
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: colors.card,
    },
    chipSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
    chipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary, textTransform: 'capitalize' },
    chipTextSelected: { color: colors.white },
  });
}

