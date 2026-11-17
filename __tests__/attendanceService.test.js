/* global jest, describe, test, expect, beforeEach */
const { createAsyncDb } = require('./helpers/sqlite');

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(() => Promise.resolve({ isConnected: false, isInternetReachable: false })),
  addEventListener: jest.fn(() => () => {}),
}));
jest.mock('../src/services/locationService', () => ({
  getCurrentPosition: jest.fn(() => Promise.resolve(null)),
  getCompanySites: jest.fn(() => Promise.resolve([])),
  resolveGeofence: jest.fn(() => null),
  recordLocationPing: jest.fn(() => Promise.resolve()),
}));
jest.mock('../src/services/fieldTrackingService', () => ({
  hasLocationConsent: jest.fn(() => Promise.resolve(false)),
  startFieldTracking: jest.fn(() => Promise.resolve()),
  stopFieldTracking: jest.fn(() => Promise.resolve()),
}));
const mockFrom = jest.fn();
jest.mock('../src/services/supabase', () => ({
  supabase: { from: (...a) => mockFrom(...a), rpc: jest.fn(), auth: { getSession: jest.fn(() => Promise.resolve({ data: { session: null } })) } },
}));

let db;
let svc;
beforeEach(async () => {
  jest.resetModules();
  const sqlite = require('expo-sqlite');
  sqlite.openDatabaseAsync.mockResolvedValue(createAsyncDb());
  mockFrom.mockReset();
  // Shift lookups go to the network; offline they fail and are ignored.
  mockFrom.mockImplementation(() => {
    throw new Error('offline');
  });
  db = await require('../src/services/db').getDb();
  svc = require('../src/services/attendanceService');
});

describe('face matching', () => {
  const vec = (...xs) => xs;
  test('matches the clearly best employee above threshold', () => {
    const match = svc.findMatchingEmployee(vec(1, 0, 0), [
      { id: 'a', face_embedding: vec(0.99, 0.05, 0) },
      { id: 'b', face_embedding: vec(0, 1, 0) },
    ]);
    expect(match.employee.id).toBe('a');
  });
  test('rejects look-alikes that are too close to call', () => {
    const match = svc.findMatchingEmployee(vec(1, 0, 0), [
      { id: 'a', face_embedding: vec(0.99, 0.1, 0) },
      { id: 'b', face_embedding: vec(0.99, 0.11, 0) },
    ]);
    expect(match).toBeNull();
  });
  test('rejects when nobody passes the threshold', () => {
    expect(svc.findMatchingEmployee(vec(1, 0, 0), [{ id: 'a', face_embedding: vec(0, 1, 0) }])).toBeNull();
  });
  test('uses the best of several stored angles', () => {
    const match = svc.findMatchingEmployee(vec(1, 0, 0), [
      { id: 'a', face_embeddings: [vec(0, 1, 0), vec(1, 0.02, 0)] },
    ]);
    expect(match.employee.id).toBe('a');
  });
  test('ignores templates of a different length (old 25-d vs 128-d)', () => {
    expect(svc.findMatchingEmployee(vec(1, 0, 0), [{ id: 'a', face_embedding: [1, 0] }])).toBeNull();
  });
});

describe('offline check-in and check-out', () => {
  const employee = { id: 'emp-1', name: 'Asha', work_mode: 'office' };
  test('first scan is a check-in with a transaction id, second is a check-out', async () => {
    const first = await svc.recordAttendance(employee, 'co-1');
    expect(first.type).toBe('check-in');
    let rows = await db.getAllAsync('SELECT * FROM attendance_offline');
    expect(rows).toHaveLength(1);
    expect(rows[0].client_txn_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0].sync_status).toBe('pending');

    const second = await svc.recordAttendance(employee, 'co-1');
    expect(second.type).toBe('check-out');
    rows = await db.getAllAsync('SELECT * FROM attendance_offline');
    expect(rows).toHaveLength(1);
    expect(rows[0].check_out).not.toBeNull();
    expect(rows[0].duration_minutes).toBeGreaterThanOrEqual(0);
  });

  test('offline roster only returns faces cached for this company', async () => {
    await db.runAsync("INSERT INTO employees_cache (id, name, face_embedding, company_id) VALUES ('x', 'Other Co', '[1,0]', 'co-2')");
    await db.runAsync("INSERT INTO employees_cache (id, name, face_embedding, company_id) VALUES ('y', 'Ours', '[1,0]', 'co-1')");
    const roster = await svc.getCompanyEmployees('co-1');
    expect(roster.map((e) => e.id)).toEqual(['y']);
  });
});
