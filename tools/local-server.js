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

const publicFiles = new Set([
  'admin.html',
  'booking-balance.js',
  'brand-config.js',
  'brand.css',
  'chart.min.js',
  'dforteesspash.jpg',
  'host.html',
  'index.html',
  'login.html',
  'logonewnew.png',
  'single-tenant-api.js',
  'supabase-config.js',
  'supabase.min.js',
]);

function sendPlainText(response, statusCode, message, extraHeaders = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  response.end(message);
}

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${host}:${port}`).pathname);
  } catch {
    sendPlainText(response, 400, 'Bad request');
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendPlainText(response, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    return;
  }

  if (pathname === '/runtime-config.js') {
    const config = {
      supabaseUrl: process.env.PB_SUPABASE_URL || 'https://dfortees-backend.invalid',
      supabasePublishableKey:
        process.env.PB_SUPABASE_PUBLISHABLE_KEY || 'DFORTEES_SUPABASE_PUBLISHABLE_KEY_NOT_CONFIGURED',
    };
    const body = `window.PB_RUNTIME_CONFIG = Object.freeze(${JSON.stringify(config).replaceAll('<', '\\u003c')});\n`;
    response.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  const segments = pathname.split('/').filter(Boolean);
  const publicFile = segments.length === 1 ? segments[0] : '';
  if (!publicFile || publicFile.startsWith('.') || !publicFiles.has(publicFile)) {
    sendPlainText(response, 404, 'Not found');
    return;
  }
  const filePath = path.join(root, publicFile);

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendPlainText(response, error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }

    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : data);
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
