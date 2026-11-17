import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';

let dbPromise = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('facemark.db').then(async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS attendance_offline (
          local_id TEXT PRIMARY KEY,
          remote_id TEXT,
          employee_id TEXT NOT NULL,
          employee_name TEXT NOT NULL,
          company_id TEXT NOT NULL,
          check_in TEXT,
          check_out TEXT,
          duration_minutes INTEGER,
          date TEXT NOT NULL,
          marked_by TEXT NOT NULL,
          status TEXT,
          note TEXT,
          site_id TEXT,
          check_in_lat REAL,
          check_in_lng REAL,
          check_out_lat REAL,
          check_out_lng REAL,
          is_outside_geofence INTEGER,
          overtime_minutes INTEGER,
          is_early_departure INTEGER,
          sync_status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS employees_cache (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          face_embedding TEXT,
          face_embeddings TEXT,
          work_mode TEXT NOT NULL DEFAULT 'office',
          location_consent_given_at TEXT
        );
        CREATE TABLE IF NOT EXISTS sync_meta (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);

      // Devices that installed before these columns existed have older
      // table shapes — CREATE TABLE IF NOT EXISTS above is a no-op for them,
      // so patch the columns in directly (fails harmlessly if already there).
      const patchColumns = [
        `ALTER TABLE attendance_offline ADD COLUMN site_id TEXT`,
        `ALTER TABLE attendance_offline ADD COLUMN check_in_lat REAL`,
        `ALTER TABLE attendance_offline ADD COLUMN check_in_lng REAL`,
        `ALTER TABLE attendance_offline ADD COLUMN check_out_lat REAL`,
        `ALTER TABLE attendance_offline ADD COLUMN check_out_lng REAL`,
        `ALTER TABLE attendance_offline ADD COLUMN is_outside_geofence INTEGER`,
        `ALTER TABLE employees_cache ADD COLUMN work_mode TEXT NOT NULL DEFAULT 'office'`,
        `ALTER TABLE employees_cache ADD COLUMN location_consent_given_at TEXT`,
        `ALTER TABLE employees_cache ADD COLUMN face_embeddings TEXT`,
        `ALTER TABLE attendance_offline ADD COLUMN overtime_minutes INTEGER`,
        `ALTER TABLE attendance_offline ADD COLUMN is_early_departure INTEGER`,
        // v1.1.0: idempotency key sent to the server, retry bookkeeping, and
        // which company a cached face belongs to.
        `ALTER TABLE attendance_offline ADD COLUMN client_txn_id TEXT`,
        `ALTER TABLE attendance_offline ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`,
        `ALTER TABLE attendance_offline ADD COLUMN last_error TEXT`,
        `ALTER TABLE attendance_offline ADD COLUMN next_attempt_at TEXT`,
        `ALTER TABLE employees_cache ADD COLUMN company_id TEXT`,
      ];
      for (const statement of patchColumns) {
        try {
          await db.execAsync(statement);
        } catch (_error) {
          // Column already exists — expected on a fresh install.
        }
      }

      // v1.0.x resolved same-day conflicts on the phone by marking one row
      // 'dropped', which threw away its checkout. The server now merges
      // same-day records itself, so put those rows back in the queue.
      try {
        await db.runAsync(`UPDATE attendance_offline SET sync_status = 'pending' WHERE sync_status = 'dropped'`);
      } catch (_error) {
        // Nothing to recover.
      }

      return db;
    });
    // A failed open must not poison every later call for the whole session.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

export function generateLocalId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// RFC 4122 v4, used as the attendance transaction id the server dedupes on.
export function generateTxnId() {
  return Crypto.randomUUID();
}

