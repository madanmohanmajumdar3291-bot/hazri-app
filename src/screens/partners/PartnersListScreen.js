import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { getAvatarColor, getInitials } from '../../components/EmployeeCard';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getPartners, FREE_ADMIN_LIMIT, FREE_USER_LIMIT } from '../../services/partnerService';

export default function PartnersListScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const TIER_COLORS = { partner_edit: colors.accent, partner_view: colors.textSecondary };
  const { userData } = useAuth();
  const companyId = userData?.company_id;
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const data = await getPartners(companyId);
      setPartners(data);
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not load partners', text2: error.message });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Admin numbering is each partner_edit account's 1-based position among
  // partner_edit accounts, in creation order — independent of Users mixed
  // into the same list.
  const adminNumbers = useMemo(() => {
    const map = new Map();
    let n = 0;
    for (const p of partners) {
      if (p.role === 'partner_edit') map.set(p.id, ++n);
    }
    return map;
  }, [partners]);

  const adminCount = adminNumbers.size;
  const userCount = partners.length - adminCount;

  function handleAddAdmin() {
    if (adminCount >= FREE_ADMIN_LIMIT) {
      Toast.show({
        type: 'info',
        text1: 'Admin limit reached',
        text2: `Free plan allows ${FREE_ADMIN_LIMIT} admin account. Upgrade to add more.`,
      });
      return;
    }
    navigation.navigate('CreatePartner', { tier: 'partner_edit' });
  }

  function handleAddUser() {
    if (userCount >= FREE_USER_LIMIT) {
      Toast.show({
        type: 'info',
        text1: 'User limit reached',
        text2: `Free plan allows ${FREE_USER_LIMIT} user accounts. Upgrade to add more.`,
      });
      return;
    }
    navigation.navigate('CreatePartner', { tier: 'partner_view' });
  }

  function badgeLabel(item) {
    if (item.role === 'partner_edit') return `Admin ${adminNumbers.get(item.id)}`;
    return 'User';
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Admin & User Access</Text>
        <View style={{ width: 40 }} />
      </View>

      <Text style={styles.subtitle}>
        Admins get full editing access, same as you. Users can view data and mark attendance
        manually, nothing else. Free plan: {FREE_ADMIN_LIMIT} admins, {FREE_USER_LIMIT} users.
      </Text>

      <View style={styles.addRow}>
        <TouchableOpacity style={styles.addButton} onPress={handleAddAdmin}>
          <Text style={styles.addButtonText}>+ Add Admin ({adminCount}/{FREE_ADMIN_LIMIT})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.addButton} onPress={handleAddUser}>
          <Text style={styles.addButtonText}>+ Add User ({userCount}/{FREE_USER_LIMIT})</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={partners}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={load}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('PartnerDetail', { partnerId: item.id, adminNumber: adminNumbers.get(item.id) })}
          >
            <View style={[styles.avatar, { backgroundColor: getAvatarColor(item.name) }]}>
              <Text style={styles.avatarText}>{getInitials(item.name)}</Text>
            </View>
            <View style={styles.info}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.email}>{item.email}</Text>
            </View>
            <View style={[styles.tierBadge, { backgroundColor: TIER_COLORS[item.role] + '1A' }]}>
              <Text style={[styles.tierBadgeText, { color: TIER_COLORS[item.role] }]}>
                {badgeLabel(item)}
              </Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !loading && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No admins or users added yet.</Text>
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
    subtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      paddingHorizontal: 20,
      marginBottom: 12,
    },
    addRow: {
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: 20,
      marginBottom: 12,
    },
    addButton: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: 'center',
    },
    addButtonText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '700',
    },
    list: {
      padding: 20,
      paddingTop: 0,
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
    email: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
    tierBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 10,
    },
    tierBadgeText: {
      fontSize: 11,
      fontWeight: '700',
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

