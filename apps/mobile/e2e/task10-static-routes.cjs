const fs = require('node:fs');
const path = require('node:path');

function isWithinRoot(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function isFile(target) {
  return fs.existsSync(target) && fs.statSync(target).isFile();
}

function resolveTask10StaticTarget(exportRoot, pathname) {
  const root = path.resolve(exportRoot);
  const candidate = path.resolve(root, `.${pathname}`);
  if (!isWithinRoot(root, candidate)) return null;

  if (fs.existsSync(candidate)) {
    if (fs.statSync(candidate).isDirectory()) {
      const directoryIndex = path.join(candidate, 'index.html');
      if (isFile(directoryIndex)) return directoryIndex;
    } else if (fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  const normalizedPathname = pathname.replace(/\/+$/, '');
  if (normalizedPathname) {
    const routeHtml = path.resolve(root, `.${normalizedPathname}.html`);
    if (isWithinRoot(root, routeHtml) && isFile(routeHtml)) return routeHtml;
  }

  return path.join(root, 'index.html');
}

module.exports = { resolveTask10StaticTarget };
