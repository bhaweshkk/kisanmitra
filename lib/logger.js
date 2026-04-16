/**
 * lib/logger.js — Simple file + console logger
 */
const fs   = require('fs');
const path = require('path');

const LOG_DIR  = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

function ensureDir() {
  try { if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
}

function write(level, msg, meta) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(meta || {}) });
  const display = `[${level.toUpperCase()}] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`;
  if (level === 'error') console.error(display);
  else console.log(display);
  try { ensureDir(); fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

module.exports = {
  info:  (msg, meta) => write('info',  msg, meta),
  warn:  (msg, meta) => write('warn',  msg, meta),
  error: (msg, meta) => write('error', msg, meta),
  debug: (msg, meta) => { if (process.env.DEBUG === '1') write('debug', msg, meta); },
  LOG_FILE,
};
