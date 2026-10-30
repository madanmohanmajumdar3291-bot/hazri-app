import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIGHT_COLORS, DARK_COLORS } from '../constants/colors';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'themePreference'; // 'light' | 'dark' | 'system'

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState('system');
  const [systemScheme, setSystemScheme] = useState(Appearance.getColorScheme() ?? 'light');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') setPreference(saved);
    });

    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme ?? 'light');
    });
    return () => subscription.remove();
  }, []);

  function setThemePreference(next) {
    setPreference(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }

  const effectiveScheme = preference === 'system' ? systemScheme : preference;
  const colors = effectiveScheme === 'dark' ? DARK_COLORS : LIGHT_COLORS;

  const value = useMemo(
    () => ({
      colors,
      scheme: effectiveScheme,
      preference,
      setThemePreference,
    }),
    [colors, effectiveScheme, preference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

