import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('GET /api/v1/health', () => {
  it('returns 200 with version, commit and buildTime from the build env', async () => {
    const app = createApp({
      version: '1.2.3',
      commit: 'abc1234',
      buildTime: '2026-11-11T10:00:00Z',
    });

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      version: '1.2.3',
      commit: 'abc1234',
      buildTime: '2026-11-11T10:00:00Z',
    });
  });
});
