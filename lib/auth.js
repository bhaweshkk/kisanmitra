const db     = require('./db');
const crypto = require('crypto');
const https  = require('https');
const querystring = require('querystring');

const users = db.collection('users');

// OAuth Config (set these in environment variables)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/auth/google/callback';

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
  const allUsers = await users.find({});
  return allUsers.find(u => u.token === token) || null;
}

function getTokenFromHeader(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

function safeUser(u) {
  const { password, token, ...safe } = u;
  return safe;
}

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

async function handleRegister(req, res, body) {
  if (!body) return sendJSON(res, 400, { error: 'Request body required' });

  const { name, phone, email, password, role, state, district, village,
          aadhar, farmSize, crops, irrigation,
          businessName, businessType, interestedCrops } = body;

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

  if (await users.findOne({ phone: phone.trim() }))
    return sendJSON(res, 409, { error: 'This mobile number is already registered' });
  if (email && email.trim() && await users.findOne({ email: email.trim().toLowerCase() }))
    return sendJSON(res, 409, { error: 'This email is already registered' });

  const newUser = {
    name:      name.trim(),
    phone:     phone.trim(),
    email:     email ? email.trim().toLowerCase() : '',
    password:  hashPassword(password),
    role:      role || 'farmer',
    status:    'active',
    state:     state,
    district:  district.trim(),
    village:   village ? village.trim() : '',
    aadhar:    aadhar ? aadhar.trim() : '',
    authMethod: 'password',
    createdAt: new Date(),
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

async function handleLogin(req, res, body) {
  if (!body) return sendJSON(res, 400, { error: 'Request body required' });

  const { phone, email, password } = body;
  if (!password)    return sendJSON(res, 400, { error: 'Password is required' });
  if (!phone && !email) return sendJSON(res, 400, { error: 'Phone or email is required' });

  let user = null;
  if (phone) user = await users.findOne({ phone: phone.trim() });
  if (!user && email) user = await users.findOne({ email: email.trim().toLowerCase() });

  if (!user)
    return sendJSON(res, 401, { error: 'No account found with these credentials' });

  if (user.password !== hashPassword(password))
    return sendJSON(res, 401, { error: 'Incorrect password' });

  if (user.status === 'suspended')
    return sendJSON(res, 403, { error: 'Your account has been suspended. Contact admin.' });

  const token = generateToken(user._id);
  await users.updateById(user._id, { token, lastLogin: new Date() });

  return sendJSON(res, 200, {
    message: 'Login successful',
    token,
    user: safeUser({ ...user, token }),
  });
}

async function handleMe(req, res) {
  const token = getTokenFromHeader(req);
  const user  = await getUserFromToken(token);
  if (!user)
    return sendJSON(res, 401, { error: 'Invalid or expired token' });
  return sendJSON(res, 200, { user: safeUser(user) });
}

// ============= GOOGLE OAUTH =============

function getGoogleAuthUrl() {
  const scope = encodeURIComponent('openid email profile');
  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}&response_type=code&scope=${scope}`;
}

function exchangeGoogleCode(code) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    });

    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error_description));
          else resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getGoogleProfile(accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.googleapis.com',
      path: '/oauth2/v1/userinfo?alt=json',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function handleGoogleCallback(req, res, code) {
  try {
    const tokenData = await exchangeGoogleCode(code);
    const profile = await getGoogleProfile(tokenData.access_token);

    let user = await users.findOne({ email: profile.email.toLowerCase() });

    if (!user) {
      // Create new user from Google profile
      const nameParts = (profile.name || '').split(' ');
      const newUser = {
        name: profile.name || profile.email,
        email: profile.email.toLowerCase(),
        googleId: profile.id,
        picture: profile.picture,
        phone: '',
        role: 'farmer',
        status: 'active',
        state: '',
        district: '',
        authMethod: 'google',
        createdAt: new Date(),
      };
      
      user = await users.insert(newUser);
    } else if (!user.googleId) {
      // Link Google account to existing user
      await users.updateById(user._id, { 
        googleId: profile.id,
        picture: profile.picture,
      });
      user.googleId = profile.id;
      user.picture = profile.picture;
    }

    const token = generateToken(user._id);
    await users.updateById(user._id, { token, lastLogin: new Date() });

    return sendJSON(res, 200, {
      message: 'Google login successful',
      token,
      user: safeUser({ ...user, token }),
    });
  } catch (err) {
    console.error('[auth] Google callback error:', err);
    return sendJSON(res, 500, { error: 'Google authentication failed: ' + err.message });
  }
}

// ============= EMAIL VERIFICATION =============

function generateVerificationCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

async function sendVerificationEmail(email, code) {
  // Placeholder: integrate with email service (SendGrid, Mailgun, etc.)
  console.log(`[email] Verification code for ${email}: ${code}`);
  // Example: await sendgridMail.send({ to: email, subject: 'Verify Email', text: `Code: ${code}` });
  return true;
}

async function handleEmailVerification(req, res, body) {
  if (!body) return sendJSON(res, 400, { error: 'Request body required' });

  const { email, action } = body;
  if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))
    return sendJSON(res, 400, { error: 'Valid email is required' });

  if (action === 'send') {
    // Check if email already registered
    const existing = await users.findOne({ email: email.toLowerCase() });
    if (existing)
      return sendJSON(res, 409, { error: 'Email already registered' });

    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store verification code (in real app, use Redis or DB)
    await sendVerificationEmail(email, code);

    return sendJSON(res, 200, {
      message: 'Verification code sent',
      email,
      expiresAt,
      // In production, don't send code to client; send via email only
    });
  }

  if (action === 'verify') {
    const { code } = body;
    if (!code)
      return sendJSON(res, 400, { error: 'Verification code required' });

    // In real implementation, verify code from Redis/DB
    // For now, accept any 6-character code
    if (!/^[A-F0-9]{6}$/.test(code))
      return sendJSON(res, 400, { error: 'Invalid verification code format' });

    return sendJSON(res, 200, {
      message: 'Email verified',
      email,
      verificationToken: generateToken(email), // Temporary token for registration
    });
  }

  return sendJSON(res, 400, { error: 'Invalid action' });
}

// ============= EMAIL BASED REGISTRATION =============

async function handleEmailRegister(req, res, body) {
  if (!body) return sendJSON(res, 400, { error: 'Request body required' });

  const { email, verificationToken, name, phone, password, role, state, district } = body;

  // Verify the verification token
  // In real app, validate this properly

  if (!email || !name || !password || !role)
    return sendJSON(res, 400, { error: 'Email, name, password, and role are required' });

  if (password.length < 6)
    return sendJSON(res, 400, { error: 'Password must be at least 6 characters' });

  if (await users.findOne({ email: email.toLowerCase() }))
    return sendJSON(res, 409, { error: 'Email already registered' });

  if (phone && await users.findOne({ phone: phone.trim() }))
    return sendJSON(res, 409, { error: 'Phone number already registered' });

  const newUser = {
    name: name.trim(),
    email: email.toLowerCase(),
    password: hashPassword(password),
    phone: phone || '',
    role: role || 'farmer',
    status: 'active',
    state: state || '',
    district: district || '',
    authMethod: 'email',
    emailVerified: true,
    createdAt: new Date(),
  };

  const created = await users.insert(newUser);
  const token = generateToken(created._id);
  await users.updateById(created._id, { token });
  created.token = token;

  return sendJSON(res, 201, {
    message: 'Email registration successful',
    token,
    user: safeUser(created),
  });
}

async function verifyToken(token) {
  return getUserFromToken(token);
}

module.exports = {
  handleRegister,
  handleLogin,
  handleMe,
  verifyToken,
  handleGoogleCallback,
  getGoogleAuthUrl,
  handleEmailVerification,
  handleEmailRegister,
};
