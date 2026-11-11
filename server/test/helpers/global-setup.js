import { PostgreSqlContainer } from '@testcontainers/postgresql';

let container;

export async function setup({ provide }) {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  provide('pgUri', container.getConnectionUri());
}

export async function teardown() {
  await container?.stop();
}
