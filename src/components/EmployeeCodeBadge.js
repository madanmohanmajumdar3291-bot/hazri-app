import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';

// The auto-assigned employee code (e.g. MYB0001) as its own small pill —
// pine-green tinted, distinct from every other colored badge on a card.
export default function EmployeeCodeBadge({ code }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!code) return null;

  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{code}</Text>
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    badge: {
      backgroundColor: colors.brand + '22',
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    text: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 10,
      fontWeight: '700',
      color: colors.brand,
      letterSpacing: 0.5,
    },
  });
}
