import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { COLORS } from '../../constants/colors';

const SERIF_FONT = Platform.OS === 'ios' ? 'Georgia' : 'serif';

export default function SplashScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.logo}>Hazri</Text>
      <Text style={styles.subtitle}>Attendance, simplified.</Text>
      <ActivityIndicator color={COLORS.white} style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    fontSize: 32,
    fontWeight: '700',
    fontFamily: SERIF_FONT,
    color: COLORS.white,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.white,
    marginTop: 8,
    opacity: 0.8,
  },
  spinner: {
    marginTop: 24,
  },
});

