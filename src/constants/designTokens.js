import { Platform } from 'react-native';

// A real serif (not a bundled font — avoids another OTA-incompatible asset)
// for the handful of "big number" / screen-title moments the new design
// calls out — Android's built-in "serif" maps to Noto Serif, iOS gets the
// actual Georgia. Everything else in the app stays on Sora/Inter.
export const SERIF_FONT = Platform.OS === 'ios' ? 'Georgia' : 'serif';

// Branches and departments don't have a stored color — this assigns one
// deterministically from a fixed palette so the same branch/department
// always gets the same color across sessions, without needing a DB column.
const COLOR_PALETTE = [
  '#6366F1',
  '#10B981',
  '#EF4444',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
  '#F97316',
  '#06B6D4',
  '#84CC16',
];

export function colorForIndex(index) {
  return COLOR_PALETTE[((index % COLOR_PALETTE.length) + COLOR_PALETTE.length) % COLOR_PALETTE.length];
}

// Stable per-id color (for avatars) — same employee always gets the same
// color even as list order/filtering changes, unlike an array-index lookup.
export function colorForId(id) {
  if (!id) return COLOR_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return colorForIndex(hash);
}
