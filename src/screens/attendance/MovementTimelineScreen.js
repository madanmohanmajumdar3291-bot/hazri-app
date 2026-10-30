import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../context/ThemeContext';
import { getMovementTimeline } from '../../services/locationService';
import EmptyState from '../../components/EmptyState';
import RouteMapView from '../../components/RouteMapView';

const EVENT_CONFIG = {
  check_in: { icon: 'login', label: 'Punched In', color: 'success' },
  check_out: { icon: 'logout', label: 'Punched Out', color: 'error' },
  ping: { icon: 'map-marker-outline', label: 'Location Update', color: 'info' },
};

export default function MovementTimelineScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { employeeId, employeeName } = route.params ?? {};

  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState([]);

  useEffect(() => {
    if (!employeeId) return;
    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setHours(0, 0, 0, 0);

    getMovementTimeline(employeeId, { fromDate: fromDate.toISOString() })
      .then((data) => setPoints(data.reverse()))
      .catch((error) => Toast.show({ type: 'error', text1: 'Could not load timeline', text2: error.message }))
      .finally(() => setLoading(false));
  }, [employeeId]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{employeeName ?? 'Movement'}</Text>
        <View style={{ width: 40 }} />
      </View>
      <Text style={styles.subtitle}>Today's movement timeline</Text>

      {!loading && points.length > 1 ? (
        <RouteMapView style={styles.routeMap} points={points} colors={colors} />
      ) : null}

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={points}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState
              icon="map-marker-path"
              title="No movement recorded"
              description="Location pings appear here as this employee checks in and out through the day."
            />
          }
          renderItem={({ item }) => {
            const config = EVENT_CONFIG[item.event_type] ?? EVENT_CONFIG.ping;
            return (
              <View style={styles.row}>
                <View style={[styles.dot, { backgroundColor: colors[config.color] }]}>
                  <MaterialCommunityIcons name={config.icon} size={14} color={colors.white} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{config.label}</Text>
                  <Text style={styles.rowMeta}>
                    {new Date(item.recorded_at).toLocaleTimeString()} · {item.latitude.toFixed(5)},{' '}
                    {item.longitude.toFixed(5)}
                  </Text>
                  {item.is_within_geofence === false ? (
                    <Text style={styles.outsideText}>Outside approved geofence</Text>
                  ) : null}
                </View>
              </View>
            );
          }}
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
    routeMap: { height: 220, marginHorizontal: 20, marginBottom: 16, borderRadius: colors.radiusMd, overflow: 'hidden' },
    list: { paddingHorizontal: 20, paddingBottom: 24 },
    row: { flexDirection: 'row', gap: 12, marginBottom: 16 },
    dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    rowLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
    rowMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    outsideText: { fontSize: 11, color: colors.error, marginTop: 2, fontFamily: 'Inter_500Medium' },
  });
}
