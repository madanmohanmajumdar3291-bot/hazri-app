import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getEmployees } from '../../services/employeeService';
import { getMovementTimeline, computeRouteDistanceMeters } from '../../services/locationService';
import EmptyState from '../../components/EmptyState';

function todayStartIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function FieldSummaryScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { userData } = useAuth();
  const companyId = userData?.company_id;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;

    async function load() {
      const employees = await getEmployees(companyId);
      const fieldEmployees = employees.filter((e) => e.work_mode === 'remote');
      const from = todayStartIso();

      const results = await Promise.all(
        fieldEmployees.map(async (employee) => {
          const points = await getMovementTimeline(employee.id, { fromDate: from }).catch(() => []);
          const km = computeRouteDistanceMeters(points) / 1000;
          const lastSeen = points.length > 0 ? points[points.length - 1].recorded_at : null;
          return { employee, km, points: points.length, lastSeen };
        })
      );

      if (!cancelled) {
        setRows(results.sort((a, b) => b.km - a.km));
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Field Summary</Text>
        <View style={{ width: 40 }} />
      </View>
      <Text style={styles.subtitle}>Today's field activity</Text>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.employee.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState
              icon="map-marker-distance"
              title="No field employees yet"
              description="Mark employees as Remote / Field to see their daily route and distance summary here."
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() =>
                navigation.navigate('MovementTimeline', { employeeId: item.employee.id, employeeName: item.employee.name })
              }
            >
              <Text style={styles.name}>{item.employee.name}</Text>
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{item.km.toFixed(1)} km</Text>
                  <Text style={styles.statLabel}>Traveled</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{item.points}</Text>
                  <Text style={styles.statLabel}>Route Points</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>
                    {item.lastSeen ? new Date(item.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </Text>
                  <Text style={styles.statLabel}>Last Seen</Text>
                </View>
              </View>
            </TouchableOpacity>
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
    name: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary, marginBottom: 10 },
    statsRow: { flexDirection: 'row', gap: 24 },
    stat: {},
    statValue: { fontSize: 18, fontFamily: 'Sora_700Bold', color: colors.accent },
    statLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  });
}

