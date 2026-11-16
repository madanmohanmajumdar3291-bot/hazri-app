// Real SQLite (better-sqlite3, in memory) behind the expo-sqlite async API
// that src/services/db.js uses, so the app's actual SQL runs in tests.
const Database = require('better-sqlite3');

function createAsyncDb() {
  const raw = new Database(':memory:');
  const norm = (params) => (params || []).map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
  return {
    raw,
    async execAsync(sql) {
      raw.exec(sql);
    },
    async runAsync(sql, params) {
      const info = raw.prepare(sql).run(...norm(params));
      return { changes: info.changes, lastInsertRowId: info.lastInsertRowid };
    },
    async getAllAsync(sql, params) {
      return raw.prepare(sql).all(...norm(params));
    },
    async withTransactionAsync(fn) {
      raw.exec('BEGIN');
      try {
        await fn();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

module.exports = { createAsyncDb };
