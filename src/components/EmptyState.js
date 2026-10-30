import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import Button from './Button';

// Text-first, no illustration dependency — this is a work tool, tone stays
// efficient, not cutesy. Icon is optional and always plain-line, never a
// mascot.
export default function EmptyState({ icon, title, description, actionLabel, onAction }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      {icon ? <MaterialCommunityIcons name={icon} size={32} color={colors.textSecondary} style={styles.icon} /> : null}
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {actionLabel ? (
        <View style={styles.actionWrap}>
          <Button title={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: {
      alignItems: 'center',
      paddingVertical: 40,
      paddingHorizontal: 32,
    },
    icon: {
      marginBottom: 10,
    },
    title: {
      fontFamily: 'Sora_600SemiBold',
      fontSize: 16,
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: 4,
    },
    description: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    actionWrap: {
      width: '100%',
      marginTop: 20,
    },
  });
}

