import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

export default function Input({
  label,
  value,
  onChangeText,
  onBlur,
  error,
  secureTextEntry,
  keyboardType,
  autoCapitalize = 'none',
  placeholder,
  multiline,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Every password-type field gets a show/hide toggle so the admin can
  // check what they actually typed before submitting, instead of guessing.
  const [revealed, setRevealed] = useState(false);
  const isPasswordField = Boolean(secureTextEntry);

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.inputWrap}>
        <TextInput
          style={[
            styles.input,
            isPasswordField && styles.inputWithIcon,
            multiline && styles.multiline,
            error && styles.inputError,
          ]}
          value={value}
          onChangeText={onChangeText}
          onBlur={onBlur}
          secureTextEntry={isPasswordField && !revealed}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          multiline={multiline}
        />
        {isPasswordField ? (
          <TouchableOpacity
            style={styles.revealButton}
            onPress={() => setRevealed((prev) => !prev)}
            hitSlop={10}
          >
            <MaterialCommunityIcons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        ) : null}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: {
      width: '100%',
      marginBottom: 14,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 6,
    },
    inputWrap: {
      justifyContent: 'center',
    },
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      fontSize: 16,
      color: colors.textPrimary,
      backgroundColor: colors.card,
    },
    inputWithIcon: {
      paddingRight: 44,
    },
    revealButton: {
      position: 'absolute',
      right: 12,
      height: 48,
      justifyContent: 'center',
    },
    multiline: {
      minHeight: 80,
      textAlignVertical: 'top',
      paddingTop: 12,
    },
    inputError: {
      borderColor: colors.error,
    },
    errorText: {
      color: colors.error,
      fontSize: 12,
      marginTop: 4,
    },
  });
}

