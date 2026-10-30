import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';

// Plain React Native Views can't blur what's behind them — there's no
// backdrop-filter here — so a translucent "glass" card over a flat
// background just reads as a slightly lighter flat box. This fakes the
// ambient light a real glass surface would pick up: two clusters of
// solid-color circles, each ring bigger and fainter than the last, sitting
// behind the screen's content. Purely decorative, never touches layout.
function withAlpha(hex, alphaHex) {
  return `${hex}${alphaHex}`;
}

export default function AmbientGlow() {
  const { colors } = useTheme();
  const amber = colors.accent;
  const teal = colors.success;

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <View style={[styles.circle, { width: 340, height: 340, top: -160, left: -140, backgroundColor: withAlpha(amber, '0D') }]} />
      <View style={[styles.circle, { width: 260, height: 260, top: -120, left: -100, backgroundColor: withAlpha(amber, '0F') }]} />
      <View style={[styles.circle, { width: 180, height: 180, top: -80, left: -60, backgroundColor: withAlpha(amber, '12') }]} />
      <View style={[styles.circle, { width: 320, height: 320, bottom: -150, right: -140, backgroundColor: withAlpha(teal, '0D') }]} />
      <View style={[styles.circle, { width: 240, height: 240, bottom: -110, right: -100, backgroundColor: withAlpha(teal, '0F') }]} />
      <View style={[styles.circle, { width: 160, height: 160, bottom: -70, right: -60, backgroundColor: withAlpha(teal, '12') }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    position: 'absolute',
    borderRadius: 999,
  },
});
