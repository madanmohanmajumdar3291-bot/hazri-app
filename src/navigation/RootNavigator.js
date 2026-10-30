import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import SplashScreen from '../screens/auth/SplashScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import SignupScreen from '../screens/auth/SignupScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import ResetPasswordScreen from '../screens/auth/ResetPasswordScreen';
import FaceSetupScreen from '../screens/auth/FaceSetupScreen';
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import HomeScreen from '../screens/home/HomeScreen';
import HelpScreen from '../screens/help/HelpScreen';
import MenuUnlockScreen from '../screens/menu/MenuUnlockScreen';
import MenuScreen from '../screens/menu/MenuScreen';
import EmployeesListScreen from '../screens/employees/EmployeesListScreen';
import AddEmployeeScreen from '../screens/employees/AddEmployeeScreen';
import EmployeeDetailScreen from '../screens/employees/EmployeeDetailScreen';
import EmployeeFaceSetupScreen from '../screens/employees/EmployeeFaceSetupScreen';
import KioskScreen from '../screens/attendance/KioskScreen';
import ManualAttendanceScreen from '../screens/attendance/ManualAttendanceScreen';
import ManagersListScreen from '../screens/managers/ManagersListScreen';
import CreateManagerScreen from '../screens/managers/CreateManagerScreen';
import ManagerDetailScreen from '../screens/managers/ManagerDetailScreen';
import ManagerFaceSetupScreen from '../screens/managers/ManagerFaceSetupScreen';
import AttendanceRecordsScreen from '../screens/attendance/AttendanceRecordsScreen';
import LiveMapScreen from '../screens/attendance/LiveMapScreen';
import SitesListScreen from '../screens/attendance/SitesListScreen';
import DepartmentsListScreen from '../screens/attendance/DepartmentsListScreen';
import MovementTimelineScreen from '../screens/attendance/MovementTimelineScreen';
import LeaveRequestsScreen from '../screens/attendance/LeaveRequestsScreen';
import RequestLeaveScreen from '../screens/attendance/RequestLeaveScreen';
import PayrollApprovalsScreen from '../screens/payroll/PayrollApprovalsScreen';
import FieldSummaryScreen from '../screens/attendance/FieldSummaryScreen';
import EmployeeAttendanceScreen from '../screens/attendance/EmployeeAttendanceScreen';
import ReportsScreen from '../screens/reports/ReportsScreen';
import ShiftListScreen from '../screens/shifts/ShiftListScreen';
import ShiftSetupScreen from '../screens/shifts/ShiftSetupScreen';
import ShiftFormScreen from '../screens/shifts/ShiftFormScreen';
import PayrollScreen from '../screens/payroll/PayrollScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import PartnersListScreen from '../screens/partners/PartnersListScreen';
import CreatePartnerScreen from '../screens/partners/CreatePartnerScreen';
import PartnerDetailScreen from '../screens/partners/PartnerDetailScreen';
import PartnerFaceSetupScreen from '../screens/partners/PartnerFaceSetupScreen';
import SettingsScreen from '../screens/settings/SettingsScreen';
import CompanyProfileScreen from '../screens/settings/CompanyProfileScreen';
import NotificationPreferencesScreen from '../screens/settings/NotificationPreferencesScreen';
import AccountSecurityScreen from '../screens/settings/AccountSecurityScreen';
import { View, Text } from 'react-native';

// GoogleDriveBackupScreen pulls in native modules (expo-auth-session,
// expo-web-browser, expo-secure-store, expo-background-task) that don't
// exist in every installed build yet. A plain `import` is evaluated eagerly
// and can't be wrapped in try/catch, so on a build compiled before these
// were added it would throw here and crash the ENTIRE app before anything
// renders — not just this one screen. `require` inside try/catch contains
// the failure to just this feature instead.
let GoogleDriveBackupScreen;
try {
  GoogleDriveBackupScreen = require('../screens/settings/GoogleDriveBackupScreen').default;
} catch (_error) {
  GoogleDriveBackupScreen = function GoogleDriveBackupUnavailableScreen() {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ textAlign: 'center' }}>
          Google Drive backup isn't available on this version of the app yet. Update the app to use it.
        </Text>
      </View>
    );
  };
}
import { useTheme } from '../context/ThemeContext';
import { SPLASH_DURATION_MS } from '../constants/config';

const Stack = createNativeStackNavigator();

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="OwnerLogin" component={LoginScreen} />
      <Stack.Screen name="OwnerSignup" component={SignupScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </Stack.Navigator>
  );
}

