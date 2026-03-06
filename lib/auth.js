/**
 * auth.js — User authentication system
 * Features: register, login, JWT-like tokens (HMAC signed), middleware
 * Zero npm dependencies — uses Node.js built-in crypto
 */
const crypto = require('crypto');
const db     = require('./db');
const logger = require('./logger');

const SECRET = process.env.AUTH_SECRET || 'kisanmitra-secret-change-in-production';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Crypto helpers ────────────────────────────
function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const { hash: computed } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
}

function makeToken(payload) {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body    = Buffer.from(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const sig     = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Date.now()) return null; // expired
    return payload;
  } catch { return null; }
}

function extractToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  // Also accept cookie
  const cookies = req.headers['cookie'] || '';
  const match = cookies.match(/km_token=([^;]+)/);
  return match ? match[1] : null;
}

// ── DB helpers ────────────────────────────────
function getUserByPhone(phone) { return db.collection('users').findOne({ phone }); }
function getUserById(id)       { return db.collection('users').findById(id); }

// ── Route Handlers ────────────────────────────
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

async function handleRegister(req, res, body) {
  const { name, phone, password, state, role = 'farmer' } = body || {};

  if (!name || !phone || !password) {
    return sendJSON(res, 400, { error: 'name, phone, and password are required' });
  }
  if (!/^[6-9]\d{9}$/.test(phone)) {
    return sendJSON(res, 400, { error: 'Invalid Indian mobile number (10 digits starting with 6-9)' });
  }
  if (password.length < 6) {
    return sendJSON(res, 400, { error: 'Password must be at least 6 characters' });
  }
  if (getUserByPhone(phone)) {
    return sendJSON(res, 409, { error: 'Phone number already registered' });
  }

  const { hash, salt } = hashPassword(password);
  const user = db.collection('users').insert({ name, phone, hash, salt, state: state || '', role, verified: false });
  const token = makeToken({ userId: user._id, phone, role });

  logger.info('New user registered', { name, phone, role });
  sendJSON(res, 201, {
    success: true,
    token,
    user: { _id: user._id, name, phone, state, role },
  });
}

async function handleLogin(req, res, body) {
  const { phone, password } = body || {};
  if (!phone || !password) return sendJSON(res, 400, { error: 'phone and password are required' });

  const user = getUserByPhone(phone);
  if (!user || !verifyPassword(password, user.hash, user.salt)) {
    return sendJSON(res, 401, { error: 'Invalid phone or password' });
  }

  const token = makeToken({ userId: user._id, phone: user.phone, role: user.role });
  logger.info('User logged in', { phone, role: user.role });
  sendJSON(res, 200, {
    success: true,
    token,
    user: { _id: user._id, name: user.name, phone: user.phone, state: user.state, role: user.role },
  });
}

function handleMe(req, res) {
  const token = extractToken(req);
  if (!token) return sendJSON(res, 401, { error: 'Not authenticated' });

  const payload = verifyToken(token);
  if (!payload) return sendJSON(res, 401, { error: 'Invalid or expired token' });

  const user = getUserById(payload.userId);
  if (!user) return sendJSON(res, 404, { error: 'User not found' });

  sendJSON(res, 200, { _id: user._id, name: user.name, phone: user.phone, state: user.state, role: user.role, createdAt: user.createdAt });
}

// ── Middleware ────────────────────────────────
function requireAuth(req, res) {
  const token = extractToken(req);
  if (!token) { sendJSON(res, 401, { error: 'Authentication required' }); return null; }
  const payload = verifyToken(token);
  if (!payload) { sendJSON(res, 401, { error: 'Invalid or expired token. Please login again.' }); return null; }
  return payload;
}

module.exports = { handleRegister, handleLogin, handleMe, requireAuth, verifyToken, extractToken };
