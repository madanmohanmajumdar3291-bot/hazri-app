import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

// Color is never the only signal — every pill pairs its color with an icon
// AND a text label, since this audience may not parse subtle color
// differences quickly, especially at a glance in shop lighting.
const STATUS_CONFIG = {
  present: { icon: 'check', colorKey: 'success', softKey: 'successSoft', label: 'Present' },
  'checked-in': { icon: 'check', colorKey: 'success', softKey: 'successSoft', label: 'Present' },
  late: { icon: 'clock-alert-outline', colorKey: 'warning', softKey: 'warningSoft', label: 'Late' },
  absent: { icon: 'close', colorKey: 'error', softKey: 'errorSoft', label: 'Absent' },
  pending: { icon: 'dots-horizontal', colorKey: 'textSecondary', softKey: 'border', label: 'Pending' },
  approved: { icon: 'check', colorKey: 'success', softKey: 'successSoft', label: 'Approved' },
  rejected: { icon: 'close', colorKey: 'error', softKey: 'errorSoft', label: 'Rejected' },
  // Checked in but never checked out — deliberately distinct from absent
  // (they clearly showed up) and from present (the record is incomplete).
  single_punch: { icon: 'gesture-tap', colorKey: 'singlePunch', softKey: 'singlePunchSoft', label: 'Single Punch' },
  leave: { icon: 'palm-tree', colorKey: 'accent', softKey: 'accentSoft', label: 'On Leave' },
  checked_out: { icon: 'logout', colorKey: 'info', softKey: 'infoSoft', label: 'Checked Out' },
};

export default function StatusPill({ status, label }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const color = colors[config.colorKey] ?? colors.textSecondary;
  const soft = colors[config.softKey] ?? colors.border;

  return (
    <View style={[styles.pill, { backgroundColor: soft }]}>
      <MaterialCommunityIcons name={config.icon} size={13} color={color} />
      <Text style={[styles.label, { color }]}>{label ?? config.label}</Text>
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: colors.radiusPill,
      alignSelf: 'flex-start',
    },
    label: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 12,
    },
  });
}

