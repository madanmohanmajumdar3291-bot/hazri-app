/* global describe, test, expect */
import { buildAlertText, isCritical } from '../supabase/functions/_shared/alerts.ts';

const row = (over = {}) => ({
  created_at: '2026-11-17T10:00:00Z', is_fatal: false, error_name: 'Error', message: 'x',
  app_version: '1.1.0', company_id: 'c1', ...over,
});

describe('error alerts', () => {
  test('no alert when nothing is critical', () => {
    expect(buildAlertText([row(), row({ message: 'Network request failed' })], 15)).toBeNull();
  });
  test('crashes and parked sync failures are critical', () => {
    expect(isCritical(row({ is_fatal: true }))).toBe(true);
    expect(isCritical(row({ message: 'Attendance sync parked as failed: 42501' }))).toBe(true);
  });
  test('groups repeats and counts companies', () => {
    const text = buildAlertText([
      row({ is_fatal: true, error_name: 'TypeError', message: 'undefined is not a function', company_id: 'a' }),
      row({ is_fatal: true, error_name: 'TypeError', message: 'undefined is not a function', company_id: 'b' }),
      row({ message: 'Attendance sync parked as failed: 23503' }),
    ], 15);
    expect(text).toContain('3 critical error(s) in the last 15 min');
    expect(text).toContain('2x CRASH: TypeError');
    expect(text).toContain('2 companies');
    expect(text).toContain('1x SYNC');
  });
  test('caps the number of lines', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row({ is_fatal: true, message: `m${i}` }));
    const text = buildAlertText(rows, 15, 5);
    expect(text.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(5);
    expect(text).toContain('3 more kinds');
  });
});
