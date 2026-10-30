import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getLeaveRequests, reviewLeaveRequest } from '../../services/leaveService';
import EmptyState from '../../components/EmptyState';
import StatusPill from '../../components/StatusPill';

const FILTERS = ['pending', 'approved', 'rejected', 'all'];

export default function LeaveRequestsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { userData, firebaseUser } = useAuth();
  const companyId = userData?.company_id;
  const canReview = userData?.role === 'owner' || userData?.role === 'manager' || userData?.role === 'partner_edit';

  const [filter, setFilter] = useState('pending');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const data = await getLeaveRequests(companyId, filter === 'all' ? {} : { status: filter });
      setRequests(data);
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not load requests', text2: error.message });
    } finally {
      setLoading(false);
    }
  }, [companyId, filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleReview(request, status, isPaid) {
    setActingId(request.id);
    try {
      await reviewLeaveRequest({
        requestId: request.id,
        status,
        reviewerId: firebaseUser.id,
        reviewerName: userData?.name,
        isPaid,
      });
      Toast.show({
        type: 'success',
        text1: status === 'approved' ? `Leave approved (${isPaid ? 'paid' : 'unpaid'})` : 'Leave rejected',
      });
      load();
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not update request', text2: error.message });
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
        <Text style={styles.title}>Leave Requests</Text>
        <TouchableOpacity onPress={() => navigation.navigate('RequestLeave')}>
          <MaterialCommunityIcons name="plus" size={24} color={colors.accent} />
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipSelected]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextSelected]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: 24 + Math.max(insets.bottom, 16) }]}
          ListEmptyComponent={
            <EmptyState
              icon="calendar-blank-outline"
              title="No leave requests"
              description="Requests submitted here will show up for review."
            />
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.employeeName}>{item.employees?.name ?? 'Unknown'}</Text>
                <StatusPill status={item.status} />
              </View>
              <Text style={styles.dates}>
                {item.start_date} → {item.end_date} · {item.leave_type}
              </Text>
              {item.reason ? <Text style={styles.reason}>{item.reason}</Text> : null}
              {item.status === 'approved' && item.is_paid != null ? (
                <Text style={styles.paidLabel}>{item.is_paid ? 'Paid leave' : 'Unpaid leave'}</Text>
              ) : null}
              {canReview && item.status === 'pending' ? (
                <>
                  <Text style={styles.approveHint}>Approve as:</Text>
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: colors.successSoft }]}
                      onPress={() => handleReview(item, 'approved', true)}
                      disabled={actingId === item.id}
                    >
                      <Text style={[styles.actionText, { color: colors.success }]}>Approve — Paid</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: colors.accentSoft }]}
                      onPress={() => handleReview(item, 'approved', false)}
                      disabled={actingId === item.id}
                    >
                      <Text style={[styles.actionText, { color: colors.accent }]}>Approve — Unpaid</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.errorSoft, marginTop: 8 }]}
                    onPress={() => handleReview(item, 'rejected', null)}
                    disabled={actingId === item.id}
                  >
                    <Text style={[styles.actionText, { color: colors.error }]}>Reject</Text>
                  </TouchableOpacity>
                </>
              ) : null}
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
      paddingBottom: 12,
    },
    backText: { color: colors.accent, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
    title: { fontSize: 18, fontFamily: 'Sora_700Bold', color: colors.textPrimary },
    filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 12 },
    filterChip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radiusPill,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.card,
    },
    filterChipSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
    filterText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary, textTransform: 'capitalize' },
    filterTextSelected: { color: colors.white },
    list: { paddingHorizontal: 20, paddingBottom: 24 },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radiusMd,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 10,
    },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    employeeName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
    dates: { fontSize: 12, color: colors.textSecondary, textTransform: 'capitalize' },
    reason: { fontSize: 12, color: colors.textPrimary, marginTop: 6 },
    paidLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.accent, marginTop: 6 },
    approveHint: { fontSize: 11, color: colors.textSecondary, marginTop: 12, marginBottom: 6 },
    actionRow: { flexDirection: 'row', gap: 10 },
    actionBtn: { flex: 1, borderRadius: colors.radiusSm, paddingVertical: 8, alignItems: 'center' },
    actionText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  });
}

