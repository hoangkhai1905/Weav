const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { resolveTask10StaticTarget } = require('./task10-static-routes.cjs');

const root = path.resolve(process.env.WEAV_TASK10_MOBILE_DIST || '');
const port = Number(process.env.WEAV_TASK10_MOBILE_PORT);
const host = '127.0.0.1';
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

if (!path.isAbsolute(root) || !Number.isInteger(port) || port < 1 || port > 65_535) {
  process.exitCode = 2;
  throw new Error('Task10 Expo Web static server configuration is invalid.');
}

const indexFile = path.join(root, 'index.html');
if (!fs.existsSync(indexFile)) {
  process.exitCode = 2;
  throw new Error('Task10 Expo Web export does not contain index.html.');
}

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  const target = resolveTask10StaticTarget(root, pathname);
  if (target === null) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = fs.readFileSync(target);
    response.writeHead(200, {
      'content-type': contentTypes.get(path.extname(target).toLowerCase()) || 'application/octet-stream',
      'content-length': body.length,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(500).end();
  }
});

server.listen(port, host);
