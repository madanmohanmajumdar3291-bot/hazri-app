import React, { useCallback, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, Sora_600SemiBold, Sora_700Bold } from '@expo-google-fonts/sora';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import Toast from 'react-native-toast-message';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import RootNavigator from './src/navigation/RootNavigator';

// Defines the Google Drive backup background task at module scope — this
// has to run on every app launch (including ones the OS triggers in the
// background) for the task to be findable when it fires. Wrapped in
// try/catch (a plain `import` can't be) because this pulls in native
// modules (expo-background-task, expo-secure-store) that don't exist in
// every installed build yet — on a build compiled before they were added,
// this would otherwise throw at module-evaluation time and crash the
// entire app before it even renders anything.
try {
  require('./src/services/backupBackgroundTask');
} catch (_error) {
  // Google Drive backup feature unavailable on this build — everything
  // else in the app still works normally.
}

// Registered at module scope (not inside a component) so it captures the
// hazri://oauthredirect callback from Google sign-in no matter which screen
// — or lack of one — is mounted when Android relaunches the app's JS
// process after killing it mid-sign-in. See the big comment above
// PENDING_CODE_VERIFIER_KEY in googleDriveService.js for why this exists.
try {
  require('./src/services/googleDriveService').registerGoogleAuthRedirectListener();
} catch (_error) {
  // Google Drive backup feature unavailable on this build.
}

// Keep the native splash up until Sora/Inter are ready — the whole design
// system depends on these two typefaces, so a flash of the system font
// would undercut the "register book, not generic SaaS" feel from the start.
SplashScreen.preventAutoHideAsync().catch(() => {});

function AppContent() {
  const { scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <RootNavigator />
      <Toast />
    </>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Sora_600SemiBold,
    Sora_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  useEffect(() => {
    onLayoutRootView();
  }, [onLayoutRootView]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

