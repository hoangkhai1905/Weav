const { existsSync } = require('node:fs');

// Android push needs Firebase: EAS passes the file secret as GOOGLE_SERVICES_JSON, local builds
// use ./google-services.json (git-ignored). Without either the app builds and push stays off.
module.exports = ({ config }) => {
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ??
    (existsSync('./google-services.json') ? './google-services.json' : undefined);
  return {
    ...config,
    android: { ...config.android, ...(googleServicesFile ? { googleServicesFile } : {}) },
  };
};
