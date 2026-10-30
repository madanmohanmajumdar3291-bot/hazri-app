import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// A tinted pill for a branch or department name, colored via
// colorForIndex()/colorForId() from designTokens.js since neither has a
// stored color of its own.
export default function ColorBadge({ label, color }) {
  if (!label) return null;
  return (
    <View style={[styles.badge, { backgroundColor: color + '22' }]}>
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  text: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    fontWeight: '600',
  },
});
