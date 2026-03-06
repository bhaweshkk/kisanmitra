/**
 * mailer.js — Email notifications via SMTP
 * Supports: Gmail, Outlook, custom SMTP — no npm needed
 * Uses Node.js built-in net/tls for raw SMTP
 *
 * Config in .env:
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=587
 *   SMTP_USER=you@gmail.com
 *   SMTP_PASS=your_app_password   ← Gmail: use App Password, not account password
 *   SMTP_FROM=KisanMitra <you@gmail.com>
 *   NOTIFY_EMAIL=admin@example.com
 */
const net    = require('net');
const tls    = require('tls');
const logger = require('./logger');

const CONFIG = {
  host:  process.env.SMTP_HOST || '',
  port:  parseInt(process.env.SMTP_PORT) || 587,
  user:  process.env.SMTP_USER || '',
  pass:  process.env.SMTP_PASS || '',
  from:  process.env.SMTP_FROM || process.env.SMTP_USER || '',
  admin: process.env.NOTIFY_EMAIL || process.env.SMTP_USER || '',
};

function isConfigured() {
  return !!(CONFIG.host && CONFIG.user && CONFIG.pass);
}

// ── Raw SMTP client ───────────────────────────
function smtpSend({ to, subject, html, text }) {
  return new Promise((resolve, reject) => {
    if (!isConfigured()) {
      reject(new Error('SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env'));
      return;
    }

    const boundary = 'km' + Date.now();
    const body = [
      'From: ' + CONFIG.from,
      'To: ' + to,
      'Subject: ' + subject,
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="' + boundary + '"',
      '',
      '--' + boundary,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      text || subject,
      '',
      '--' + boundary,
      'Content-Type: text/html; charset=UTF-8',
      '',
      html || '<p>' + subject + '</p>',
      '',
      '--' + boundary + '--',
    ].join('\r\n');

    const b64user = Buffer.from(CONFIG.user).toString('base64');
    const b64pass = Buffer.from(CONFIG.pass).toString('base64');

    let step = 0;
    const steps = [
      { expect: '220', send: `EHLO kisanmitra\r\n` },
      { expect: '250', send: `STARTTLS\r\n` },        // step 1 — upgrade to TLS
      { expect: '220', send: null, upgrade: true },   // step 2 — TLS handshake
      { expect: '250', send: `EHLO kisanmitra\r\n` }, // step 3 — re-EHLO over TLS
      { expect: '250', send: `AUTH LOGIN\r\n` },
      { expect: '334', send: b64user + '\r\n' },
      { expect: '334', send: b64pass + '\r\n' },
      { expect: '235', send: `MAIL FROM:<${CONFIG.user}>\r\n` },
      { expect: '250', send: `RCPT TO:<${to}>\r\n` },
      { expect: '250', send: `DATA\r\n` },
      { expect: '354', send: body + '\r\n.\r\n' },
      { expect: '250', send: `QUIT\r\n` },
    ];

    let socket = net.createConnection(CONFIG.port, CONFIG.host);
    let tlsSocket = null;
    let activeSocket = socket;

    function write(data) { activeSocket.write(data); }

    function onData(data) {
      const line = data.toString();
      const current = steps[step];
      if (!current) return;

      if (!line.startsWith(current.expect)) {
        reject(new Error(`SMTP error at step ${step}: expected ${current.expect}, got: ${line.trim()}`));
        activeSocket.destroy();
        return;
      }

      step++;
      const next = steps[step];
      if (!next) { resolve({ success: true, to }); activeSocket.destroy(); return; }

      if (next.upgrade) {
        // Upgrade to TLS
        tlsSocket = tls.connect({ socket, host: CONFIG.host, servername: CONFIG.host }, () => {
          activeSocket = tlsSocket;
          tlsSocket.on('data', onData);
          step++;
          write(steps[step].send);
        });
        tlsSocket.on('error', reject);
      } else {
        write(next.send);
      }
    }

    socket.on('data', (data) => { if (!tlsSocket) onData(data); });
    socket.on('error', reject);
    socket.setTimeout(15000, () => { socket.destroy(); reject(new Error('SMTP timeout')); });
  });
}

