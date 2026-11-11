import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { rateLimit } from '../src/rate-limit.js';

function appWith(options) {
  const app = express();
  app.use(rateLimit({ key: (req) => req.get('x-key') || 'anon', ...options }));
  app.get('/', (req, res) => res.json({ ok: true }));
  return app;
}

describe('rateLimit', () => {
  it('allows up to the limit then returns 429 with Retry-After', async () => {
    const app = appWith({ limit: 2, windowMs: 60000 });
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(200);
    const res = await request(app).get('/');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'rate_limited' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('counts each key separately', async () => {
    const app = appWith({ limit: 1, windowMs: 60000 });
    expect((await request(app).get('/').set('x-key', 'a')).status).toBe(200);
    expect((await request(app).get('/').set('x-key', 'b')).status).toBe(200);
    expect((await request(app).get('/').set('x-key', 'a')).status).toBe(429);
  });

  it('starts a fresh window after windowMs', async () => {
    let t = 1000;
    const app = appWith({ limit: 1, windowMs: 1000, now: () => t });
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(429);
    t += 1001;
    expect((await request(app).get('/')).status).toBe(200);
  });
});
