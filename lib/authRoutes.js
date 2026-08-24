const auth = require('./auth');

async function handleAuthRoutes(req, res, pathname, method, body) {
  // Email/Phone Password Registration
  if (pathname === '/api/auth/register' && method === 'POST') {
    await auth.handleRegister(req, res, body);
    return true;
  }

  // Email/Phone Password Login
  if (pathname === '/api/auth/login' && method === 'POST') {
    await auth.handleLogin(req, res, body);
    return true;
  }

  // Get current user
  if (pathname === '/api/auth/me' && method === 'GET') {
    await auth.handleMe(req, res);
    return true;
  }

  // Google OAuth: Get login URL
  if (pathname === '/api/auth/google' && method === 'GET') {
    const googleAuthUrl = auth.getGoogleAuthUrl();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: googleAuthUrl }));
    return true;
  }

  // Google OAuth: Callback handler
  if (pathname === '/api/auth/google/callback' && method === 'POST') {
    const { code } = body || {};
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Authorization code required' }));
      return true;
    }
    await auth.handleGoogleCallback(req, res, code);
    return true;
  }

  // Email verification: Send or verify code
  if (pathname === '/api/auth/email-verify' && method === 'POST') {
    await auth.handleEmailVerification(req, res, body);
    return true;
  }

  // Email-based registration
  if (pathname === '/api/auth/email-register' && method === 'POST') {
    await auth.handleEmailRegister(req, res, body);
    return true;
  }

  // Check if email is available
  if (pathname === '/api/auth/check-email' && method === 'POST') {
    const { email } = body || {};
    if (!email) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Email required' }));
      return true;
    }
    
    const db = require('./db');
    const users = db.collection('users');
    const existing = await users.findOne({ email: email.toLowerCase() });
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ available: !existing }));
    return true;
  }

  // Check if phone is available
  if (pathname === '/api/auth/check-phone' && method === 'POST') {
    const { phone } = body || {};
    if (!phone) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Phone required' }));
      return true;
    }
    
    const db = require('./db');
    const users = db.collection('users');
    const existing = await users.findOne({ phone: phone.trim() });
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ available: !existing }));
    return true;
  }

  return false;
}

module.exports = { handleAuthRoutes };
