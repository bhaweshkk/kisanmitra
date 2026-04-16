/**
 * lib/staticServer.js — Serve static files
 * Checks public/ first, then project root as fallback
 */
const fs   = require('fs');
const path = require('path');

const MIME = { 
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.txt':  'text/plain',
  '.pdf':  'application/pdf',
};

function serveStatic(req, res, publicDir) {
  const urlPath  = req.url.split('?')[0];
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const rootDir  = path.join(publicDir, '..'); // project root

  // Build candidate paths: public/ first, then project root
  let filePath = path.join(publicDir, safePath);

  // For directory requests, try index.html
  if (!path.extname(filePath)) {
    const candidates = [
      path.join(filePath, 'index.html'),
      path.join(publicDir, 'index.html'),
      path.join(rootDir, 'index.html'),
    ];
    filePath = candidates.find(p => fs.existsSync(p) && fs.statSync(p).isFile())
      || filePath;
  }

  // If not found in public/, try root
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    const rootPath = path.join(rootDir, safePath);
    if (fs.existsSync(rootPath) && fs.statSync(rootPath).isFile()) {
      filePath = rootPath;
    } else {
      // SPA fallback: try index.html in public/ then root
      const fallback = [
        path.join(publicDir, 'index.html'),
        path.join(rootDir, 'index.html'),
      ].find(p => fs.existsSync(p));

      if (fallback) {
        filePath = fallback;
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }
    }
  }

  const ext         = path.extname(filePath).toLowerCase();
  const mimeType    = MIME[ext] || 'application/octet-stream';
  const stat        = fs.statSync(filePath);
  const isAsset     = ['.css','.js','.png','.jpg','.jpeg','.gif','.svg','.ico','.woff','.woff2'].includes(ext);
  const cacheCtrl   = isAsset ? 'public, max-age=86400' : 'no-cache';

  res.writeHead(200, {
    'Content-Type':   mimeType,
    'Content-Length': stat.size,
    'Cache-Control':  cacheCtrl,
  });

  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(filePath).pipe(res);
}

module.exports = { serveStatic };
