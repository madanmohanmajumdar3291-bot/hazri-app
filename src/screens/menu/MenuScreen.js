import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getEmployeeCount, FREE_EMPLOYEE_LIMIT } from '../../services/employeeService';
import EmptyState from '../../components/EmptyState';
import AmbientGlow from '../../components/AmbientGlow';

// One consistent icon + accent treatment for every row, grouped into
// sections — a single reused navigation pattern (icon chip, label,
// description, chevron) instead of a grid of randomly-colored tiles.
const MENU_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', desc: 'Today\'s attendance at a glance', emoji: '📊', section: 'Overview', active: true },
  { key: 'add-employee', label: 'Add Employee', desc: 'Register a new team member', emoji: '🆕', section: 'People', active: true, permission: 'can_add_employees' },
  { key: 'view-employees', label: 'Employees', desc: 'View and manage your team', emoji: '👥', section: 'People', active: true },
  { key: 'managers', label: 'Users', desc: 'Manage user accounts', emoji: '🧑‍💼', section: 'People', active: true },
  { key: 'departments', label: 'Departments', desc: 'Organize employees by department', emoji: '🏢', section: 'People', active: true, ownerOnly: true },
  { key: 'kiosk-mode', label: 'Kiosk Mode', desc: 'Face-scan attendance station', emoji: '📷', section: 'Attendance', active: true },
  { key: 'manual-attendance', label: 'Manual Attendance', desc: 'Mark attendance by hand', emoji: '🕐', section: 'Attendance', active: true, permission: 'can_manual_mark' },
  { key: 'attendance-records', label: 'Attendance Records', desc: 'Browse past records', emoji: '📅', section: 'Attendance', active: true, permission: 'can_view_attendance' },
  { key: 'live-map', label: 'Live Map', desc: 'See where your team is right now', emoji: '🗺️', section: 'Attendance', active: true, permission: 'can_view_attendance' },
  { key: 'sites', label: 'Branches & Geofences', desc: 'Manage approved check-in locations', emoji: '📍', section: 'Attendance', active: true, ownerOnly: true },
  { key: 'leave-requests', label: 'Leave Requests', desc: 'Review and approve leave', emoji: '🌴', section: 'Attendance', active: true, permission: 'can_view_attendance' },
  { key: 'field-summary', label: 'Field Summary', desc: "Today's route and distance per field employee", emoji: '🧭', section: 'Attendance', active: true, permission: 'can_view_attendance' },
  { key: 'shift-master', label: 'Shift Master', desc: 'Configure work shifts', emoji: '⏰', section: 'Attendance', active: true, ownerOnly: true },
  { key: 'payroll', label: 'Payroll & Salary', desc: 'Generate monthly payroll', emoji: '💰', section: 'Business', active: true, ownerOnly: true },
  { key: 'payroll-approvals', label: 'Payroll Approvals', desc: 'Approve and mark payroll paid', emoji: '✅', section: 'Business', active: true, ownerOnly: true },
  { key: 'reports', label: 'Reports', desc: 'Export PDF / Excel reports', emoji: '📝', section: 'Business', active: true, permission: 'can_view_attendance' },
  { key: 'profile', label: 'Profile', desc: 'Your account details', emoji: '👤', section: 'Account', active: true },
  { key: 'settings', label: 'Settings', desc: 'Company, security, and more', emoji: '⚙️', section: 'Account', active: true },
];

// A manager is just an employee with a designation — they can ONLY ever
// reach Add Employee and Manual Attendance, full stop.
const MANAGER_ALLOWED_KEYS = ['dashboard', 'add-employee', 'manual-attendance'];

// Admin (partner_edit) = full second-owner access, everything the owner can
// do, EXCEPT managing who else has Admin/User access (only the literal
// owner controls that — see create-partner/delete-partner edge functions).
// 'settings' opens a hub (Company Profile, Notifications, Data Export,
// Account Security, and — owner only — Admin & User Access). The hub itself
// gates that tile to the literal owner; an Admin can reach everything else
// in Settings, just not manage other Admins/Users.
const PARTNER_EDIT_ALLOWED_KEYS = [
  'dashboard',
  'add-employee',
  'view-employees',
  'kiosk-mode',
  'manual-attendance',
  'attendance-records',
  'live-map',
  'sites',
  'leave-requests',
  'field-summary',
  'managers',
  'departments',
  'shift-master',
  'payroll',
  'payroll-approvals',
  'reports',
  'settings',
];

// User (partner_view) = view-only, plus attendance marking — both manual
// entry and Kiosk Mode's face-scan flow. Can look at data and mark
// attendance either way, but can't add employees or touch shift/manager
// configuration.
const PARTNER_VIEW_ALLOWED_KEYS = [
  'dashboard',
  'add-employee',
  'view-employees',
  'kiosk-mode',
  'manual-attendance',
  'attendance-records',
  'live-map',
  'leave-requests',
  'field-summary',
  'reports',
  'profile',
];

