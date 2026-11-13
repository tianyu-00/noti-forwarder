import { openDatabase } from '../../src/db/sqlite.js';

// Every test file gets its own empty database, in memory.
export async function createTestPool() {
  return openDatabase(':memory:');
}
