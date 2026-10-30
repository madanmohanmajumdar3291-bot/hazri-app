import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../constants/colors';

export default function OfflineBanner({ visible, pendingCount, lastSyncedAt }) {
  if (!visible) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>Working offline — data will sync when connected</Text>
      {pendingCount > 0 ? (
        <Text style={styles.subText}>{pendingCount} record(s) pending sync</Text>
      ) : null}
      {lastSyncedAt ? (
        <Text style={styles.subText}>
          Last synced: {new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#FFF3CD',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  text: {
    color: '#856404',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  subText: {
    color: '#856404',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
  },
});