export default function MenuScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { userData } = useAuth();
  const role = userData?.role;
  const isManager = role === 'manager';
  const isOwner = role === 'owner';

  const visibleItems = MENU_ITEMS.filter((item) => {
    // Owner/Admin get their profile info folded into Settings instead of a
    // separate menu entry — Manager/User have no Settings access at all,
    // so they still need Profile as its own item.
    if (item.key === 'profile' && (isOwner || role === 'partner_edit')) return false;

    if (isOwner) return true;

    if (isManager) {
      if (!MANAGER_ALLOWED_KEYS.includes(item.key)) return false;
      if (!item.permission) return true;
      return Boolean(userData?.permissions?.[item.permission]);
    }

    if (role === 'partner_edit') return PARTNER_EDIT_ALLOWED_KEYS.includes(item.key);
    if (role === 'partner_view') return PARTNER_VIEW_ALLOWED_KEYS.includes(item.key);

    return false;
  });

  const sections = [];
  for (const item of visibleItems) {
    let section = sections.find((s) => s.title === item.section);
    if (!section) {
      section = { title: item.section, items: [] };
      sections.push(section);
    }
    section.items.push(item);
  }

  async function handleAddEmployee() {
    try {
      const count = await getEmployeeCount(userData.company_id);
      if (count >= FREE_EMPLOYEE_LIMIT) {
        navigation.navigate('EmployeesList');
        return;
      }
      navigation.navigate('AddEmployee');
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not check employee limit', text2: error.message });
    }
  }

  function handlePress(item) {
    if (item.key === 'dashboard') {
      navigation.navigate('Dashboard');
    } else if (item.key === 'add-employee') {
      handleAddEmployee();
    } else if (item.key === 'view-employees') {
      navigation.navigate('EmployeesList');
    } else if (item.key === 'kiosk-mode') {
      navigation.navigate('KioskMode');
    } else if (item.key === 'manual-attendance') {
      navigation.navigate('ManualAttendance');
    } else if (item.key === 'managers') {
      navigation.navigate('ManagersList');
    } else if (item.key === 'attendance-records') {
      navigation.navigate('AttendanceRecords');
    } else if (item.key === 'live-map') {
      navigation.navigate('LiveMap');
    } else if (item.key === 'sites') {
      navigation.navigate('SitesList');
    } else if (item.key === 'departments') {
      navigation.navigate('DepartmentsList');
    } else if (item.key === 'leave-requests') {
      navigation.navigate('LeaveRequests');
    } else if (item.key === 'field-summary') {
      navigation.navigate('FieldSummary');
    } else if (item.key === 'reports') {
      navigation.navigate('Reports');
    } else if (item.key === 'shift-master') {
      navigation.navigate('ShiftList');
    } else if (item.key === 'payroll') {
      navigation.navigate('Payroll');
    } else if (item.key === 'payroll-approvals') {
      navigation.navigate('PayrollApprovals');
    } else if (item.key === 'profile') {
      navigation.navigate('Profile');
    } else if (item.key === 'settings') {
      navigation.navigate('Settings');
    }
  }

  return (
    <View style={styles.container}>
      <AmbientGlow />
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 32 }]}>
        <TouchableOpacity onPress={() => navigation.replace('Home')}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Menu</Text>
        <View style={styles.backSpacer} />
      </View>

      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
        {!role ? (
          <EmptyState
            icon="wifi-off"
            title="Couldn't load your account"
            description="Check your connection and reopen the menu. If this keeps happening, log out and back in."
          />
        ) : null}
        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.items.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[styles.row, !item.active && styles.rowInactive]}
                disabled={!item.active}
                onPress={() => handlePress(item)}
                activeOpacity={0.7}
              >
                <View style={styles.rowIconWrap}>
                  <Text style={styles.rowIconEmoji}>{item.emoji}</Text>
                </View>
                <View style={styles.rowTextWrap}>
                  <Text style={styles.rowLabel}>{item.label}</Text>
                  <Text style={styles.rowDesc}>{item.desc}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 44,
      paddingBottom: 16,
    },
    backText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '600',
    },
    backSpacer: {
      width: 40,
    },
    title: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    list: {
      paddingHorizontal: 20,
      paddingBottom: 24,
    },
    section: {
      marginBottom: 20,
    },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 8,
      marginLeft: 4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: colors.radiusMd,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: 8,
      gap: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rowInactive: {
      opacity: 0.5,
    },
    rowIconWrap: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowIconEmoji: {
      fontSize: 19,
    },
    rowTextWrap: {
      flex: 1,
    },
    rowLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    rowDesc: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 1,
    },
  });
}

