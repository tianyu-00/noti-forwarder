import { inject } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

// Gives each test file its own empty database on the shared container.
export async function createTestPool() {
  const admin = new pg.Pool({ connectionString: inject('pgUri'), max: 1 });
  const name = `t_${randomUUID().replace(/-/g, '')}`;
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(inject('pgUri'));
  url.pathname = `/${name}`;
  return new pg.Pool({ connectionString: url.toString() });
}
