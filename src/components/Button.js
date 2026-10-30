import React, { useMemo } from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../context/ThemeContext';

// Full-width, 56px, pill radius, brand color — this is AttendEye's
// `PrimaryButton` primitive. Kept as the app's single shared Button
// component (rather than a separate unused primitive) so every existing
// screen picks up the design system at once.
export default function Button({ title, onPress, loading, disabled, variant = 'primary' }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isOutline = variant === 'outline';

  return (
    <TouchableOpacity
      style={[
        styles.button,
        isOutline ? styles.outlineButton : styles.solidButton,
        (disabled || loading) && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={isOutline ? colors.accent : colors.white} />
      ) : (
        <Text style={isOutline ? styles.outlineText : styles.solidText}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    button: {
      width: '100%',
      minHeight: 56,
      borderRadius: colors.radiusPill,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      marginTop: 8,
    },
    solidButton: {
      backgroundColor: colors.accent,
    },
    outlineButton: {
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: colors.accent,
    },
    disabled: {
      opacity: 0.5,
    },
    solidText: {
      color: colors.white,
      fontSize: 16,
      fontFamily: 'Inter_600SemiBold',
    },
    outlineText: {
      color: colors.accent,
      fontSize: 16,
      fontFamily: 'Inter_600SemiBold',
    },
  });
}

