/**
 * staticServer.js — secure static file serving with caching headers
 */
const fs   = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.mp4':  'video/mp4',
  '.webp': 'image/webp',
};

const CACHE_CONTROL = {
  '.html': 'no-cache',
  '.json': 'no-cache',
  default: 'public, max-age=86400', // 1 day for assets
};

function serveStatic(req, res, publicDir) {
  const parsedPath = req.url.split('?')[0];

  // Prevent directory traversal
  const safePath = path.normalize(parsedPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(publicDir, safePath);

  // Ensure inside public dir
  if (!filePath.startsWith(publicDir)) {
    send403(res);
    return;
  }

  // If directory → try index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    // SPA fallback — serve index.html for unknown routes
    filePath = path.join(publicDir, 'index.html');
    if (!fs.existsSync(filePath)) { send404(res); return; }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const cacheControl = CACHE_CONTROL[ext] || CACHE_CONTROL.default;

  // ETag support (simple mtime-based)
  const stat = fs.statSync(filePath);
  const etag = `"${stat.mtime.getTime()}-${stat.size}"`;

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304);
    res.end();
    return;
  }

  const stream = fs.createReadStream(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': cacheControl,
    'ETag': etag,
    'X-Content-Type-Options': 'nosniff',
  });
  stream.pipe(res);
  stream.on('error', () => { if (!res.headersSent) send500(res); });
}

function send403(res) {
  res.writeHead(403, { 'Content-Type': 'text/plain' });
  res.end('403 Forbidden');
}
function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
}
function send500(res) {
  res.writeHead(500, { 'Content-Type': 'text/plain' });
  res.end('500 Internal Server Error');
}

module.exports = { serveStatic };
