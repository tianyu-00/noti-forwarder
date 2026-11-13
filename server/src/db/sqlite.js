import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

// The server talks to its database the way it did to a Postgres pool: query(sql, [params]) gives
// { rows, rowCount } and connect() gives a client for a transaction. This keeps that shape on one
// SQLite file, so the SQL in the routes stays plain SQL with $1, $2 placeholders.

// Times are stored as UTC text like 2026-11-11T10:00:05.123Z, which sorts in time order. They come
// back as Dates for the columns named like a time, so the rest of the code still sees Dates. It
// goes by the column name, never by what the text looks like, so a message body that happens to
// read like a time is left alone.
const TIME_COLUMN = /(_at|_until|last_seen)$/;
const ISO_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

function toParam(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function toRow(row) {
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (typeof value === 'string' && TIME_COLUMN.test(key) && ISO_TIME.test(value)) row[key] = new Date(value);
  }
  return row;
}

/** Opens (or creates) the database file. Use ':memory:' for a throwaway one in tests. */
export function openDatabase(path) {
  const raw = new Database(path);
  raw.pragma('journal_mode = WAL');
  raw.pragma('synchronous = NORMAL');
  raw.pragma('foreign_keys = ON');
  raw.pragma('busy_timeout = 5000');
  raw.function('now', { deterministic: false }, () => new Date().toISOString());
  raw.function('gen_random_uuid', { deterministic: false }, () => randomUUID());
  // For expiry times: a time plus some milliseconds, as text in the same format.
  raw.function('ts_add_ms', (ts, ms) => new Date(new Date(ts).getTime() + Number(ms)).toISOString());

  // $1, $2 become plain ? with the values lined up in order of appearance, so a placeholder may be
  // used twice or out of order, as in Postgres.
  function run(sql, params = []) {
    const values = [];
    const text = sql.replace(/\$(\d+)/g, (_, n) => {
      values.push(toParam(params[Number(n) - 1]));
      return '?';
    });
    let statement;
    try {
      statement = raw.prepare(text);
    } catch (err) {
      // A migration file holds several statements, which prepare() refuses.
      if (values.length === 0 && /more than one statement/i.test(err.message)) {
        raw.exec(text);
        return { rows: [], rowCount: 0 };
      }
      throw err;
    }
    if (statement.reader) {
      const rows = statement.all(values).map(toRow);
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: statement.run(values).changes };
  }

  // One connection serves everyone, so a transaction must not be joined by another request that
  // arrives while it is open. A client holds this lock until release(); plain queries wait for it.
  let tail = Promise.resolve();
  function acquire() {
    let release;
    const mine = new Promise((resolve) => (release = resolve));
    const before = tail;
    tail = before.then(() => mine);
    return before.then(() => release);
  }

  return {
    raw,
    async query(sql, params) {
      const release = await acquire();
      try {
        return run(sql, params);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await acquire();
      let held = true;
      return {
        async query(sql, params) {
          return run(sql, params);
        },
        release() {
          if (!held) return;
          held = false;
          release();
        },
      };
    },
    /**
     * Runs [fn] in a transaction on the one connection: commits when it returns, rolls back when it
     * throws, and gives the connection back either way. Code inside must use the client it is given,
     * never the pool, which would wait for the very connection the transaction holds.
     */
    async transaction(fn) {
      const client = await this.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async end() {
      raw.close();
    },
  };
}
