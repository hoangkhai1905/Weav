const fs = require('node:fs');
const path = require('node:path');

function assertGatewayOriginInBundles(bundleSources, gatewayUrl, previousGatewayUrls = []) {
  let expectedOrigin;
  try {
    expectedOrigin = new URL(gatewayUrl).origin;
  } catch {
    throw new Error('Task10 Expo export origin preflight received an invalid Gateway URL.');
  }

  if (!Array.isArray(bundleSources) || bundleSources.length === 0) {
    throw new Error('Task10 Expo export origin preflight found no browser JavaScript assets.');
  }

  const previousOrigins = previousGatewayUrls.map((previousUrl) => {
    try {
      return new URL(previousUrl).origin;
    } catch {
      throw new Error('Task10 Expo export origin preflight received an invalid previous Gateway URL.');
    }
  });
  if (previousOrigins.some((origin) => bundleSources.some((source) => source.includes(origin)))) {
    throw new Error('Task10 Expo browser bundle contains an origin from a previous run.');
  }

  if (!bundleSources.some((source) => source.includes(expectedOrigin))) {
    throw new Error('Task10 Expo browser bundle does not embed this run’s configured Gateway origin.');
  }
}

function getAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${escapedName}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag);
  return match?.[2];
}

function readBrowserBundleSources(exportDirectory) {
  const root = path.resolve(exportDirectory);
  const indexPath = path.join(root, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error('Task10 Expo export origin preflight found no index.html.');
  }

  const html = fs.readFileSync(indexPath, 'utf8');
  const references = [];
  for (const match of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tagName = match[1];
    const tag = match[0];
    const reference = getAttribute(tag, tagName.toLowerCase() === 'script' ? 'src' : 'href');
    if (!reference) continue;

    let url;
    try {
      url = new URL(reference, 'http://task10-export.invalid');
    } catch {
      continue;
    }
    if (url.origin !== 'http://task10-export.invalid' || !url.pathname.toLowerCase().endsWith('.js')) continue;

    const assetPath = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (assetPath !== root && !assetPath.startsWith(`${root}${path.sep}`)) {
      throw new Error('Task10 Expo export origin preflight rejected an asset path outside the export directory.');
    }
    if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
      throw new Error('Task10 Expo export origin preflight could not find a referenced browser JavaScript asset.');
    }
    references.push(assetPath);
  }

  const uniqueReferences = [...new Set(references)];
  return uniqueReferences.map((assetPath) => fs.readFileSync(assetPath, 'utf8'));
}

function assertExpoExportUsesGateway(exportDirectory, gatewayUrl, previousGatewayUrls = []) {
  assertGatewayOriginInBundles(readBrowserBundleSources(exportDirectory), gatewayUrl, previousGatewayUrls);
}

if (require.main === module) {
  try {
    assertExpoExportUsesGateway(
      process.env.WEAV_TASK10_MOBILE_DIST,
      process.env.WEAV_TASK10_GATEWAY_URL,
    );
    process.stdout.write('Task10 Expo browser bundle matches this run’s Gateway origin.\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { assertGatewayOriginInBundles, assertExpoExportUsesGateway };
