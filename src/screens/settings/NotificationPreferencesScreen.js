import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import Button from '../../components/Button';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getCompany, updateNotificationPreferences } from '../../services/companyService';

const DEFAULT_PREFS = { notify_late: true, notify_absent: true, notify_employee_limit: true };

const OPTIONS = [
  {
    key: 'notify_employee_limit',
    label: 'Employee Limit Warning',
    desc: "Shows a banner when you're approaching the 20-employee free-plan limit. Active now.",
  },
  {
    key: 'notify_late',
    label: 'Late Arrival Alerts',
    desc: 'Saved for when push/email delivery is set up — not yet sent anywhere.',
  },
  {
    key: 'notify_absent',
    label: 'Absentee Alerts',
    desc: 'Saved for when push/email delivery is set up — not yet sent anywhere.',
  },
];

export default function NotificationPreferencesScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { userData } = useAuth();
  const companyId = userData?.company_id;
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const data = await getCompany(companyId);
      setPrefs({ ...DEFAULT_PREFS, ...(data?.notification_preferences ?? {}) });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not load preferences', text2: error.message });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function toggle(key) {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateNotificationPreferences(companyId, prefs);
      Toast.show({ type: 'success', text1: 'Preferences saved' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not save preferences', text2: error.message });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Notification Preferences</Text>
        <View style={{ width: 40 }} />
      </View>

      {OPTIONS.map((option) => (
        <View key={option.key} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>{option.label}</Text>
            <Text style={styles.rowDesc}>{option.desc}</Text>
          </View>
          <Switch
            value={Boolean(prefs[option.key])}
            onValueChange={() => toggle(option.key)}
            trackColor={{ true: colors.accent }}
          />
        </View>
      ))}

      <Button title="Save Preferences" onPress={handleSave} loading={saving} />
    </ScrollView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 20,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    loadingText: {
      color: colors.textSecondary,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 20,
    },
    backText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '600',
    },
    title: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.textPrimary,
      flexShrink: 1,
      textAlign: 'center',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: 10,
      padding: 14,
      marginBottom: 12,
    },
    rowText: {
      flex: 1,
      marginRight: 12,
    },
    rowLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    rowDesc: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
  });
}

