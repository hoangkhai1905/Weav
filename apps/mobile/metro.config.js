const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const task10TransformCache = process.env.WEAV_TASK10_METRO_CACHE_DIR;

if (task10TransformCache) {
  if (!path.isAbsolute(task10TransformCache)) {
    throw new Error('Task10 Metro transform cache path must be absolute.');
  }

  // EXPO_PUBLIC_* values are inlined during Babel transforms. Keep this
  // disposable export's transforms out of Metro's process-global temp cache.
  config.cacheStores = ({ FileStore }) => [new FileStore({ root: task10TransformCache })];
}

module.exports = config;