// ── Email Templates ───────────────────────────
function templateContactForm({ name, phone, message }) {
  return {
    subject: `🌾 New Contact: ${name} (${phone})`,
    text: `New contact form submission on KisanMitra:\n\nName: ${name}\nPhone: ${phone}\nMessage: ${message}\n\nTimestamp: ${new Date().toISOString()}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f0fdf4;padding:20px;border-radius:12px">
        <div style="background:linear-gradient(135deg,#064e3b,#059669);color:white;padding:20px;border-radius:8px;text-align:center;margin-bottom:20px">
          <h2 style="margin:0">🌾 KisanMitra — New Contact</h2>
        </div>
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
          <tr><td style="padding:14px 20px;border-bottom:1px solid #f1f5f9;font-weight:bold;color:#374151;width:120px">👤 Name</td><td style="padding:14px 20px;border-bottom:1px solid #f1f5f9;color:#1f2937">${name}</td></tr>
          <tr><td style="padding:14px 20px;border-bottom:1px solid #f1f5f9;font-weight:bold;color:#374151">📱 Phone</td><td style="padding:14px 20px;border-bottom:1px solid #f1f5f9;color:#1f2937">${phone}</td></tr>
          <tr><td style="padding:14px 20px;font-weight:bold;color:#374151;vertical-align:top">💬 Message</td><td style="padding:14px 20px;color:#1f2937">${message}</td></tr>
        </table>
        <p style="color:#6b7280;font-size:12px;text-align:center;margin-top:16px">Sent from KisanMitra Server • ${new Date().toLocaleString('en-IN')}</p>
      </div>`,
  };
}

function templateNewUser({ name, phone, role }) {
  return {
    subject: `🌾 New ${role} registered: ${name}`,
    text: `New user registered on KisanMitra:\n\nName: ${name}\nPhone: ${phone}\nRole: ${role}\nTime: ${new Date().toISOString()}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f0fdf4;padding:20px;border-radius:12px">
        <div style="background:linear-gradient(135deg,#064e3b,#059669);color:white;padding:20px;border-radius:8px;text-align:center;margin-bottom:20px">
          <h2 style="margin:0">🌾 New ${role === 'farmer' ? '👨‍🌾 Farmer' : '🛒 Buyer'} Registered</h2>
        </div>
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
          <tr><td style="padding:14px 20px;border-bottom:1px solid #f1f5f9;font-weight:bold;color:#374151;width:120px">👤 Name</td><td style="padding:14px 20px;border-bottom:1px solid #f1f5f9">${name}</td></tr>
          <tr><td style="padding:14px 20px;font-weight:bold;color:#374151">📱 Phone</td><td style="padding:14px 20px">${phone}</td></tr>
        </table>
        <p style="color:#6b7280;font-size:12px;text-align:center;margin-top:16px">KisanMitra Server • ${new Date().toLocaleString('en-IN')}</p>
      </div>`,
  };
}

// ── Public API ────────────────────────────────
async function notifyContact(data) {
  if (!isConfigured() || !CONFIG.admin) return;
  try {
    await smtpSend({ to: CONFIG.admin, ...templateContactForm(data) });
    logger.info('Email sent: contact notification', { to: CONFIG.admin });
  } catch (e) {
    logger.warn('Email failed (contact)', { message: e.message });
  }
}

async function notifyNewUser(data) {
  if (!isConfigured() || !CONFIG.admin) return;
  try {
    await smtpSend({ to: CONFIG.admin, ...templateNewUser(data) });
    logger.info('Email sent: new user notification', { to: CONFIG.admin });
  } catch (e) {
    logger.warn('Email failed (new user)', { message: e.message });
  }
}

async function sendEmail({ to, subject, html, text }) {
  return smtpSend({ to, subject, html, text });
}

module.exports = { notifyContact, notifyNewUser, sendEmail, isConfigured };
