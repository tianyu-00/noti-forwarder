import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/sqlite.js';

// The server was written against a Postgres pool: query(sql, [params]) gives { rows, rowCount },
// connect() gives a client for a transaction. The adapter keeps that shape on one SQLite file.
let db;
afterEach(async () => {
  await db?.end();
});
const open = () => (db = openDatabase(':memory:'));

describe('query', () => {
  it('binds $1, $2 placeholders, in any order and more than once', async () => {
    open();

    const { rows } = await db.query('SELECT $2 AS a, $1 AS b, $1 AS c', ['one', 'two']);

    expect(rows).toEqual([{ a: 'two', b: 'one', c: 'one' }]);
  });

  it('gives rows and a row count for a select', async () => {
    open();
    await db.query('CREATE TABLE t (n integer)');
    await db.query('INSERT INTO t VALUES (1), (2), (3)');

    const result = await db.query('SELECT n FROM t ORDER BY n');

    expect(result.rows.map((r) => r.n)).toEqual([1, 2, 3]);
    expect(result.rowCount).toBe(3);
  });

  it('counts the rows an insert, update or delete changed', async () => {
    open();
    await db.query('CREATE TABLE t (n integer)');

    expect((await db.query('INSERT INTO t VALUES ($1), ($2)', [1, 2])).rowCount).toBe(2);
    expect((await db.query('UPDATE t SET n = n + 1 WHERE n > $1', [1])).rowCount).toBe(1);
    expect((await db.query('DELETE FROM t')).rowCount).toBe(2);
  });

  it('returns the rows of INSERT ... RETURNING, with a count of them', async () => {
    open();
    await db.query('CREATE TABLE t (id integer PRIMARY KEY, name text)');

    const result = await db.query('INSERT INTO t (name) VALUES ($1) RETURNING *', ['a']);

    expect(result.rows).toEqual([{ id: 1, name: 'a' }]);
    expect(result.rowCount).toBe(1);
  });

  it('counts an ignored conflict as no rows', async () => {
    open();
    await db.query('CREATE TABLE t (k text PRIMARY KEY)');
    await db.query('INSERT INTO t VALUES ($1)', ['x']);

    const result = await db.query('INSERT INTO t VALUES ($1) ON CONFLICT DO NOTHING RETURNING *', ['x']);

    expect(result.rowCount).toBe(0);
  });

  it('runs several statements at once when there are no parameters', async () => {
    open();

    await db.query('CREATE TABLE a (x); CREATE TABLE b (y); INSERT INTO a VALUES (1);');

    expect((await db.query('SELECT x FROM a')).rows).toEqual([{ x: 1 }]);
  });

  it('turns undefined into null and booleans into 0 and 1', async () => {
    open();

    const { rows } = await db.query('SELECT $1 AS a, $2 AS b, $3 AS c', [undefined, true, false]);

    expect(rows).toEqual([{ a: null, b: 1, c: 0 }]);
  });

  it('has the SQL functions the queries use', async () => {
    open();

    const { rows } = await db.query('SELECT now() AS created_at, gen_random_uuid() AS id');

    expect(rows[0].created_at).toBeInstanceOf(Date);
    expect(Math.abs(rows[0].created_at.getTime() - Date.now())).toBeLessThan(5000);
    expect(rows[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('time', () => {
  it('stores a Date as an ISO string and gives time columns back as Dates', async () => {
    open();
    await db.query('CREATE TABLE t (received_at text, last_seen text, locked_until text, body text)');
    const when = new Date('2026-11-11T10:00:05.123Z');

    await db.query('INSERT INTO t VALUES ($1, $1, $1, $2)', [when, '2026-11-11T10:00:05.123Z']);

    const raw = db.raw.prepare('SELECT received_at FROM t').get();
    expect(raw.received_at).toBe('2026-11-11T10:00:05.123Z');
    const { rows } = await db.query('SELECT * FROM t');
    expect(rows[0].received_at).toEqual(when);
    expect(rows[0].last_seen).toEqual(when);
    expect(rows[0].locked_until).toEqual(when);
  });

  it('leaves text that merely looks like a time alone, so a message body is never changed', async () => {
    open();
    await db.query('CREATE TABLE t (body text)');
    await db.query('INSERT INTO t VALUES ($1)', ['2026-11-11T10:00:05.123Z']);

    const { rows } = await db.query('SELECT body FROM t');

    expect(rows[0].body).toBe('2026-11-11T10:00:05.123Z');
  });

  it('keeps a null time as null', async () => {
    open();
    await db.query('CREATE TABLE t (revoked_at text)');
    await db.query('INSERT INTO t VALUES (NULL)');

    expect((await db.query('SELECT revoked_at FROM t')).rows[0].revoked_at).toBeNull();
  });

  it('adds milliseconds to a time with ts_add_ms, for expiries', async () => {
    open();

    const { rows } = await db.query("SELECT ts_add_ms('2026-11-11T10:00:00.000Z', $1) AS later", [90_000]);

    expect(rows[0].later).toBe('2026-11-11T10:01:30.000Z');
  });
});

describe('transactions', () => {
  it('commits and rolls back on a client', async () => {
    open();
    await db.query('CREATE TABLE t (n integer)');

    const kept = await db.connect();
    await kept.query('BEGIN');
    await kept.query('INSERT INTO t VALUES (1)');
    await kept.query('COMMIT');
    kept.release();

    const dropped = await db.connect();
    await dropped.query('BEGIN');
    await dropped.query('INSERT INTO t VALUES (2)');
    await dropped.query('ROLLBACK');
    dropped.release();

    expect((await db.query('SELECT n FROM t')).rows).toEqual([{ n: 1 }]);
  });

  it('keeps other requests out of an open transaction', async () => {
    open();
    await db.query('CREATE TABLE t (n integer)');
    const client = await db.connect();
    await client.query('BEGIN');
    await client.query('INSERT INTO t VALUES (1)');

    // Another request arrives mid-transaction. It must wait, not see (or join) the transaction.
    const other = db.query('SELECT count(*) AS c FROM t');
    await client.query('ROLLBACK');
    client.release();

    expect((await other).rows[0].c).toBe(0);
  });

  it('hands the connection to one client at a time', async () => {
    open();
    const order = [];
    const first = await db.connect();
    const second = db.connect().then((client) => {
      order.push('second got it');
      client.release();
    });

    await new Promise((r) => setTimeout(r, 20));
    order.push('first still holding');
    first.release();
    await second;

    expect(order).toEqual(['first still holding', 'second got it']);
  });

  it('lets go of the connection even when a query inside it fails', async () => {
    open();
    const client = await db.connect();
    await expect(client.query('SELECT * FROM missing_table')).rejects.toThrow();
    client.release();

    expect((await db.query('SELECT 1 AS one')).rows).toEqual([{ one: 1 }]);
  });
});

describe('transaction()', () => {
  it('commits what the function did and returns its result', async () => {
    open();
    await db.query('CREATE TABLE t (n integer)');

    const result = await db.transaction(async (client) => {
      await client.query('INSERT INTO t VALUES (1)');
      return 'done';
    });

    expect(result).toBe('done');
    expect((await db.query('SELECT n FROM t')).rows).toEqual([{ n: 1 }]);
  });

  it('rolls everything back and rethrows when the function throws', async () => {
    open();
    await db.query('CREATE TABLE t (n integer)');

    await expect(
      db.transaction(async (client) => {
        await client.query('INSERT INTO t VALUES (1)');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect((await db.query('SELECT count(*) AS c FROM t')).rows[0].c).toBe(0);
  });

  it('lets other queries run once it is over, whether it worked or not', async () => {
    open();
    await db.transaction(async () => {});
    await db.transaction(async () => {
      throw new Error('x');
    }).catch(() => {});

    expect((await db.query('SELECT 1 AS one')).rows).toEqual([{ one: 1 }]);
  });

  it('runs two transactions one after the other, never mixed', async () => {
    open();
    await db.query('CREATE TABLE t (n integer)');
    const log = [];
    const slow = db.transaction(async (client) => {
      await client.query('INSERT INTO t VALUES (1)');
      await new Promise((r) => setTimeout(r, 20));
      log.push('slow done');
    });
    const quick = db.transaction(async (client) => {
      log.push('quick started');
      await client.query('INSERT INTO t VALUES (2)');
    });

    await Promise.all([slow, quick]);

    expect(log).toEqual(['slow done', 'quick started']);
  });
});

describe('rules of the database', () => {
  it('enforces foreign keys and cascades deletes', async () => {
    open();
    await db.query('CREATE TABLE a (id text PRIMARY KEY)');
    await db.query('CREATE TABLE b (a_id text NOT NULL REFERENCES a(id) ON DELETE CASCADE)');

    await expect(db.query('INSERT INTO b VALUES ($1)', ['nope'])).rejects.toThrow(/FOREIGN KEY/i);

    await db.query('INSERT INTO a VALUES ($1)', ['x']);
    await db.query('INSERT INTO b VALUES ($1)', ['x']);
    await db.query('DELETE FROM a');
    expect((await db.query('SELECT count(*) AS c FROM b')).rows[0].c).toBe(0);
  });

  it('refuses a repeated unique value', async () => {
    open();
    await db.query('CREATE TABLE t (k text UNIQUE)');
    await db.query('INSERT INTO t VALUES ($1)', ['x']);

    await expect(db.query('INSERT INTO t VALUES ($1)', ['x'])).rejects.toThrow(/UNIQUE/i);
  });
});

describe('a database file', () => {
  it('creates the folder it lives in, and the file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nf-db-'));
    const file = join(dir, 'not', 'there', 'yet', 'data.db');

    db = openDatabase(file);

    expect(existsSync(file)).toBe(true);
  });

  it('keeps its data when it is closed and opened again', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'nf-db-')), 'data.db');
    const first = openDatabase(file);
    await first.query('CREATE TABLE t (n integer)');
    await first.query('INSERT INTO t VALUES ($1)', [42]);
    await first.end();

    db = openDatabase(file);

    expect((await db.query('SELECT n FROM t')).rows).toEqual([{ n: 42 }]);
  });

  it('can be opened twice at once for reading and writing (a backup, or reset-totp)', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'nf-db-')), 'data.db');
    const server = openDatabase(file);
    await server.query('CREATE TABLE t (n integer)');

    db = openDatabase(file);
    await db.query('INSERT INTO t VALUES (1)');

    expect((await server.query('SELECT count(*) AS c FROM t')).rows[0].c).toBe(1);
    await server.end();
  });
});

describe('backup', () => {
  it('writes a complete, separate copy while the database is in use', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nf-db-'));
    db = openDatabase(join(dir, 'data.db'));
    await db.query('CREATE TABLE t (n integer)');
    await db.query('INSERT INTO t VALUES (1), (2), (3)');

    const copy = join(dir, 'copy.db');
    await db.backup(copy);

    const restored = openDatabase(copy);
    expect((await restored.query('SELECT count(*) AS c FROM t')).rows[0].c).toBe(3);
    await restored.end();
    // The original keeps working and is not affected.
    await db.query('INSERT INTO t VALUES (4)');
    expect((await db.query('SELECT count(*) AS c FROM t')).rows[0].c).toBe(4);
  });

  it('refuses to overwrite a file that is already there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nf-db-'));
    db = openDatabase(join(dir, 'data.db'));
    const existing = join(dir, 'existing.db');
    openDatabase(existing).end();

    await expect(db.backup(existing)).rejects.toThrow();
  });
});
