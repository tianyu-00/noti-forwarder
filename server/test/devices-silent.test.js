import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { buildTestApp, ADMIN } from './helpers/app.js';
import { ensureAdminUser } from '../src/auth/users.js';

let ctx;
afterEach(() => ctx.pool.end());

async function list(options) {
  ctx = await buildTestApp({ realAuth: true, ...options });
  await ensureAdminUser(ctx.pool, ADMIN);
  const agent = request.agent(ctx.app);
  await agent.post('/api/v1/auth/login').send(ADMIN);
  return agent.get('/api/v1/devices');
}

describe('GET /api/v1/devices quiet threshold', () => {
  it('tells the dashboard after how many minutes a phone counts as quiet', async () => {
    const res = await list({ silentAfterMinutes: 90 });

    expect(res.status).toBe(200);
    expect(res.body.silentAfterMinutes).toBe(90);
    expect(Array.isArray(res.body.devices)).toBe(true);
  });

  it('says 0 (off) when the check is not configured', async () => {
    const res = await list({});

    expect(res.body.silentAfterMinutes).toBe(0);
  });
});
