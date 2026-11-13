import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestPool } from './helpers/db.js';
import { runMigrations } from '../src/db/migrate.js';

let pool;
beforeAll(async () => {
  pool = await createTestPool();
});
afterAll(() => pool.end());

function migrationsDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

describe('runMigrations', () => {
  it('applies numbered migrations in order and records them', async () => {
    const dir = migrationsDir({
      '002_b.sql': 'CREATE TABLE b (a_id int REFERENCES a(id));',
      '001_a.sql': 'CREATE TABLE a (id int PRIMARY KEY);',
    });

    const applied = await runMigrations(pool, dir);

    expect(applied).toEqual(['001_a.sql', '002_b.sql']);
    const { rows } = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
    expect(rows.map((r) => r.name)).toEqual(['001_a.sql', '002_b.sql']);
  });

  it('runs each migration only once', async () => {
    const dir = migrationsDir({ '001_c.sql': 'CREATE TABLE c (id int);' });

    expect(await runMigrations(pool, dir)).toEqual(['001_c.sql']);
    expect(await runMigrations(pool, dir)).toEqual([]);
  });

  it('rolls back a failing migration and does not record it', async () => {
    const dir = migrationsDir({
      '001_d.sql': 'CREATE TABLE d (id int); SELECT * FROM does_not_exist;',
    });

    await expect(runMigrations(pool, dir)).rejects.toThrow();

    const t = await pool.query("SELECT name FROM sqlite_master WHERE name = 'd'");
    expect(t.rowCount).toBe(0);
    const rec = await pool.query("SELECT 1 FROM schema_migrations WHERE name = '001_d.sql'");
    expect(rec.rowCount).toBe(0);
  });
});
