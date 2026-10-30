// Midnight Glass — a calmer, more premium palette than the earlier "Aurora"
// pass: one warm amber accent instead of three competing hues, deep-navy
// (not neon-violet) backgrounds, and cards as translucent glass panels.
// Every screen already reads colors via useTheme()/these token names
// (accent, primary, background, card, border, textPrimary, textSecondary,
// success, error, warning, info, white, isDark), so no layout or screen file
// needs to change for the look to apply everywhere.
export const LIGHT_COLORS = {
  primary: '#B87A1E', // amber — nav/header/camera surfaces ("brand")
  accent: '#B87A1E', // amber — primary actions, links, active states
  accentSoft: '#F6E8CE', // selected states, subtle backgrounds
  brand: '#1B4B43', // deep pine green — splash screen, employee-code badges; a second identity color, distinct from the amber accent
  success: '#1F7A6F', // check-in confirmed, present
  successSoft: '#DCEFEA',
  error: '#B84A5D', // absent, failed scan, errors
  errorSoft: '#F7E1E5',
  warning: '#A66A10', // late, pending, needs review
  warningSoft: '#F6E8CE',
  info: '#2C7A72',
  infoSoft: '#DCEFEA',
  singlePunch: '#92400E', // checked in but never checked out — distinct from absent/late, not a failure state
  singlePunchSoft: '#FEF3C7',
  background: '#F3EEE3', // warm paper
  card: 'rgba(255,255,255,0.82)', // frosted-glass panel
  textPrimary: '#211B10',
  textSecondary: '#5B5342',
  border: 'rgba(33,27,16,0.12)',
  white: '#FFFFFF',
  isDark: false,
  radiusSm: 8,
  radiusMd: 12, // cards
  radiusLg: 16,
  radiusPill: 999, // primary CTA buttons, status pills
};

export const DARK_COLORS = {
  primary: '#11151D', // deep navy — camera surfaces, nav
  accent: '#F2B84B', // warm amber, the single accent in the whole theme
  accentSoft: 'rgba(242,184,75,0.16)',
  brand: '#2E8A76', // lightened pine green so it still reads against a dark background
  success: '#3FB6AE', // teal — present/checked-in
  successSoft: 'rgba(63,182,174,0.15)',
  error: '#E2637A', // rose — late/failed
  errorSoft: 'rgba(226,99,122,0.15)',
  warning: '#F2B84B',
  warningSoft: 'rgba(242,184,75,0.15)',
  info: '#3FB6AE',
  infoSoft: 'rgba(63,182,174,0.15)',
  singlePunch: '#FBBF24',
  singlePunchSoft: 'rgba(251,191,36,0.16)',
  background: '#0A0E14', // deep navy, not near-black-violet
  card: 'rgba(255,255,255,0.07)', // frosted-glass panel, clearly lighter than the ground
  textPrimary: '#F5F1E8',
  textSecondary: '#B8B2A4',
  border: 'rgba(255,255,255,0.14)',
  white: '#FFFFFF',
  isDark: true,
  radiusSm: 8,
  radiusMd: 12,
  radiusLg: 16,
  radiusPill: 999,
};

// Default export kept for any screen not yet converted to the theme-aware
// useTheme() hook — always resolves to the light palette so those screens
// keep working exactly as before until they're migrated.
export const COLORS = LIGHT_COLORS;

