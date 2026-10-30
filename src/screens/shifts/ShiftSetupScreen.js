import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { createDefaultShift } from '../../services/shiftService';

// Shown once, right after face setup, for every brand-new company — a
// General Shift has to exist before attendance can compute on-time/late.
export default function ShiftSetupScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { userData } = useAuth();
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [lateGrace, setLateGrace] = useState('5');
  const [earlyGrace, setEarlyGrace] = useState('5');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

  async function handleSave() {
    if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
      setError('Enter times as HH:MM in 24-hour format, e.g. 09:00');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await createDefaultShift(userData.company_id, {
        start_time: startTime,
        end_time: endTime,
        late_grace_minutes: parseInt(lateGrace, 10) || 0,
        early_departure_grace_minutes: parseInt(earlyGrace, 10) || 0,
      });
      navigation.replace('Home');
    } catch (e) {
      setError(e.message || 'Could not save shift. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Set Up Your Shift</Text>
      <Text style={styles.subtitle}>
        This is your company's default working hours. You can add more shifts or edit this one
        anytime from Shift Master.
      </Text>

      <View style={styles.row}>
        <View style={styles.half}>
          <Input label="Shift Start (In-Time)" value={startTime} onChangeText={setStartTime} placeholder="09:00" />
        </View>
        <View style={styles.half}>
          <Input label="Shift End" value={endTime} onChangeText={setEndTime} placeholder="17:00" />
        </View>
      </View>

      <View style={styles.row}>
        <View style={styles.half}>
          <Input
            label="Late Arrival Grace (minutes)"
            value={lateGrace}
            onChangeText={(v) => setLateGrace(v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="5"
          />
        </View>
        <View style={styles.half}>
          <Input
            label="Early Departure Grace (minutes)"
            value={earlyGrace}
            onChangeText={(v) => setEarlyGrace(v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="5"
          />
        </View>
      </View>

      <Text style={styles.helpText}>
        With these defaults: arriving after 9:05 AM counts as late, and leaving before 4:55 PM
        counts as an early departure.
      </Text>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Button title="Save & Continue" onPress={handleSave} loading={saving} />
    </ScrollView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: {
      flexGrow: 1,
      padding: 24,
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    title: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      marginBottom: 24,
    },
    row: {
      flexDirection: 'row',
      gap: 10,
    },
    half: {
      flex: 1,
    },
    helpText: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 20,
      fontStyle: 'italic',
    },
    errorText: {
      color: colors.error,
      fontSize: 14,
      marginBottom: 8,
      textAlign: 'center',
    },
  });
}

