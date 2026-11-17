import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { reportError } from '../services/errorReporting';

// Last line of defence against a render error. Before v1.1.0 any exception
// while rendering left a blank white screen until the app was force-closed.
// Colors are fixed (not from ThemeContext) because the theme provider may be
// what failed.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportError(error, { isFatal: true, context: { componentStack: info?.componentStack?.slice(0, 1500) } });
  }

  async handleRetry() {
    try {
      const Updates = require('expo-updates');
      if (Updates?.reloadAsync && !__DEV__) {
        await Updates.reloadAsync();
        return;
      }
    } catch (_e) {
      // fall back to re-rendering
    }
    this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          Hazri hit an unexpected error. Your attendance records are saved on this phone and will sync. Tap below to
          restart the app.
        </Text>
        <TouchableOpacity style={styles.button} onPress={this.handleRetry} accessibilityRole="button">
          <Text style={styles.buttonText}>Restart Hazri</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#F3EEE3' },
  title: { fontSize: 20, fontWeight: '700', color: '#1B4B43', marginBottom: 12, textAlign: 'center' },
  body: { fontSize: 15, color: '#3A3A3A', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  button: { backgroundColor: '#B87A1E', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
