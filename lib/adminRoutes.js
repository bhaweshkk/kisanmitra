/**
 * lib/adminRoutes.js — Admin dashboard API endpoints
 */
const db     = require('../db');
const fs     = require('fs');
const logger = require('./logger');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function checkAdmin(req, res) {
  const auth = req.headers['authorization'] || '';
  const pass = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (pass !== ADMIN_PASSWORD) {
    sendJSON(res, 401, { error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function handleGetContacts(req, res) {
  if (!checkAdmin(req, res)) return;
  const contacts = await db.collection('contacts').find();
  sendJSON(res, 200, { success: true, contacts, total: contacts.length });
}

async function handleGetChatlogs(req, res) {
  if (!checkAdmin(req, res)) return;
  const logs = await db.collection('chatlogs').find();
  sendJSON(res, 200, { success: true, logs, total: logs.length });
}

function handleGetLogs(req, res) {
  if (!checkAdmin(req, res)) return;
  try {
    const lines = fs.existsSync(logger.LOG_FILE)
      ? fs.readFileSync(logger.LOG_FILE, 'utf8').trim().split('\n').slice(-200).reverse()
      : [];
    sendJSON(res, 200, { success: true, logs: lines });
  } catch (e) {
    sendJSON(res, 500, { error: 'Could not read logs' });
  }
}

async function handleDbStats(req, res) {
  if (!checkAdmin(req, res)) return;
  sendJSON(res, 200, {
    success: true,
    stats: {
      users:    await db.collection('users').count(),
      contacts: await db.collection('contacts').count(),
      groups:   await db.collection('groups').count(),
      chatlogs: await db.collection('chatlogs').count(),
    },
  });
}

async function handleGetUsers(req, res) {
  if (!checkAdmin(req, res)) return;
  const users = (await db.collection('users').find()).map(u => ({ ...u, password: undefined }));
  sendJSON(res, 200, { success: true, users, total: users.length });
}

async function handleDeleteContact(req, res, id) {
  if (!checkAdmin(req, res)) return;
  const removed = await db.collection('contacts').removeById(id);
  sendJSON(res, 200, { success: true, removed });
}

function handleVerifyPassword(req, res, body) {
  const pwd = body?.password || '';
  if (pwd === ADMIN_PASSWORD) {
    sendJSON(res, 200, { success: true });
  } else {
    sendJSON(res, 401, { success: false, error: 'Incorrect password' });
  }
}

module.exports = { handleGetContacts, handleGetChatlogs, handleGetLogs, handleDbStats, handleGetUsers, handleDeleteContact, handleVerifyPassword };
