#!/usr/bin/env node

/**
 * KisanMitra Server Process Manager
 * Provides auto-restart functionality and monitoring
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVER_SCRIPT = path.join(__dirname, 'server.js');
const LOG_FILE = path.join(__dirname, 'logs', 'process-manager.log');
const MAX_RESTARTS = 10;
const RESTART_DELAY = 5000; // 5 seconds

let restartCount = 0;
let serverProcess = null;
let startTime = Date.now();

function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;

  console.log(logMessage.trim());

  try {
    fs.appendFileSync(LOG_FILE, logMessage);
  } catch (err) {
    console.error('Failed to write to log file:', err.message);
  }
}

function ensureLogDirectory() {
  const logDir = path.dirname(LOG_FILE);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

function startServer() {
  log(`Starting KisanMitra server (attempt ${restartCount + 1}/${MAX_RESTARTS})`);

  serverProcess = spawn('node', [SERVER_SCRIPT], {
    stdio: ['inherit', 'inherit', 'inherit'],
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: 'production' }
  });

  serverProcess.on('exit', (code, signal) => {
    const uptime = Math.round((Date.now() - startTime) / 1000);
    log(`Server exited with code ${code}, signal ${signal}, uptime: ${uptime}s`);

    if (code !== 0 && code !== null) {
      // Unexpected exit
      restartCount++;
      if (restartCount < MAX_RESTARTS) {
        log(`Restarting server in ${RESTART_DELAY}ms...`);
        setTimeout(startServer, RESTART_DELAY);
      } else {
        log('Max restart attempts reached. Giving up.', 'ERROR');
        process.exit(1);
      }
    } else {
      // Normal exit
      log('Server stopped normally');
      process.exit(0);
    }
  });

  serverProcess.on('error', (err) => {
    log(`Failed to start server: ${err.message}`, 'ERROR');
    restartCount++;
    if (restartCount < MAX_RESTARTS) {
      setTimeout(startServer, RESTART_DELAY);
    } else {
      process.exit(1);
    }
  });

  startTime = Date.now();
}

function shutdown() {
  log('Process manager shutting down...');

  if (serverProcess) {
    serverProcess.kill('SIGTERM');

    // Give it time to shut down gracefully
    setTimeout(() => {
      if (!serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
      process.exit(0);
    }, 10000);
  } else {
    process.exit(0);
  }
}

// Handle shutdown signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function main() {
  ensureLogDirectory();
  log('=== KisanMitra Process Manager Started ===');
  log(`Max restarts: ${MAX_RESTARTS}, Restart delay: ${RESTART_DELAY}ms`);

  startServer();
}

if (require.main === module) {
  main();
}

module.exports = { startServer, shutdown };
