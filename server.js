/**
 * KisanMitra Production Server v5
 */
const { loadEnv } = require('./lib/env');
loadEnv();
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');
const RateLimiter = require('./lib/rateLimiter');
const { serveStatic } = require('./lib/staticServer');
const routes = require('./lib/routes');
const adminRoutes = require('./lib/adminRoutes');
const apiRegistry = require('./lib/apiRegistry');
const auth = require('./lib/auth');
const { validate } = require('./lib/validator');

const CONFIG = {
  PORT:            parseInt(process.env.PORT) || 3000,
  HTTPS_PORT:      parseInt(process.env.HTTPS_PORT) || 3443,
  HOST:            process.env.HOST || '0.0.0.0',
  GROQ_API_KEY:    process.env.GROQ_API_KEY || '',
  PUBLIC_DIR:      path.join(__dirname, 'public'),
  CERT_DIR:        path.join(__dirname, 'certs'),
  MAX_REQ_PER_MIN: parseInt(process.env.MAX_REQ_PER_MIN) || 60,
  ENABLE_HTTPS:    fs.existsSync(path.join(__dirname, 'certs', 'cert.pem')),
};

const rateLimiter = new RateLimiter({ windowMs: 60000, maxRequests: CONFIG.MAX_REQ_PER_MIN, blockDurationMs: 60000 });
const ctx = { config: CONFIG, rateLimiter };

