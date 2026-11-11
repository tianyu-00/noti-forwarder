export function loadBuildInfo(env) {
  return {
    version: env.APP_VERSION,
    commit: env.GIT_COMMIT,
    buildTime: env.BUILD_TIME,
  };
}
