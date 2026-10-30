import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { SERIF_FONT } from '../constants/designTokens';

// Big number + label, used across dashboards. Numbers use tabular figures
// (Inter) so counts line up when several StatCards sit in a row.
export default function StatCard({ label, value, colorKey = 'accent', softKey = 'accentSoft', onPress }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const color = colors[colorKey] ?? colors.accent;
  const soft = colors[softKey] ?? colors.accentSoft;
  const Wrapper = onPress ? TouchableOpacity : View;

  return (
    <Wrapper style={[styles.card, { backgroundColor: soft }]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.value, { color }]}>{value}</Text>
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Wrapper>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    card: {
      flex: 1,
      borderRadius: colors.radiusMd,
      paddingVertical: 14,
      paddingHorizontal: 12,
      alignItems: 'center',
    },
    value: {
      fontFamily: SERIF_FONT,
      fontWeight: '700',
      fontSize: 26,
      lineHeight: 30,
    },
    label: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 12,
      marginTop: 4,
      textAlign: 'center',
    },
  });
}

