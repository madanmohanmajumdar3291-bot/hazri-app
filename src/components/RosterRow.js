import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import StatusPill from './StatusPill';
import ManualBadge from './ManualBadge';

// Dot indicator + name + time + status, tappable to detail. The dot is
// filled for present/late/single-punch, hollow for absent — a second,
// non-color signal of state on top of the StatusPill's own icon+label.
export default function RosterRow({ name, timeLabel, status, statusLabel, manual, manualCheckout, onPress }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const dotColor =
    status === 'absent'
      ? colors.error
      : status === 'late'
      ? colors.warning
      : status === 'single_punch'
      ? colors.singlePunch
      : colors.success;
  const isHollow = status === 'absent';

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress}>
      <View
        style={[
          styles.dot,
          { borderColor: dotColor },
          !isHollow && { backgroundColor: dotColor },
        ]}
      />
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        {timeLabel ? <Text style={styles.time}>{timeLabel}</Text> : null}
      </View>
      <View style={styles.badges}>
        {manual ? <ManualBadge status={status} /> : null}
        {manualCheckout ? <ManualBadge variant="checkout" /> : null}
        <StatusPill status={status} label={statusLabel} />
      </View>
    </TouchableOpacity>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: colors.radiusMd,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: 8,
      gap: 12,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      borderWidth: 2,
    },
    info: {
      flex: 1,
    },
    name: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 14,
      color: colors.textPrimary,
    },
    time: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 1,
    },
    badges: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
  });
}