function AppStack({ initialRouteName }) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={initialRouteName}>
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
      <Stack.Screen name="Help" component={HelpScreen} />
      <Stack.Screen name="FaceSetup" component={FaceSetupScreen} />
      <Stack.Screen name="ShiftSetup" component={ShiftSetupScreen} />
      <Stack.Screen name="MenuUnlock" component={MenuUnlockScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <Stack.Screen name="Menu" component={MenuScreen} />
      <Stack.Screen name="EmployeesList" component={EmployeesListScreen} />
      <Stack.Screen name="AddEmployee" component={AddEmployeeScreen} />
      <Stack.Screen name="EmployeeDetail" component={EmployeeDetailScreen} />
      <Stack.Screen name="EmployeeFaceSetup" component={EmployeeFaceSetupScreen} />
      <Stack.Screen name="KioskMode" component={KioskScreen} />
      <Stack.Screen name="ManualAttendance" component={ManualAttendanceScreen} />
      <Stack.Screen name="ManagersList" component={ManagersListScreen} />
      <Stack.Screen name="CreateManager" component={CreateManagerScreen} />
      <Stack.Screen name="ManagerDetail" component={ManagerDetailScreen} />
      <Stack.Screen name="ManagerFaceSetup" component={ManagerFaceSetupScreen} />
      <Stack.Screen name="AttendanceRecords" component={AttendanceRecordsScreen} />
      <Stack.Screen name="LiveMap" component={LiveMapScreen} />
      <Stack.Screen name="SitesList" component={SitesListScreen} />
      <Stack.Screen name="DepartmentsList" component={DepartmentsListScreen} />
      <Stack.Screen name="MovementTimeline" component={MovementTimelineScreen} />
      <Stack.Screen name="LeaveRequests" component={LeaveRequestsScreen} />
      <Stack.Screen name="RequestLeave" component={RequestLeaveScreen} />
      <Stack.Screen name="PayrollApprovals" component={PayrollApprovalsScreen} />
      <Stack.Screen name="FieldSummary" component={FieldSummaryScreen} />
      <Stack.Screen name="EmployeeAttendance" component={EmployeeAttendanceScreen} />
      <Stack.Screen name="Reports" component={ReportsScreen} />
      <Stack.Screen name="ShiftList" component={ShiftListScreen} />
      <Stack.Screen name="ShiftForm" component={ShiftFormScreen} />
      <Stack.Screen name="Payroll" component={PayrollScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="PartnersList" component={PartnersListScreen} />
      <Stack.Screen name="CreatePartner" component={CreatePartnerScreen} />
      <Stack.Screen name="PartnerDetail" component={PartnerDetailScreen} />
      <Stack.Screen name="PartnerFaceSetup" component={PartnerFaceSetupScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="CompanyProfile" component={CompanyProfileScreen} />
      <Stack.Screen name="NotificationPreferences" component={NotificationPreferencesScreen} />
      <Stack.Screen name="AccountSecurity" component={AccountSecurityScreen} />
      <Stack.Screen name="GoogleDriveBackup" component={GoogleDriveBackupScreen} />
    </Stack.Navigator>
  );
}

export default function RootNavigator() {
  const { firebaseUser, initializing, pendingFaceSetup, passwordRecovery } = useAuth();
  const { colors, scheme } = useTheme();
  const [showSplash, setShowSplash] = useState(true);

  const navigationTheme = {
    dark: scheme === 'dark',
    colors: {
      primary: colors.accent,
      background: colors.background,
      card: colors.card,
      text: colors.textPrimary,
      border: colors.border,
      notification: colors.error,
    },
    fonts: {
      regular: { fontFamily: 'System', fontWeight: '400' },
      medium: { fontFamily: 'System', fontWeight: '500' },
      bold: { fontFamily: 'System', fontWeight: '700' },
      heavy: { fontFamily: 'System', fontWeight: '900' },
    },
  };

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), SPLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  if (initializing || showSplash) {
    return <SplashScreen />;
  }

  // A password-reset link signs the user into a temporary recovery session —
  // route straight to the reset screen instead of the normal app/login split.
  if (passwordRecovery) {
    return (
      <NavigationContainer theme={navigationTheme}>
        <ResetPasswordScreen />
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      {firebaseUser ? (
        <AppStack initialRouteName={pendingFaceSetup ? 'FaceSetup' : 'Home'} />
      ) : (
        <AuthStack />
      )}
    </NavigationContainer>
  );
}

