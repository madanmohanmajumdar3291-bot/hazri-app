import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import {
  getPayroll,
  generatePayroll,
  updatePayrollAmount,
  getIncompleteAttendance,
  resolveIncompleteAttendance,
} from '../../services/payrollService';

const STATUS_OPTIONS = [
  { value: 'present', label: 'Present' },
  { value: 'half_day', label: 'Half Day' },
  { value: 'absent', label: 'Absent' },
];

function monthLabel(date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export default function PayrollScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { userData } = useAuth();
  const companyId = userData?.company_id;

  const [month, setMonth] = useState(() => new Date());
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [edits, setEdits] = useState({}); // recordId -> string value being typed
  const [savingId, setSavingId] = useState(null);
  const [incomplete, setIncomplete] = useState([]);
  const [resolvingId, setResolvingId] = useState(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [data, incompleteData] = await Promise.all([
        getPayroll(companyId, month),
        getIncompleteAttendance(companyId, month),
      ]);
      setRecords(data);
      setIncomplete(incompleteData);
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not load payroll', text2: error.message });
    } finally {
      setLoading(false);
    }
  }, [companyId, month]);

  async function handleResolveIncomplete(record, status) {
    setResolvingId(record.id);
    try {
      await resolveIncompleteAttendance(record.id, status);
      setIncomplete((prev) => prev.filter((r) => r.id !== record.id));
      Toast.show({ type: 'success', text1: `Marked ${STATUS_OPTIONS.find((o) => o.value === status)?.label}` });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not update', text2: error.message });
    } finally {
      setResolvingId(null);
    }
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function changeMonth(offset) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const data = await generatePayroll(companyId, month, userData.id);
      setRecords(data);
      setEdits({});
      Toast.show({ type: 'success', text1: 'Payroll generated' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not generate payroll', text2: error.message });
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveAmount(record) {
    const raw = edits[record.id];
    const amount = raw !== undefined ? Number(raw) : record.payable_amount;
    if (Number.isNaN(amount) || amount < 0) {
      Toast.show({ type: 'error', text1: 'Enter a valid amount' });
      return;
    }
    setSavingId(record.id);
    try {
      const updated = await updatePayrollAmount(record.id, amount, record.notes);
      setRecords((prev) => prev.map((r) => (r.id === record.id ? { ...r, ...updated, employee: r.employee } : r)));
      setEdits((prev) => {
        const next = { ...prev };
        delete next[record.id];
        return next;
      });
      Toast.show({ type: 'success', text1: 'Saved' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not save', text2: error.message });
    } finally {
      setSavingId(null);
    }
  }

  const totalPayable = records.reduce((sum, r) => sum + (r.payable_amount || 0), 0);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Payroll & Salary</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.monthRow}>
        <TouchableOpacity onPress={() => changeMonth(-1)}>
          <Text style={styles.monthArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
        <TouchableOpacity onPress={() => changeMonth(1)}>
          <Text style={styles.monthArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {incomplete.length > 0 && (
        <View style={styles.incompleteCard}>
          <Text style={styles.incompleteTitle}>
            {incomplete.length} check-in{incomplete.length === 1 ? '' : 's'} never checked out
          </Text>
          <Text style={styles.incompleteHint}>
            Pick what these days should count as before generating payroll.
          </Text>
          {incomplete.map((record) => (
            <View key={record.id} style={styles.incompleteRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.incompleteName}>{record.employees?.name ?? 'Unknown'}</Text>
                <Text style={styles.incompleteDate}>{record.date}</Text>
              </View>
              <View style={styles.incompleteChips}>
                {STATUS_OPTIONS.map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    style={styles.incompleteChip}
                    disabled={resolvingId === record.id}
                    onPress={() => handleResolveIncomplete(record, option.value)}
                  >
                    <Text style={styles.incompleteChipText}>
                      {resolvingId === record.id ? '...' : option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.generateRow}>
        <Button
          title={records.length ? 'Re-generate Payroll' : 'Generate Payroll'}
          onPress={handleGenerate}
          loading={generating}
        />
      </View>

      {records.length > 0 && (
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>Total Payable This Month</Text>
          <Text style={styles.totalValue}>₹{totalPayable.toLocaleString()}</Text>
        </View>
      )}

      <FlatList
        data={records}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={load}
        renderItem={({ item }) => {
          const editValue = edits[item.id] ?? String(item.payable_amount ?? 0);
          const overtimeHours = (item.overtime_minutes / 60).toFixed(1);
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.employeeName}>{item.employee?.name ?? 'Unknown'}</Text>
                <Text style={styles.employeeCode}>{item.employee?.employee_code}</Text>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{item.days_present}</Text>
                  <Text style={styles.statLabel}>Present</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{item.days_absent}</Text>
                  <Text style={styles.statLabel}>Absent</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{item.days_half_day}</Text>
                  <Text style={styles.statLabel}>Half Day</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{item.days_late}</Text>
                  <Text style={styles.statLabel}>Late</Text>
                </View>
              </View>

              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownText}>Base Salary: ₹{item.base_salary}</Text>
                <Text style={styles.breakdownText}>
                  Overtime: {overtimeHours}h (₹{item.overtime_pay})
                </Text>
              </View>

              <Text style={styles.label}>Payable Amount</Text>
              <View style={styles.amountRow}>
                <View style={styles.amountInput}>
                  <Input
                    value={editValue}
                    onChangeText={(v) => setEdits((prev) => ({ ...prev, [item.id]: v.replace(/[^0-9.]/g, '') }))}
                    keyboardType="decimal-pad"
                  />
                </View>
                <TouchableOpacity
                  style={styles.saveButton}
                  onPress={() => handleSaveAmount(item)}
                  disabled={savingId === item.id}
                >
                  <Text style={styles.saveButtonText}>{savingId === item.id ? '...' : 'Save'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          !loading && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                No payroll generated for this month yet. Tap "Generate Payroll" above.
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 8,
    },
    backText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '600',
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    monthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 20,
      marginBottom: 12,
    },
    monthArrow: {
      fontSize: 22,
      color: colors.accent,
      fontWeight: '700',
      paddingHorizontal: 10,
    },
    monthLabel: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    generateRow: {
      paddingHorizontal: 20,
      marginBottom: 12,
    },
    incompleteCard: {
      backgroundColor: colors.warningSoft,
      borderRadius: 12,
      padding: 14,
      marginHorizontal: 20,
      marginBottom: 12,
    },
    incompleteTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    incompleteHint: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
      marginBottom: 10,
    },
    incompleteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    incompleteName: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    incompleteDate: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 1,
    },
    incompleteChips: {
      flexDirection: 'row',
      gap: 6,
    },
    incompleteChip: {
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: 14,
      paddingHorizontal: 9,
      paddingVertical: 5,
    },
    incompleteChipText: {
      fontSize: 10.5,
      fontWeight: '700',
      color: colors.accent,
    },
    totalCard: {
      backgroundColor: colors.accentSoft,
      borderRadius: 12,
      padding: 16,
      marginHorizontal: 20,
      marginBottom: 12,
      alignItems: 'center',
    },
    totalLabel: {
      fontSize: 12,
      color: colors.accent,
      fontWeight: '600',
    },
    totalValue: {
      fontSize: 24,
      color: colors.accent,
      fontWeight: '800',
      marginTop: 2,
    },
    list: {
      padding: 20,
      paddingTop: 0,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    employeeName: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    employeeCode: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    statsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    statItem: {
      alignItems: 'center',
      flex: 1,
    },
    statValue: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    statLabel: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
    },
    breakdownRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    breakdownText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    label: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 4,
    },
    amountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    amountInput: {
      flex: 1,
      marginBottom: 0,
    },
    saveButton: {
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingHorizontal: 18,
      paddingVertical: 13,
    },
    saveButtonText: {
      color: colors.white,
      fontWeight: '700',
      fontSize: 13,
    },
    emptyState: {
      alignItems: 'center',
      marginTop: 60,
      paddingHorizontal: 32,
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: 14,
      textAlign: 'center',
    },
  });
}

