import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { manualBadgeCode } from '../utils/attendanceStatus';

// Small ME/ML/MA tag next to a status pill, shown only for hand-entered
// attendance (never for a face scan) — so it's always visible which records
// came from someone typing them in versus the camera.
// variant="checkout" renders "MO" (Manual Out) — shown when the check-out
// time was typed in by an admin rather than captured by a face scan.
export default function ManualBadge({ status, variant }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isCheckout = variant === 'checkout';
  const colorKey = isCheckout ? 'info' : status === 'leave' ? 'accent' : status === 'absent' ? 'error' : 'info';
  const color = colors[colorKey];

  return (
    <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color + '44' }]}>
      <Text style={[styles.text, { color }]}>{isCheckout ? 'MO' : manualBadgeCode(status)}</Text>
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    badge: {
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    text: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 10,
      fontWeight: '700',
    },
  });
}

