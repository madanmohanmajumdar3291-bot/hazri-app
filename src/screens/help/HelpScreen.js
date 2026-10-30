import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

const FAQS = [
  {
    q: 'How do I mark an employee\'s attendance?',
    a: 'Just have them look at the camera on the home screen — it scans and marks attendance automatically, no tap needed. You can also use Menu > Manual Attendance to mark it by hand.',
  },
  {
    q: 'The camera says "access missing" — what do I do?',
    a: 'Tap it once to be asked for camera permission, then allow access. If you already denied it, enable camera access for this app from your device Settings.',
  },
  {
    q: 'How do I add a new employee?',
    a: 'Tap "+ Add Employee" on the home screen, or go to Menu > Add Employee. Each employee needs their face registered afterward before Kiosk Mode can recognize them.',
  },
  {
    q: 'Why can\'t I open the Menu?',
    a: 'The Menu is protected by a face scan for security — look at the camera and blink naturally to confirm it\'s really you. If it keeps failing, use "Enter password" instead.',
  },
  {
    q: 'What\'s the difference between an Admin and a User?',
    a: 'An Admin has full access, same as the owner. A User can only view data and mark attendance (manually or via Kiosk Mode) — they can\'t add employees or change settings.',
  },
  {
    q: 'I hit the free-plan employee/admin/user limit — what now?',
    a: 'The free plan caps how many employees, admins, and users you can add. Upgrading unlocks more — reach out for details on upgrading your plan.',
  },
];

export default function HelpScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Help & FAQ</Text>
        <View style={{ width: 40 }} />
      </View>

      {FAQS.map((item) => (
        <View key={item.q} style={styles.card}>
          <Text style={styles.question}>{item.q}</Text>
          <Text style={styles.answer}>{item.a}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 20,
      paddingBottom: 40,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    backText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '600',
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
    },
    question: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 6,
    },
    answer: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 19,
    },
  });
}

