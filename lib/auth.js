/**
 * auth.js — KisanMitra Authentication Handler
 * Handles: /api/auth/register, /api/auth/login, /api/auth/me
 * Uses: db.js (JSON file DB), simple token stored in db
 * NO external dependencies — pure Node.js
 */

const db     = require('../db');
const crypto = require('crypto');

// ── Collection for users ──────────────────────
const users = db.collection('users');

// ── Helpers ───────────────────────────────────
function sendJSON(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  });
  res.end(JSON.stringify(obj));
}

function hashPassword(pass) {
  return crypto.createHash('sha256').update(pass + 'kisanmitra_salt_2024').digest('hex');
}

function generateToken(userId) {
  return crypto.randomBytes(32).toString('hex') + '_' + userId + '_' + Date.now();
}

async function getUserFromToken(token) {
  if (!token) return null;
  // Token format: <random>_<userId>_<timestamp>
  // We store active tokens inside user record
  const allUsers = await users.find({});
  return allUsers.find(u => u.token === token) || null;
}

function getTokenFromHeader(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

function safeUser(u) {
  // Return user object without password/token
  const { password, token, ...safe } = u;
  return safe;
}

// ── Seed admin on first run ───────────────────
async function seedAdmin() {
  try {
    const existing = await users.findOne({ role: 'admin' });
    if (!existing) {
      await users.insert({
        name:     'KisanMitra Admin',
        phone:    'admin',
        email:    'admin@kisanmitra.in',
        password: hashPassword('admin123'),
        role:     'admin',
        status:   'active',
      });
      console.log('[auth] Admin seeded: phone=admin, password=admin123');
    }
  } catch (err) {
    console.error('[auth] seedAdmin failed', err.message || err);
  }
}
seedAdmin();

// ── REGISTER ──────────────────────────────────
async function handleRegister(req, res, body) {
  if (!body) return sendJSON(res, 400, { error: 'Request body required' });

  const { name, phone, email, password, role, state, district, village,
          aadhar, farmSize, crops, irrigation,
          businessName, businessType, interestedCrops } = body;

  // Validation
  if (!name || !name.trim())
    return sendJSON(res, 400, { error: 'Full name is required' });
  if (!phone || !/^\d{10}$/.test(phone.trim()))
    return sendJSON(res, 400, { error: 'Valid 10-digit mobile number is required' });
  if (!password || password.length < 6)
    return sendJSON(res, 400, { error: 'Password must be at least 6 characters' });
  if (!state || !district)
    return sendJSON(res, 400, { error: 'State and district are required' });
  if (!['farmer', 'buyer'].includes(role))
    return sendJSON(res, 400, { error: 'Role must be farmer or buyer' });

  // Check duplicates
  if (await users.findOne({ phone: phone.trim() }))
    return sendJSON(res, 409, { error: 'This mobile number is already registered' });
  if (email && email.trim() && await users.findOne({ email: email.trim().toLowerCase() }))
    return sendJSON(res, 409, { error: 'This email is already registered' });

  // Build user record
  const newUser = {
    name:      name.trim(),
    phone:     phone.trim(),
    email:     email ? email.trim().toLowerCase() : '',
    password:  hashPassword(password),
    role:      role,
    status:    'active',
    state:     state,
    district:  district.trim(),
    village:   village ? village.trim() : '',
    aadhar:    aadhar ? aadhar.trim() : '',
  };

  if (role === 'farmer') {
    newUser.farmSize   = farmSize   || '';
    newUser.crops      = crops      ? crops.trim() : '';
    newUser.irrigation = irrigation || '';
  } else {
    newUser.businessName    = businessName    ? businessName.trim()    : '';
    newUser.businessType    = businessType    || '';
    newUser.interestedCrops = interestedCrops ? interestedCrops.trim() : '';
  }

  const created = await users.insert(newUser);
  const token   = generateToken(created._id);
  await users.updateById(created._id, { token });
  created.token = token;

  return sendJSON(res, 201, {
    message: 'Registration successful',
    token,
    user: safeUser(created),
  });
}

// ── LOGIN ─────────────────────────────────────
async function handleLogin(req, res, body) {
  if (!body) return sendJSON(res, 400, { error: 'Request body required' });

  const { phone, email, password } = body;
  if (!password)    return sendJSON(res, 400, { error: 'Password is required' });
  if (!phone && !email) return sendJSON(res, 400, { error: 'Phone or email is required' });

  // Find user by phone or email
  let user = null;
  if (phone) user = await users.findOne({ phone: phone.trim() });
  if (!user && email) user = await users.findOne({ email: email.trim().toLowerCase() });

  if (!user)
    return sendJSON(res, 401, { error: 'No account found with these credentials' });

  if (user.password !== hashPassword(password))
    return sendJSON(res, 401, { error: 'Incorrect password' });

  if (user.status === 'suspended')
    return sendJSON(res, 403, { error: 'Your account has been suspended. Contact admin.' });

  // Issue new token
  const token = generateToken(user._id);
  await users.updateById(user._id, { token });

  return sendJSON(res, 200, {
    message: 'Login successful',
    token,
    user: safeUser({ ...user, token }),
  });
}

// ── ME (verify token) ─────────────────────────
async function handleMe(req, res) {
  const token = getTokenFromHeader(req);
  const user  = await getUserFromToken(token);
  if (!user)
    return sendJSON(res, 401, { error: 'Invalid or expired token' });
  return sendJSON(res, 200, { user: safeUser(user) });
}

async function verifyToken(token) {
  return getUserFromToken(token);
}

module.exports = { handleRegister, handleLogin, handleMe, verifyToken };
