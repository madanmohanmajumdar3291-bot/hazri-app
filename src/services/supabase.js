import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { secureSessionStorage } from './secureStorage';
import { fetchWithTimeout } from './http';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureSessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Needed on web so clicking the password-reset email link (which lands
    // back on this app with a recovery token in the URL) actually creates a
    // session; native has no equivalent deep-link handling set up yet.
    detectSessionInUrl: Platform.OS === 'web',
  },
  global: { fetch: fetchWithTimeout },
});

// Supabase's documented requirement for React Native: refresh timers do not
// run while the app is in the background, so restart them on foreground.
// Without this an expired access token is used after a long background
// period until a request happens to trigger a refresh.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
