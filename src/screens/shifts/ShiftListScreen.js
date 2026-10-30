import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getShifts } from '../../services/shiftService';

export default function ShiftListScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { userData } = useAuth();
  const companyId = userData?.company_id;
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const data = await getShifts(companyId);
      setShifts(data);
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not load shifts', text2: error.message });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const filtered = shifts.filter(
    (s) =>
      s.shift_name.toLowerCase().includes(search.trim().toLowerCase()) ||
      s.shift_code.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity onPress={() => navigation.replace('Menu')}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Shift Master</Text>
        <TouchableOpacity onPress={() => navigation.navigate('ShiftForm', {})}>
          <Text style={styles.addText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.countText}>{shifts.length} Record{shifts.length === 1 ? '' : 's'}</Text>

      <TextInput
        style={styles.searchInput}
        placeholder="Search Shift Code / Name"
        placeholderTextColor={colors.textSecondary}
        value={search}
        onChangeText={setSearch}
      />

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={load}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('ShiftForm', { shiftId: item.id })}
          >
            <View style={styles.codeBadge}>
              <Text style={styles.codeText}>{item.shift_code}</Text>
            </View>
            <View style={styles.info}>
              <Text style={styles.name}>{item.shift_name}</Text>
              <Text style={styles.timing}>
                {item.start_time} – {item.end_time}
              </Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !loading && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                No shifts defined yet. Tap '+ Add' to create your first shift.
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
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 4,
    },
    backText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
    title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
    addText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
    countText: {
      fontSize: 12,
      color: colors.textSecondary,
      paddingHorizontal: 20,
      marginBottom: 8,
    },
    searchInput: {
      marginHorizontal: 20,
      marginBottom: 12,
      height: 44,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 14,
      backgroundColor: colors.card,
      color: colors.textPrimary,
    },
    list: { paddingHorizontal: 20, paddingBottom: 24 },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: 8,
      padding: 14,
      marginBottom: 10,
    },
    codeBadge: {
      width: 44,
      height: 44,
      borderRadius: 8,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    codeText: { color: colors.accent, fontWeight: '700', fontSize: 13 },
    info: { flex: 1 },
    name: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    timing: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    emptyState: { alignItems: 'center', marginTop: 60, paddingHorizontal: 32 },
    emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
  });
}

