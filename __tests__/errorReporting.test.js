/* global jest, describe, test, expect, beforeEach */
const mockInsert = jest.fn(() => Promise.resolve({ error: null }));
jest.mock('../src/services/supabase', () => ({ supabase: { from: jest.fn(() => ({ insert: mockInsert })) } }));

const er = require('../src/services/errorReporting');

beforeEach(() => {
  mockInsert.mockClear();
  er.__resetForTests();
});

describe('crash report scrubbing', () => {
  test('removes tokens, emails, phone numbers and number arrays', () => {
    const text = er.scrubText(
      'auth failed for ravi@example.com 9876543210 token eyJhbGciOi.eyJzdWIiOi.sig Bearer abc.def emb 0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0.11'
    );
    expect(text).not.toMatch(/ravi@example\.com/);
    expect(text).not.toMatch(/9876543210/);
    expect(text).not.toMatch(/eyJhbGciOi/);
    expect(text).not.toMatch(/abc\.def/);
    expect(text).toContain('[numbers]');
  });

  test('redacts sensitive keys and long numeric arrays in context', () => {
    const ctx = er.scrubContext({
      password: 'hunter2',
      refresh_token: 'x',
      face_embedding: [1, 2, 3],
      nested: { email: 'a@b.co', screen: 'Kiosk' },
      vector: Array.from({ length: 128 }, () => 0.5),
    });
    expect(ctx.password).toBe('[redacted]');
    expect(ctx.refresh_token).toBe('[redacted]');
    expect(ctx.face_embedding).toBe('[redacted]');
    expect(ctx.nested.email).toBe('[redacted]');
    expect(ctx.nested.screen).toBe('Kiosk');
    expect(ctx.vector).toBe('[128 numbers]');
  });

  test('report carries app and device info but not the raw message secrets', () => {
    const r = er.buildReport(new Error('login failed for a@b.co'), { isFatal: true });
    expect(r.is_fatal).toBe(true);
    expect(r.platform).toBeDefined();
    expect(r.message).toBe('login failed for [email]');
  });

  test('duplicate errors within a minute are sent once', () => {
    er.reportError(new Error('boom'));
    er.reportError(new Error('boom'));
    er.reportError(new Error('other'));
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  test('caps reports per session', () => {
    for (let i = 0; i < 100; i++) er.reportError(new Error(`e${i}`));
    expect(mockInsert).toHaveBeenCalledTimes(30);
  });

  test('never throws even if the backend client is broken', () => {
    mockInsert.mockImplementation(() => {
      throw new Error('client broken');
    });
    expect(() => er.reportError(new Error('x'))).not.toThrow();
  });
});
