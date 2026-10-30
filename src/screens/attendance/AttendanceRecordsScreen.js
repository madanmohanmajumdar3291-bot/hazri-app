import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getEmployees } from '../../services/employeeService';
import { getAttendanceRecords } from '../../services/recordsService';
import { deriveAttendanceStatus, deriveDisplayStatus } from '../../utils/attendanceStatus';
import StatusPill from '../../components/StatusPill';
import ManualBadge from '../../components/ManualBadge';

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
];

function dateRangeFor(period) {
  const today = new Date();
  const toDate = today.toISOString().slice(0, 10);
  const from = new Date(today);
  if (period === 'week') from.setDate(from.getDate() - 6);
  else if (period === 'month') from.setDate(from.getDate() - 29);
  return { fromDate: from.toISOString().slice(0, 10), toDate };
}

export default function AttendanceRecordsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { userData } = useAuth();
  const companyId = userData?.company_id;
  const [period, setPeriod] = useState('today');
  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!companyId) return;
      getEmployees(companyId).then(setEmployees).catch(() => {});
    }, [companyId])
  );

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const { fromDate, toDate } = dateRangeFor(period);
      const data = await getAttendanceRecords(companyId, {
        employeeId: selectedEmployeeId,
        fromDate,
        toDate,
      });
      setRecords(data);
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not load records', text2: error.message });
    } finally {
      setLoading(false);
    }
  }, [companyId, period, selectedEmployeeId]);

  useEffect(() => {
    load();
  }, [load]);

  function formatTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Attendance Records</Text>
        <View style={styles.backSpacer} />
      </View>

      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[styles.periodChip, period === p.key && styles.periodChipSelected]}
            onPress={() => setPeriod(p.key)}
          >
            <Text style={[styles.periodChipText, period === p.key && styles.periodChipTextSelected]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={employees}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.employeeFilterRow}
        style={styles.employeeFilterList}
        ListHeaderComponent={
          <TouchableOpacity
            style={[styles.employeeChip, !selectedEmployeeId && styles.employeeChipSelected]}
            onPress={() => setSelectedEmployeeId(null)}
          >
            <Text style={[styles.employeeChipText, !selectedEmployeeId && styles.employeeChipTextSelected]}>
              All
            </Text>
          </TouchableOpacity>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.employeeChip, selectedEmployeeId === item.id && styles.employeeChipSelected]}
            onPress={() => setSelectedEmployeeId(item.id)}
          >
            <Text
              style={[
                styles.employeeChipText,
                selectedEmployeeId === item.id && styles.employeeChipTextSelected,
              ]}
            >
              {item.name}
            </Text>
          </TouchableOpacity>
        )}
      />

      <FlatList
        data={records}
        keyExtractor={(item) => item.id}
        refreshing={loading}
        onRefresh={load}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.recordCard}
            onPress={() => navigation.navigate('EmployeeAttendance', { employeeId: item.employee_id })}
          >
            <View style={styles.recordHeader}>
              <View style={styles.recordNameRow}>
                <Text style={styles.recordName}>{item.employee_name}</Text>
                {item.marked_by === 'manual' ? <ManualBadge status={deriveAttendanceStatus(item)} /> : null}
                {item.manual_checkout ? <ManualBadge variant="checkout" /> : null}
              </View>
              <Text style={styles.recordDate}>{item.date}</Text>
            </View>
            <View style={styles.recordStatusRow}>
              <StatusPill status={deriveDisplayStatus(item)} />
              {item.overtime_minutes > 0 ? (
                <View style={styles.otBadge}>
                  <Text style={styles.otBadgeText}>
                    OT {Math.floor(item.overtime_minutes / 60)}h {item.overtime_minutes % 60}m
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.recordRow}>
              <Text style={styles.recordDetail}>In: {formatTime(item.check_in)}</Text>
              <Text style={styles.recordDetail}>Out: {formatTime(item.check_out)}</Text>
              <Text style={styles.recordDetail}>
                {item.duration_minutes ? `${Math.floor(item.duration_minutes / 60)}h ${item.duration_minutes % 60}m` : '—'}
              </Text>
            </View>
            {item.status ? (
              <Text style={styles.recordStatus}>
                {item.status}
                {item.marked_by === 'manual' ? ` · Marked manually by ${item.marked_by_name || 'unknown'}` : ''}
              </Text>
            ) : null}
            {item.manual_checkout ? (
              <Text style={styles.recordStatus}>Check-out entered by {item.checkout_marked_by_name || 'unknown'}</Text>
            ) : null}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !loading && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No attendance records for this period.</Text>
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
    backSpacer: {
      width: 40,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    periodRow: {
      flexDirection: 'row',
      paddingHorizontal: 20,
      gap: 8,
      marginBottom: 8,
    },
    periodChip: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 8,
      alignItems: 'center',
      backgroundColor: colors.card,
    },
    periodChipSelected: {
      borderColor: colors.accent,
      borderWidth: 2,
    },
    periodChipText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    periodChipTextSelected: {
      color: colors.accent,
    },
    employeeFilterList: {
      maxHeight: 48,
      marginBottom: 8,
    },
    employeeFilterRow: {
      paddingHorizontal: 20,
      gap: 8,
    },
    employeeChip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 6,
      marginRight: 8,
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
    list: {
      paddingHorizontal: 20,
      paddingBottom: 24,
    },
    recordCard: {
      backgroundColor: colors.card,
      borderRadius: 8,
      padding: 12,
      marginBottom: 10,
    },
    recordHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    recordNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    recordName: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    meBadge: {
      backgroundColor: colors.accent,
      borderRadius: 4,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    meBadgeText: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.white,
    },
    recordDate: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    recordStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 6,
    },
    otBadge: {
      backgroundColor: colors.infoSoft,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    otBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.info,
    },
    recordRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    recordDetail: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    recordStatus: {
      fontSize: 11,
      color: colors.accent,
      marginTop: 4,
      textTransform: 'capitalize',
    },
    emptyState: {
      alignItems: 'center',
      marginTop: 60,
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: 14,
    },
  });
}

