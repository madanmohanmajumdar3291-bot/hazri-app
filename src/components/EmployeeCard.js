import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { colorForId } from '../constants/designTokens';
import EmployeeCodeBadge from './EmployeeCodeBadge';
import ColorBadge from './ColorBadge';

export function getAvatarColor(name) {
  const letter = (name || '?').trim().charAt(0).toUpperCase();
  if (letter >= 'A' && letter <= 'E') return '#6366F1';
  if (letter >= 'F' && letter <= 'J') return '#10B981';
  if (letter >= 'K' && letter <= 'O') return '#EF4444';
  if (letter >= 'P' && letter <= 'T') return '#F59E0B';
  return '#8B5CF6';
}

export function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const initials = parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase());
  return initials.join('') || '?';
}

export default function EmployeeCard({ employee, branchName, branchColor, departmentName, departmentColor, onPress, onLongPress }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const faceColor = colorForId(employee.id) || getAvatarColor(employee.name);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} onLongPress={onLongPress} activeOpacity={0.8}>
      {employee.photo_url ? (
        <Image source={{ uri: employee.photo_url }} style={styles.avatar} />
      ) : employee.face_registered ? (
        <View style={[styles.avatar, styles.faceAvatar, { backgroundColor: faceColor, borderColor: faceColor }]}>
          <MaterialCommunityIcons name="account" size={26} color="rgba(255,255,255,0.9)" />
          <View style={styles.registeredDot} />
        </View>
      ) : (
        <View style={[styles.avatar, { backgroundColor: getAvatarColor(employee.name) }]}>
          <Text style={styles.avatarText}>{getInitials(employee.name)}</Text>
        </View>
      )}

      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{employee.name}</Text>
          <View style={[styles.roleBadge, employee.role === 'manager' && styles.roleBadgeManager]}>
            <Text style={[styles.roleText, employee.role === 'manager' && styles.roleTextManager]}>
              {employee.role === 'manager' ? 'User' : 'Employee'}
            </Text>
          </View>
        </View>
        <Text style={styles.phone}>{employee.phone}</Text>
        <View style={styles.badgeRow}>
          <EmployeeCodeBadge code={employee.employee_code} />
          <ColorBadge label={branchName} color={branchColor} />
          <ColorBadge label={departmentName} color={departmentColor} />
        </View>
      </View>

      <Text style={styles.faceStatus}>{employee.face_registered ? '✅' : '⚠️'}</Text>
    </TouchableOpacity>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: 8,
      padding: 12,
      marginBottom: 10,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: colors.isDark ? 0.25 : 0.08,
      shadowRadius: 3,
      elevation: 2,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    faceAvatar: {
      borderWidth: 2,
    },
    registeredDot: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.success,
      borderWidth: 1.5,
      borderColor: colors.card,
    },
    avatarText: {
      color: colors.white,
      fontWeight: '700',
      fontSize: 15,
    },
    info: {
      flex: 1,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    name: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
      flexShrink: 1,
      marginRight: 8,
    },
    roleBadge: {
      backgroundColor: colors.isDark ? '#2A2D3E' : '#E9ECEF',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
    },
    roleBadgeManager: {
      backgroundColor: colors.accentSoft,
    },
    roleText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    roleTextManager: {
      color: colors.accent,
    },
    phone: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
    badgeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 4,
    },
    faceStatus: {
      fontSize: 18,
      marginLeft: 8,
    },
  });
}

