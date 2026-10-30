import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { getAvatarColor, getInitials } from '../../components/EmployeeCard';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getManagers, FREE_MANAGER_LIMIT } from '../../services/managerService';

export default function ManagersListScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { userData } = useAuth();
  const companyId = userData?.company_id;
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const data = await getManagers(companyId);
      setManagers(data);
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not load managers', text2: error.message });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const userCount = managers.length;
  const isLocked = userCount >= FREE_MANAGER_LIMIT;

  function handleAdd() {
    if (isLocked) {
      Toast.show({
        type: 'info',
        text1: 'User limit reached',
        text2: `Free plan allows ${FREE_MANAGER_LIMIT} user accounts. Upgrade to add more.`,
      });
      return;
    }
    navigation.navigate('CreateManager');
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Users</Text>
        <TouchableOpacity onPress={handleAdd}>
          <Text style={styles.addText}>
            + Add ({userCount}/{FREE_MANAGER_LIMIT})
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={managers}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={load}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('ManagerDetail', { managerId: item.id })}
          >
            <View style={[styles.avatar, { backgroundColor: getAvatarColor(item.name) }]}>
              <Text style={styles.avatarText}>{getInitials(item.name)}</Text>
            </View>
            <View style={styles.info}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.phone}>{item.phone}</Text>
              <View style={styles.badgeRow}>
                {item.permissions?.can_add_employees && <Text style={styles.badge}>Add Employees</Text>}
                {item.permissions?.can_view_attendance && <Text style={styles.badge}>View Attendance</Text>}
                {item.permissions?.can_manual_mark && <Text style={styles.badge}>Manual Mark</Text>}
              </View>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !loading && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No users added yet.</Text>
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
    addText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '600',
    },
    list: {
      padding: 20,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: 8,
      padding: 12,
      marginBottom: 10,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    avatarText: {
      color: colors.white,
      fontWeight: '700',
      fontSize: 15,
    },
    info: {
      flex: 1,
    },
    name: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    phone: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
    badgeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 6,
    },
    badge: {
      fontSize: 10,
      fontWeight: '600',
      color: colors.accent,
      backgroundColor: colors.accentSoft,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
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

