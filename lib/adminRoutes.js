/**
 * adminRoutes.js — protected admin API endpoints
 * Password protected via ADMIN_PASSWORD env var
 */
const fs   = require('fs');
const path = require('path');
const db   = require('./db');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function checkAuth(req) {
  // Basic auth header: "Authorization: Bearer <password>"
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (token === ADMIN_PASSWORD) return true;
  // Also accept ?key=password in URL
  const u = new URL('http://x' + req.url);
  return u.searchParams.get('key') === ADMIN_PASSWORD;
}

function requireAuth(req, res) {
  if (checkAuth(req)) return true;
  sendJSON(res, 401, { error: 'Unauthorized. Provide Authorization: Bearer <ADMIN_PASSWORD>' });
  return false;
}

// GET /api/admin/contacts
function handleGetContacts(req, res) {
  if (!requireAuth(req, res)) return;
  const contacts = db.contacts.find({}, { sort: { createdAt: -1 }, limit: 200 });
  sendJSON(res, 200, contacts);
}

// DELETE /api/admin/contacts/:id
function handleDeleteContact(req, res, id) {
  if (!requireAuth(req, res)) return;
  const count = db.contacts.deleteById(id);
  sendJSON(res, 200, { deleted: count });
}

// GET /api/admin/chatlogs
function handleGetChatlogs(req, res) {
  if (!requireAuth(req, res)) return;
  const logs = db.chatLogs.find({}, { sort: { createdAt: -1 }, limit: 100 });
  sendJSON(res, 200, logs);
}

// GET /api/admin/logs  (last N lines of server.log)
function handleGetLogs(req, res) {
  if (!requireAuth(req, res)) return;
  const u = new URL('http://x' + req.url);
  const n = parseInt(u.searchParams.get('lines') || '100');
  const logFile = path.join(__dirname, '..', 'logs', 'server.log');

  if (!fs.existsSync(logFile)) {
    sendJSON(res, 200, { lines: [], message: 'No log file yet' });
    return;
  }

  const content = fs.readFileSync(logFile, 'utf8');
  const lines = content.split('\n').filter(Boolean).slice(-n);
  sendJSON(res, 200, { lines, total: lines.length });
}

// GET /api/admin/db-stats
function handleDbStats(req, res) {
  if (!requireAuth(req, res)) return;
  sendJSON(res, 200, db.stats());
}

// POST /api/admin/clear-cache  (placeholder — cache is per-module)
function handleClearCache(req, res) {
  if (!requireAuth(req, res)) return;
  sendJSON(res, 200, { message: 'Cache clear signal sent. Restart server to fully clear.' });
}

module.exports = {
  handleGetContacts,
  handleDeleteContact,
  handleGetChatlogs,
  handleGetLogs,
  handleDbStats,
  handleClearCache,
};
