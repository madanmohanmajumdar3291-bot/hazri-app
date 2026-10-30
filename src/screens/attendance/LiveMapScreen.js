import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getLatestLocationsForCompany, getCompanySites, distanceMeters } from '../../services/locationService';
import { getEmployees } from '../../services/employeeService';
import StatCard from '../../components/StatCard';
import LiveMapView from '../../components/LiveMapView';

export default function LiveMapScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { userData } = useAuth();
  const companyId = userData?.company_id;

  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState([]);
  const [sites, setSites] = useState([]);
  const [totalEmployees, setTotalEmployees] = useState(0);

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const [locs, siteRows, employees] = await Promise.all([
        getLatestLocationsForCompany(companyId),
        getCompanySites(companyId),
        getEmployees(companyId),
      ]);
      setLocations(locs);
      setSites(siteRows);
      setTotalEmployees(employees.length);
    } catch (_error) {
      // Non-fatal — screen still renders with whatever loaded.
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const withGeofenceStatus = locations.map((loc) => {
    let isWithin = loc.is_within_geofence;
    if (isWithin == null && sites.length > 0) {
      isWithin = sites.some(
        (site) => distanceMeters(loc.latitude, loc.longitude, site.latitude, site.longitude) <= site.radius_meters
      );
    }
    return { ...loc, resolvedWithin: isWithin };
  });

  const onSiteCount = withGeofenceStatus.filter((l) => l.resolvedWithin !== false).length;
  const outsideCount = withGeofenceStatus.filter((l) => l.resolvedWithin === false).length;
  const absentCount = Math.max(0, totalEmployees - locations.length);

  const initialRegion =
    sites.length > 0
      ? { latitude: sites[0].latitude, longitude: sites[0].longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }
      : locations.length > 0
      ? { latitude: locations[0].latitude, longitude: locations[0].longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }
      : { latitude: 20.5937, longitude: 78.9629, latitudeDelta: 8, longitudeDelta: 8 };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Live Map</Text>
        <TouchableOpacity onPress={() => navigation.navigate('SitesList')}>
          <MaterialCommunityIcons name="map-marker-radius-outline" size={22} color={colors.accent} />
        </TouchableOpacity>
      </View>

      <View style={styles.statsRow}>
        <StatCard label="On Branch" value={onSiteCount} colorKey="success" softKey="successSoft" />
        <StatCard label="Outside" value={outsideCount} colorKey="error" softKey="errorSoft" />
        <StatCard label="Absent" value={absentCount} colorKey="textSecondary" softKey="border" />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <LiveMapView
          style={styles.map}
          initialRegion={initialRegion}
          sites={sites}
          locations={withGeofenceStatus}
          colors={colors}
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
    statsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginBottom: 12 },
    map: { flex: 1 },
  });
}
