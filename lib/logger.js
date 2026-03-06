/**
 * logger.js — file + console logger, no npm needed
 */
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');
const ERROR_FILE = path.join(LOG_DIR, 'error.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB — rotate after this

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const COLORS = {
  INFO:  '\x1b[32m',  // green
  WARN:  '\x1b[33m',  // yellow
  ERROR: '\x1b[31m',  // red
  DEBUG: '\x1b[36m',  // cyan
  RESET: '\x1b[0m',
};

function rotateLogs(filePath) {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > MAX_LOG_SIZE) {
      fs.renameSync(filePath, filePath + '.old');
    }
  } catch (_) {}
}

function write(level, message, data) {
  const ts = new Date().toISOString();
  const dataStr = data ? ' ' + JSON.stringify(data) : '';
  const plain = `[${ts}] [${level}] ${message}${dataStr}\n`;
  const colored = `${COLORS[level] || ''}[${ts}] [${level}]${COLORS.RESET} ${message}${dataStr}\n`;

  process.stdout.write(colored);

  rotateLogs(LOG_FILE);
  fs.appendFileSync(LOG_FILE, plain);

  if (level === 'ERROR') {
    rotateLogs(ERROR_FILE);
    fs.appendFileSync(ERROR_FILE, plain);
  }
}

const logger = {
  info:  (msg, data) => write('INFO',  msg, data),
  warn:  (msg, data) => write('WARN',  msg, data),
  error: (msg, data) => write('ERROR', msg, data),
  debug: (msg, data) => { if (process.env.DEBUG === '1') write('DEBUG', msg, data); },
};

module.exports = logger;
