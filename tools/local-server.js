const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const host = '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const root = path.resolve(__dirname, '..');

function loadLocalEnvironment() {
  const localPath = path.join(root, '.env.local');
  if (!fs.existsSync(localPath)) return;
  const lines = fs.readFileSync(localPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    const value = match[2].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, doubleQuoted, singleQuoted) =>
      doubleQuoted ?? singleQuoted
    );
    process.env[match[1]] = value;
  }
}

loadLocalEnvironment();

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${host}:${port}`).pathname);
  } catch {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Bad request');
    return;
  }

  if (pathname === '/runtime-config.js') {
    const tenantSlug = /^[a-z0-9][a-z0-9-]{1,62}$/.test(process.env.PB_TENANT_SLUG || '')
      ? process.env.PB_TENANT_SLUG
      : 'dfortees';
    const config = {
      supabaseUrl: process.env.PB_SUPABASE_URL || 'https://dfortees-backend.invalid',
      supabasePublishableKey:
        process.env.PB_SUPABASE_PUBLISHABLE_KEY || 'DFORTEES_SUPABASE_PUBLISHABLE_KEY_NOT_CONFIGURED',
      tenantSlug,
    };
    const body = `window.PB_RUNTIME_CONFIG = Object.freeze(${JSON.stringify(config).replaceAll('<', '\\u003c')});\n`;
    response.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(body);
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(root, `.${pathname}`);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }

    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(data);
  });
});

server.listen(port, host, () => {
  console.log(`D'fortees local preview: http://${host}:${port}/`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
