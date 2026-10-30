import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../context/ThemeContext';
import { getEmployee } from '../../services/employeeService';
import { getEmployeeAttendanceHistory } from '../../services/recordsService';
import { deriveAttendanceStatus, deriveDisplayStatus } from '../../utils/attendanceStatus';
import StatusPill from '../../components/StatusPill';
import ManualBadge from '../../components/ManualBadge';

export default function EmployeeAttendanceScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { employeeId } = route.params;
  const [employee, setEmployee] = useState(null);
  const [history, setHistory] = useState({ records: [], summary: null });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [employeeData, historyData] = await Promise.all([
        getEmployee(employeeId),
        getEmployeeAttendanceHistory(employeeId),
      ]);
      setEmployee(employeeData);
      setHistory(historyData);
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not load attendance history', text2: error.message });
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function formatTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{employee?.name || 'Employee'} — Attendance</Text>
        <View style={styles.backSpacer} />
      </View>

      {history.summary && (
        <View style={styles.summaryRow}>
          <SummaryStat label="Present (Month)" value={history.summary.daysPresentThisMonth} />
          <SummaryStat label="Avg Hours" value={history.summary.averageHours} />
          <SummaryStat label="Attendance %" value={`${history.summary.attendancePercentage}%`} />
          <SummaryStat label="OT Hours (Month)" value={history.summary.overtimeHours} />
        </View>
      )}

      <FlatList
        data={history.records}
        keyExtractor={(item) => item.id}
        refreshing={loading}
        onRefresh={load}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.recordCard}>
            <View style={styles.recordHeader}>
              <View style={styles.recordDateRow}>
                <Text style={styles.recordDate}>{item.date}</Text>
                {item.marked_by === 'manual' ? <ManualBadge status={deriveAttendanceStatus(item)} /> : null}
                {item.manual_checkout ? <ManualBadge variant="checkout" /> : null}
              </View>
              <View style={styles.recordDateRow}>
                <StatusPill status={deriveDisplayStatus(item)} />
              </View>
              {item.marked_by === 'manual' ? (
                <Text style={styles.recordStatus}>Marked manually by {item.marked_by_name || 'unknown'}</Text>
              ) : null}
              {item.manual_checkout ? (
                <Text style={styles.recordStatus}>Check-out entered by {item.checkout_marked_by_name || 'unknown'}</Text>
              ) : null}
            </View>
            <View style={styles.recordRow}>
              <Text style={styles.recordDetail}>In: {formatTime(item.check_in)}</Text>
              <Text style={styles.recordDetail}>Out: {formatTime(item.check_out)}</Text>
              <Text style={styles.recordDetail}>
                {item.duration_minutes ? `${Math.floor(item.duration_minutes / 60)}h ${item.duration_minutes % 60}m` : '—'}
                {item.overtime_minutes > 0
                  ? ` (OT: ${Math.floor(item.overtime_minutes / 60)}h ${item.overtime_minutes % 60}m)`
                  : ''}
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          !loading && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No attendance history yet.</Text>
            </View>
          )
        }
      />
    </View>
  );
}

function SummaryStat({ label, value }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.summaryStat}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
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
      paddingBottom: 12,
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
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
      flexShrink: 1,
    },
    summaryRow: {
      flexDirection: 'row',
      paddingHorizontal: 20,
      gap: 10,
      marginBottom: 16,
    },
    summaryStat: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: 10,
      padding: 12,
      alignItems: 'center',
    },
    summaryValue: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.accent,
    },
    summaryLabel: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 4,
      textAlign: 'center',
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
    recordDateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    recordDate: {
      fontSize: 13,
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
    recordStatus: {
      fontSize: 11,
      color: colors.accent,
      textTransform: 'capitalize',
    },
    recordRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    recordDetail: {
      fontSize: 12,
      color: colors.textSecondary,
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

