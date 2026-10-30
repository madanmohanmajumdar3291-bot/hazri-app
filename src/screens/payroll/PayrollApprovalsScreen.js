import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getPayroll, approvePayrollRecord, markPayrollPaid } from '../../services/payrollService';
import EmptyState from '../../components/EmptyState';
import StatusPill from '../../components/StatusPill';
import EmployeeCodeBadge from '../../components/EmployeeCodeBadge';
import { SERIF_FONT } from '../../constants/designTokens';

function formatMoney(value) {
  return `₹${Number(value ?? 0).toLocaleString('en-IN')}`;
}

export default function PayrollApprovalsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { userData, firebaseUser } = useAuth();
  const companyId = userData?.company_id;

  const [month] = useState(new Date());
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const data = await getPayroll(companyId, month);
      setRecords(data);
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not load payroll', text2: error.message });
    } finally {
      setLoading(false);
    }
  }, [companyId, month]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleApprove(record) {
    setActingId(record.id);
    try {
      await approvePayrollRecord(record.id, firebaseUser.id);
      Toast.show({ type: 'success', text1: 'Approved' });
      load();
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not approve', text2: error.message });
    } finally {
      setActingId(null);
    }
  }

  async function handleMarkPaid(record) {
    setActingId(record.id);
    try {
      await markPayrollPaid(record.id);
      Toast.show({ type: 'success', text1: 'Marked as paid' });
      load();
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not update', text2: error.message });
    } finally {
      setActingId(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Payroll Approvals</Text>
        <View style={{ width: 40 }} />
      </View>
      <Text style={styles.subtitle}>
        {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
      </Text>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={records}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: 24 + Math.max(insets.bottom, 16) }]}
          ListEmptyComponent={
            <EmptyState
              icon="cash-multiple"
              title="No payroll generated yet"
              description="Generate this month's payroll from the Payroll screen first."
            />
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.nameRow}>
                  <Text style={styles.employeeName}>{item.employee?.name ?? 'Unknown'}</Text>
                  <EmployeeCodeBadge code={item.employee?.employee_code} />
                </View>
                <StatusPill status={item.status === 'paid' ? 'present' : item.status === 'approved' ? 'approved' : 'pending'} label={item.status} />
              </View>
              <Text style={styles.amount}>{formatMoney(item.payable_amount)}</Text>
              <Text style={styles.meta}>
                {item.days_present} present · {item.days_absent} absent · {item.days_late} late
              </Text>
              <View style={styles.actionRow}>
                {item.status === 'pending' ? (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.successSoft }]}
                    onPress={() => handleApprove(item)}
                    disabled={actingId === item.id}
                  >
                    <Text style={[styles.actionText, { color: colors.success }]}>Approve</Text>
                  </TouchableOpacity>
                ) : null}
                {item.status === 'approved' ? (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.accentSoft }]}
                    onPress={() => handleMarkPaid(item)}
                    disabled={actingId === item.id}
                  >
                    <Text style={[styles.actionText, { color: colors.accent }]}>Mark Paid</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          )}
        />
      )}
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
      paddingBottom: 4,
    },
    backText: { color: colors.accent, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
    title: { fontSize: 18, fontFamily: 'Sora_700Bold', color: colors.textPrimary },
    subtitle: { fontSize: 12, color: colors.textSecondary, paddingHorizontal: 20, marginBottom: 12 },
    list: { paddingHorizontal: 20, paddingBottom: 24 },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radiusMd,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 10,
    },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    employeeName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
    amount: { fontSize: 20, fontFamily: SERIF_FONT, fontWeight: '700', color: colors.textPrimary, marginTop: 6 },
    meta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
    actionBtn: { flex: 1, borderRadius: colors.radiusSm, paddingVertical: 8, alignItems: 'center' },
    actionText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  });
}

