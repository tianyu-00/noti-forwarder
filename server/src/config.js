export function loadBuildInfo(env) {
  return {
    version: env.APP_VERSION || 'dev',
    commit: env.GIT_COMMIT || 'unknown',
    buildTime: env.BUILD_TIME || 'unknown',
  };
}