function addSecurityHeaders(res, isHttps) {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Powered-By', 'KisanMitra');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (isHttps) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function parseBody(req, maxBytes) {
  maxBytes = maxBytes || 2097152;
  return new Promise(function(resolve, reject) {
    var body = '', size = 0;
    req.on('data', function(c) {
      size += c.length;
      if (size > maxBytes) { reject(new Error('Body too large')); req.destroy(); return; }
      body += c;
    });
    req.on('end', function() {
      if (!body) { resolve({}); return; }
      try { resolve(JSON.parse(body)); } catch(e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

async function router(req, res, isHttps) {
  const method = req.method.toUpperCase();
  const pathname = req.url.split('?')[0];
  addSecurityHeaders(res, isHttps);

  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' });
    res.end(); return;
  }

  // Auth
  if (pathname === '/api/auth/send-otp' && method === 'POST') { const b = await parseBody(req).catch(()=>({})); await auth.handleSendOTP(req, res, b); return; }
  if (pathname === '/api/auth/register'  && method === 'POST') { const b = await parseBody(req).catch(()=>({})); await auth.handleRegister(req, res, b); return; }
  if (pathname === '/api/auth/login'     && method === 'POST') { const b = await parseBody(req).catch(()=>({})); await auth.handleLogin(req, res, b); return; }
  if (pathname === '/api/auth/me'        && method === 'GET')  { auth.handleMe(req, res); return; }
  if (pathname === '/api/auth/logout'    && method === 'POST') { auth.handleLogout(req, res); return; }

  // Admin
  if (pathname === '/admin' && method === 'GET') { serveStatic({ url: '/admin.html', method: 'GET', headers: req.headers }, res, CONFIG.PUBLIC_DIR); return; }
  if (pathname === '/api/admin/contacts' && method === 'GET')  { adminRoutes.handleGetContacts(req, res); return; }
  if (pathname === '/api/admin/chatlogs' && method === 'GET')  { adminRoutes.handleGetChatlogs(req, res); return; }
  if (pathname === '/api/admin/logs'     && method === 'GET')  { adminRoutes.handleGetLogs(req, res); return; }
  if (pathname === '/api/admin/db-stats' && method === 'GET')  { adminRoutes.handleDbStats(req, res); return; }
  if (pathname === '/api/admin/users'    && method === 'GET')  { adminRoutes.handleGetUsers(req, res); return; }
  if (pathname.startsWith('/api/admin/contacts/') && method === 'DELETE') { adminRoutes.handleDeleteContact(req, res, pathname.split('/').pop()); return; }

  // Core
  if (pathname === '/api/health'  && method === 'GET')  { routes.handleHealth(req, res, ctx); return; }
  if (pathname === '/api/chat'    && method === 'POST')  { await routes.handleChat(req, res, ctx); return; }
  if (pathname === '/api/weather' && method === 'GET')   { await routes.handleWeather(req, res); return; }
  if (pathname === '/api/mandi'   && method === 'GET')   { await routes.handleMandi(req, res); return; }
  if (pathname === '/api/news'    && method === 'GET')   { await routes.handleNews(req, res); return; }
  if (pathname === '/api/contact' && method === 'POST')  { await routes.handleContact(req, res); return; }
  if (pathname === '/api/groups'  && method === 'GET')   { routes.handleGroups(req, res); return; }
  if (pathname === '/api/groups'  && method === 'POST')  { await routes.handleCreateGroup(req, res); return; }

  // Community
  if (pathname === '/api/community/members' && method === 'GET') { routes.handleCommunityMembers(req, res); return; }
  if (pathname.startsWith('/api/community/groups/') && pathname.endsWith('/messages')) {
    const groupId = pathname.split('/')[4];
    let body = null;
    if (method === 'POST') { try { body = await parseBody(req); } catch(e) { routes.sendJSON(res, 400, { error: e.message }); return; } }
    await routes.handleGroupMessages(req, res, groupId, method, body); return;
  }
  if (pathname === '/api/community/dm' && method === 'POST') { const b = await parseBody(req).catch(()=>({})); await routes.handleDM(req, res, 'POST', b, null); return; }
  if (pathname.startsWith('/api/community/dm/') && method === 'GET') { await routes.handleDM(req, res, 'GET', null, pathname.split('/')[4]); return; }

  // Plugins
  if (pathname === '/api/plugins' && method === 'GET') { apiRegistry.handleListPlugins(req, res); return; }
  if (pathname.startsWith('/api/plugins/')) {
    let body = null;
    if (method === 'POST') { try { body = await parseBody(req); } catch(e) { routes.sendJSON(res, 400, { error: e.message }); return; } }
    const matched = await apiRegistry.handlePluginRoute(req, res, pathname, body);
    if (matched !== false) return;
    routes.sendJSON(res, 404, { error: 'No plugin: ' + pathname }); return;
  }

  if (pathname.startsWith('/api/')) { routes.sendJSON(res, 404, { error: 'Not found: ' + method + ' ' + pathname }); return; }
  if (method === 'GET' || method === 'HEAD') { serveStatic(req, res, CONFIG.PUBLIC_DIR); return; }
  routes.sendJSON(res, 405, { error: 'Method not allowed' });
}

function makeHandler(isHttps) {
  return function(req, res) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const start = Date.now();
    const limit = rateLimiter.check(ip);
    if (!limit.allowed) { res.setHeader('Retry-After', limit.retryAfter); routes.sendJSON(res, 429, { error: 'Too many requests' }); return; }
    router(req, res, isHttps)
      .catch(function(err) { logger.error('Router error', { url: req.url, message: err.message }); if (!res.headersSent) routes.sendJSON(res, 500, { error: 'Internal server error' }); })
      .finally(function() { logger.info(req.method + ' ' + req.url + ' ' + res.statusCode + ' ' + (Date.now()-start) + 'ms', { ip: ip.slice(0,20) }); });
  };
}

const openConnections = new Set();
function trackConn(srv) { srv.on('connection', function(s) { openConnections.add(s); s.on('close', function() { openConnections.delete(s); }); }); }

validate(CONFIG).then(function() {
  const httpServer = http.createServer(makeHandler(false));
  trackConn(httpServer);
  httpServer.listen(CONFIG.PORT, CONFIG.HOST, function() { logger.info('HTTP → http://localhost:' + CONFIG.PORT); });
  httpServer.on('error', function(err) { logger.error('HTTP error', { code: err.code }); if (err.code === 'EADDRINUSE') process.exit(1); });

  if (CONFIG.ENABLE_HTTPS) {
    try {
      const httpsServer = https.createServer({ key: fs.readFileSync(path.join(CONFIG.CERT_DIR,'key.pem')), cert: fs.readFileSync(path.join(CONFIG.CERT_DIR,'cert.pem')) }, makeHandler(true));
      trackConn(httpsServer);
      httpsServer.listen(CONFIG.HTTPS_PORT, CONFIG.HOST, function() { logger.info('HTTPS → https://localhost:' + CONFIG.HTTPS_PORT); });
    } catch(e) { logger.warn('HTTPS disabled', { message: e.message }); }
  }

  logger.info('══════════════════════════════════════════════════');
  logger.info('   KisanMitra v5 — All systems ready!');
  logger.info('   Website : http://localhost:' + CONFIG.PORT);
  logger.info('   Login   : http://localhost:' + CONFIG.PORT + '/login.html');
  logger.info('   Admin   : http://localhost:' + CONFIG.PORT + '/admin');
  logger.info('   Health  : http://localhost:' + CONFIG.PORT + '/api/health');
  logger.info('══════════════════════════════════════════════════');

  function shutdown(sig) {
    logger.info(sig + ' shutting down...');
    for (const s of openConnections) s.destroy();
    setTimeout(function() { process.exit(0); }, 1000).unref();
  }
  process.on('SIGTERM', function() { shutdown('SIGTERM'); });
  process.on('SIGINT',  function() { shutdown('SIGINT'); });
});

process.on('unhandledRejection', function(r) { logger.error('Unhandled rejection', { reason: String(r) }); });
process.on('uncaughtException',  function(e) { logger.error('Uncaught exception', { message: e.message }); process.exit(1); });
