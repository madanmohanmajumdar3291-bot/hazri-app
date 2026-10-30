import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import {
  getCompanySites,
  createSite,
  deleteSite,
  getCurrentPosition,
  searchAddress,
} from '../../services/locationService';
import Input from '../../components/Input';
import Button from '../../components/Button';
import EmptyState from '../../components/EmptyState';
import LeafletMap from '../../components/LeafletMap';

const DEFAULT_CENTER = { latitude: 20.5937, longitude: 78.9629 }; // India, used until a pin is placed

export default function SitesListScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { userData } = useAuth();
  const companyId = userData?.company_id;

  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState('');
  const [radius, setRadius] = useState('150');
  const [pin, setPin] = useState(null);
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const data = await getCompanySites(companyId);
      setSites(data);
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not load branches', text2: error.message });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  function openAddModal() {
    setName('');
    setRadius('150');
    setPin(null);
    setMapCenter(DEFAULT_CENTER);
    setSearchText('');
    setSearchResults([]);
    setModalVisible(true);
  }

  async function handleUseCurrentLocation() {
    setLocating(true);
    const pos = await getCurrentPosition();
    setLocating(false);
    if (!pos) {
      Toast.show({ type: 'error', text1: 'Could not get current location', text2: 'Grant location access and try again.' });
      return;
    }
    setPin(pos);
    setMapCenter(pos);
  }

  async function handleSearch() {
    if (!searchText.trim()) return;
    setSearching(true);
    try {
      const results = await searchAddress(searchText.trim());
      setSearchResults(results);
      if (results.length === 0) {
        Toast.show({ type: 'info', text1: 'No matches found', text2: 'Try a more specific address or nearby landmark.' });
      }
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Search failed', text2: error.message });
    } finally {
      setSearching(false);
    }
  }

  function selectSearchResult(result) {
    setPin({ latitude: result.latitude, longitude: result.longitude });
    setMapCenter({ latitude: result.latitude, longitude: result.longitude });
    setSearchResults([]);
    setSearchText(result.label);
  }

  async function handleSave() {
    if (!name.trim()) {
      Toast.show({ type: 'error', text1: 'Enter a branch name' });
      return;
    }
    if (!pin) {
      Toast.show({ type: 'error', text1: 'Pick a location', text2: 'Search an address, tap the map, or use your current location.' });
      return;
    }
    setSaving(true);
    try {
      await createSite({
        companyId,
        name: name.trim(),
        latitude: pin.latitude,
        longitude: pin.longitude,
        radiusMeters: Number(radius) || 150,
      });
      setModalVisible(false);
      load();
      Toast.show({ type: 'success', text1: 'Branch added' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not add branch', text2: error.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(site) {
    try {
      await deleteSite(site.id);
      setSites((prev) => prev.filter((s) => s.id !== site.id));
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not remove branch', text2: error.message });
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Branches & Geofences</Text>
        <TouchableOpacity onPress={openAddModal}>
          <MaterialCommunityIcons name="plus" size={24} color={colors.accent} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={sites}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState
              icon="map-marker-radius-outline"
              title="No branches yet"
              description="Add a branch to restrict attendance to an approved location radius. Without a branch, check-ins are unrestricted."
              actionLabel="Add Branch"
              onAction={openAddModal}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowIconWrap}>
                <MaterialCommunityIcons name="map-marker-radius-outline" size={20} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{item.name}</Text>
                <Text style={styles.rowDesc}>{item.radius_meters}m radius</Text>
              </View>
              <TouchableOpacity onPress={() => handleDelete(item)} hitSlop={10}>
                <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.error} />
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <Modal visible={modalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView style={styles.modalScreen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Text style={styles.backText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Add Branch</Text>
            <View style={{ width: 50 }} />
          </View>

          <View style={styles.searchRow}>
            <View style={{ flex: 1 }}>
              <Input
                value={searchText}
                onChangeText={setSearchText}
                placeholder="Search an address or place"
                autoCapitalize="none"
              />
            </View>
            <TouchableOpacity style={styles.searchBtn} onPress={handleSearch} disabled={searching}>
              {searching ? <ActivityIndicator color={colors.white} size="small" /> : <MaterialCommunityIcons name="magnify" size={20} color={colors.white} />}
            </TouchableOpacity>
          </View>

          {searchResults.length > 0 && (
            <View style={styles.resultsBox}>
              {searchResults.map((r, i) => (
                <TouchableOpacity key={i} style={styles.resultRow} onPress={() => selectSearchResult(r)}>
                  <MaterialCommunityIcons name="map-marker-outline" size={16} color={colors.accent} />
                  <Text style={styles.resultText} numberOfLines={2}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.mapHint}>Tap the map to place or move the pin, or drag it to fine-tune.</Text>
          <LeafletMap
            style={styles.map}
            center={mapCenter}
            zoom={pin ? 16 : 4}
            interactive
            pin={pin}
            circles={pin ? [{ latitude: pin.latitude, longitude: pin.longitude, radius: Number(radius) || 150, color: colors.accent }] : []}
            onLocationSelect={(loc) => setPin(loc)}
          />

          <TouchableOpacity style={styles.currentLocationBtn} onPress={handleUseCurrentLocation} disabled={locating}>
            {locating ? (
              <ActivityIndicator color={colors.accent} size="small" />
            ) : (
              <MaterialCommunityIcons name="crosshairs-gps" size={18} color={colors.accent} />
            )}
            <Text style={styles.currentLocationText}>Use My Current Location</Text>
          </TouchableOpacity>

          <View style={styles.formArea}>
            <Input label="Branch Name" value={name} onChangeText={setName} placeholder="e.g. Factory Gate" />
            <Input
              label="Radius (meters)"
              value={radius}
              onChangeText={setRadius}
              placeholder="150"
              keyboardType="number-pad"
            />
            {pin ? (
              <Text style={styles.coordsText}>{pin.latitude.toFixed(6)}, {pin.longitude.toFixed(6)}</Text>
            ) : (
              <Text style={styles.coordsPlaceholder}>No location selected yet</Text>
            )}
            <Button title="Save Branch" onPress={handleSave} loading={saving} disabled={!pin} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
    list: { paddingHorizontal: 20, paddingBottom: 24 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: colors.radiusMd,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: 8,
      gap: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rowIconWrap: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
    rowDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
    modalScreen: { flex: 1, backgroundColor: colors.background },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 44,
      paddingBottom: 12,
    },
    modalTitle: { fontSize: 16, fontFamily: 'Sora_700Bold', color: colors.textPrimary },
    searchRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, alignItems: 'flex-start' },
    searchBtn: {
      width: 48,
      height: 48,
      borderRadius: colors.radiusSm,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    resultsBox: {
      marginHorizontal: 20,
      marginTop: -8,
      marginBottom: 8,
      backgroundColor: colors.card,
      borderRadius: colors.radiusSm,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    resultRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    resultText: { flex: 1, fontSize: 12, color: colors.textPrimary },
    mapHint: { fontSize: 11, color: colors.textSecondary, paddingHorizontal: 20, marginBottom: 6 },
    map: { height: 220, marginHorizontal: 20, borderRadius: colors.radiusMd, overflow: 'hidden' },
    currentLocationBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginHorizontal: 20,
      marginTop: 10,
      paddingVertical: 10,
      borderRadius: colors.radiusSm,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    currentLocationText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.accent },
    formArea: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 },
    coordsText: { fontSize: 12, color: colors.success, marginBottom: 14 },
    coordsPlaceholder: { fontSize: 12, color: colors.textSecondary, marginBottom: 14 },
  });
}

