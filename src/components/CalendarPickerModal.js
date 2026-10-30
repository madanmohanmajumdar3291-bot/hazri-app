import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Pure-JS month-grid calendar — no native date-picker module, so it ships
// instantly over the air instead of needing another app rebuild the way a
// native picker would.
export default function CalendarPickerModal({ visible, value, onSelect, onClose, maxDate }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [viewDate, setViewDate] = useState(value || new Date());

  useEffect(() => {
    if (visible) setViewDate(value || new Date());
  }, [visible, value]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const weeks = useMemo(() => {
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = firstOfMonth.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);

    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [year, month]);

  function changeMonth(offset) {
    setViewDate(new Date(year, month + offset, 1));
  }

  const today = new Date();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.navButton} hitSlop={8}>
              <MaterialCommunityIcons name="chevron-left" size={24} color={colors.accent} />
            </TouchableOpacity>
            <Text style={styles.headerText}>
              {MONTH_LABELS[month]} {year}
            </Text>
            <TouchableOpacity onPress={() => changeMonth(1)} style={styles.navButton} hitSlop={8}>
              <MaterialCommunityIcons name="chevron-right" size={24} color={colors.accent} />
            </TouchableOpacity>
          </View>

          <View style={styles.weekdayRow}>
            {WEEKDAY_LABELS.map((label, index) => (
              <Text key={`${label}-${index}`} style={styles.weekdayText}>
                {label}
              </Text>
            ))}
          </View>

          {weeks.map((week, weekIndex) => (
            <View key={weekIndex} style={styles.weekRow}>
              {week.map((cellDate, dayIndex) => {
                if (!cellDate) return <View key={dayIndex} style={styles.dayCell} />;
                const isSelected = value && sameDay(cellDate, value);
                const isToday = sameDay(cellDate, today);
                const isFuture = maxDate ? cellDate > maxDate : false;
                return (
                  <TouchableOpacity
                    key={dayIndex}
                    style={styles.dayCell}
                    disabled={isFuture}
                    onPress={() => {
                      onSelect(cellDate);
                      onClose();
                    }}
                  >
                    <View style={[styles.dayCircle, isSelected && styles.dayCircleSelected]}>
                      <Text
                        style={[
                          styles.dayText,
                          isToday && !isSelected && styles.dayTextToday,
                          isSelected && styles.dayTextSelected,
                          isFuture && styles.dayTextDisabled,
                        ]}
                      >
                        {cellDate.getDate()}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          <TouchableOpacity style={styles.todayButton} onPress={() => { onSelect(new Date()); onClose(); }}>
            <Text style={styles.todayButtonText}>Today</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    navButton: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerText: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    weekdayRow: {
      flexDirection: 'row',
      marginBottom: 4,
    },
    weekdayText: {
      flex: 1,
      textAlign: 'center',
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    weekRow: {
      flexDirection: 'row',
    },
    dayCell: {
      flex: 1,
      aspectRatio: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayCircle: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayCircleSelected: {
      backgroundColor: colors.accent,
    },
    dayText: {
      fontSize: 14,
      color: colors.textPrimary,
    },
    dayTextToday: {
      color: colors.accent,
      fontWeight: '700',
    },
    dayTextSelected: {
      color: colors.white,
      fontWeight: '700',
    },
    dayTextDisabled: {
      color: colors.textSecondary,
      opacity: 0.4,
    },
    todayButton: {
      marginTop: 8,
      alignSelf: 'center',
      paddingVertical: 8,
      paddingHorizontal: 16,
    },
    todayButtonText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '600',
    },
  });
}
