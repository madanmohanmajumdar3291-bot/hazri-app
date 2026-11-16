/* global jest, describe, test, expect */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('expo-camera', () => ({ CameraView: () => null, useCameraPermissions: () => [{ granted: false }, jest.fn()] }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: () => {} }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('../src/context/ThemeContext', () => ({ useTheme: () => ({ colors: new Proxy({}, { get: () => '#000' }) }) }));
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ userData: { company_id: 'co-1', role: 'owner' } }) }));
jest.mock('../src/hooks/useAttendanceScanner', () => ({ useAttendanceScanner: () => ({}) }));
jest.mock('../src/components/ScanRing', () => () => null);
jest.mock('../src/components/FaceGuide', () => () => null);
jest.mock('../src/components/OfflineBanner', () => () => null);
jest.mock('../src/components/Button', () => {
  const { Text } = require('react-native');
  return ({ title, onPress }) => <Text onPress={onPress}>{title}</Text>;
});

const KioskScreen = require('../src/screens/attendance/KioskScreen').default;

function makeNavigation() {
  const listeners = {};
  return {
    listeners,
    replace: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn((name, fn) => {
      listeners[name] = fn;
      return () => delete listeners[name];
    }),
  };
}

describe('kiosk mode cannot be left without unlocking', () => {
  test('"Back to Menu" goes to the face/password check, not the Menu', () => {
    const navigation = makeNavigation();
    const { getByText } = render(<KioskScreen navigation={navigation} />);
    fireEvent.press(getByText('Back to Menu'));
    expect(navigation.replace).toHaveBeenCalledWith('MenuUnlock', { destination: 'Menu' });
    expect(navigation.replace).not.toHaveBeenCalledWith('Menu');
  });

  test('Android Back / swipe is intercepted and routed to the unlock screen', () => {
    const navigation = makeNavigation();
    render(<KioskScreen navigation={navigation} />);
    const event = { preventDefault: jest.fn() };
    navigation.listeners.beforeRemove(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledWith('MenuUnlock', { destination: 'Menu' });
  });

  test('the unlock hand-off itself is not blocked', () => {
    const navigation = makeNavigation();
    render(<KioskScreen navigation={navigation} />);
    navigation.listeners.beforeRemove({ preventDefault: jest.fn() });
    const second = { preventDefault: jest.fn() };
    navigation.listeners.beforeRemove(second);
    expect(second.preventDefault).not.toHaveBeenCalled();
  });
});

describe('menu entry points that bypassed the lock', () => {
  const fs = require('fs');
  test('Home settings and add-employee go through MenuUnlock', () => {
    const src = fs.readFileSync(require.resolve('../src/screens/home/HomeScreen.js'), 'utf8');
    expect(src).not.toMatch(/navigation\.navigate\(canEditSettings \? 'Settings' : 'Profile'\)/);
    expect(src).toMatch(/navigate\('MenuUnlock', \{ destination: canEditSettings \? 'Settings' : 'Profile' \}\)/);
    expect(src).toMatch(/navigate\('MenuUnlock', \{ destination: 'AddEmployee' \}\)/);
  });
  test('Menu opens the kiosk with a reset so Menu is not underneath it', () => {
    const src = fs.readFileSync(require.resolve('../src/screens/menu/MenuScreen.js'), 'utf8');
    expect(src).toMatch(/reset\(\{ index: 0, routes: \[\{ name: 'KioskMode' \}\] \}\)/);
  });
});
