import { describe, it, expect } from 'vitest';
import { loadBuildInfo } from '../src/config.js';

describe('loadBuildInfo', () => {
  it('reads version, commit and build time from the build env vars', () => {
    const info = loadBuildInfo({
      APP_VERSION: '1.2.3',
      GIT_COMMIT: 'abc1234',
      BUILD_TIME: '2026-11-11T10:00:00Z',
    });

    expect(info).toEqual({
      version: '1.2.3',
      commit: 'abc1234',
      buildTime: '2026-11-11T10:00:00Z',
    });
  });
});
