/**
 * validator.js — Startup environment validation
 * Checks config, ports, directories and prints a clear status report
 */
const fs   = require('fs');
const path = require('path');
const net  = require('net');

function check(label, value, required = false) {
  const ok = !!value;
  return { label, ok, required, value: value ? '✅ Set' : (required ? '❌ MISSING' : '⚠️  Not set (optional)') };
}

function checkDir(label, dirPath, create = true) {
  if (!fs.existsSync(dirPath)) {
    if (create) { fs.mkdirSync(dirPath, { recursive: true }); return { label, ok: true, value: '✅ Created' }; }
    return { label, ok: false, value: '❌ Missing' };
  }
  return { label, ok: true, value: '✅ Exists' };
}

function checkPort(port) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => { srv.close(); resolve(true); });
    srv.listen(port, '127.0.0.1');
  });
}

async function validate(config) {
  const logger = require('./logger');
  const checks = [];
  const warnings = [];
  let hasErrors = false;

  logger.info('══════════════════════════════════════════════════');
  logger.info('   🌾  KisanMitra — Startup Validation');
  logger.info('══════════════════════════════════════════════════');

  // ── Directory checks ──────────────────────
  const dirs = [
    checkDir('logs/',   path.join(__dirname, '..', 'logs')),
    checkDir('data/',   path.join(__dirname, '..', 'data')),
    checkDir('public/', path.join(__dirname, '..', 'public'), false),
    checkDir('certs/',  path.join(__dirname, '..', 'certs'), false),
  ];
  for (const d of dirs) {
    logger.info(`   ${d.value.includes('❌') ? '❌' : '✅'} Dir: ${d.label}`);
    if (!d.ok && d.label === 'public/') { warnings.push('public/ directory missing — static files will not be served'); }
  }

  // ── API keys ──────────────────────────────
  const keys = [
    check('ANTHROPIC_API_KEY',  process.env.ANTHROPIC_API_KEY),
    check('GEMINI_API_KEY',     process.env.GEMINI_API_KEY),
    check('OPENAI_API_KEY',     process.env.OPENAI_API_KEY),
    check('NEWSAPI_KEY',        process.env.NEWSAPI_KEY),
    check('GOOGLE_MAPS_KEY',    process.env.GOOGLE_MAPS_KEY),
  ];
  logger.info('   ─ API Keys ─');
  for (const k of keys) {
    logger.info(`   ${k.value.includes('✅') ? '✅' : '⚠️ '} ${k.label}: ${k.value}`);
  }

  // ── SMTP ──────────────────────────────────
  const smtpOk = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  logger.info(`   ${smtpOk ? '✅' : '⚠️ '} Email (SMTP): ${smtpOk ? '✅ Configured' : '⚠️  Not set — contact emails disabled'}`);

  // ── Auth secret ───────────────────────────
  const authSecure = process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16;
  logger.info(`   ${authSecure ? '✅' : '⚠️ '} AUTH_SECRET: ${authSecure ? '✅ Set' : '⚠️  Using default — set a strong secret in .env!'}`);
  if (!authSecure) warnings.push('AUTH_SECRET not set — using default secret. This is insecure for production!');

  // ── Admin password ────────────────────────
  const adminPass = process.env.ADMIN_PASSWORD;
  const adminSecure = adminPass && adminPass !== 'admin123';
  logger.info(`   ${adminSecure ? '✅' : '⚠️ '} ADMIN_PASSWORD: ${adminSecure ? '✅ Custom password set' : '⚠️  Using default "admin123" — change in .env!'}`);
  if (!adminSecure) warnings.push('ADMIN_PASSWORD is default "admin123" — change it before going live!');

  // ── HTTPS certs ───────────────────────────
  const certPath = path.join(__dirname, '..', 'certs', 'cert.pem');
  const keyPath  = path.join(__dirname, '..', 'certs', 'key.pem');
  const httpsReady = fs.existsSync(certPath) && fs.existsSync(keyPath);
  logger.info(`   ${httpsReady ? '✅' : '⚠️ '} HTTPS Certs: ${httpsReady ? '✅ Found' : '⚠️  Not found — HTTP only'}`);

  // ── apis.config.json ──────────────────────
  const apiConfigPath = path.join(__dirname, '..', 'apis.config.json');
  const apiConfigOk = fs.existsSync(apiConfigPath);
  logger.info(`   ${apiConfigOk ? '✅' : '❌'} apis.config.json: ${apiConfigOk ? '✅ Found' : '❌ Missing!'}`);
  if (!apiConfigOk) { warnings.push('apis.config.json missing — plugin system disabled'); }

  // ── Port availability ─────────────────────
  const httpPortFree  = await checkPort(config.PORT);
  const httpsPortFree = await checkPort(config.HTTPS_PORT);
  logger.info(`   ${httpPortFree ? '✅' : '❌'} Port ${config.PORT} (HTTP):  ${httpPortFree ? '✅ Available' : '❌ IN USE — change PORT in .env'}`);
  if (httpsReady) logger.info(`   ${httpsPortFree ? '✅' : '❌'} Port ${config.HTTPS_PORT} (HTTPS): ${httpsPortFree ? '✅ Available' : '❌ IN USE — change HTTPS_PORT in .env'}`);
  if (!httpPortFree) { hasErrors = true; }

  // ── Summary ───────────────────────────────
  if (warnings.length) {
    logger.info('   ─ Warnings ─');
    for (const w of warnings) logger.warn(`   ⚠️  ${w}`);
  }

  logger.info('══════════════════════════════════════════════════');

  if (hasErrors) {
    logger.error('❌ Critical startup errors found above. Server cannot start.');
    process.exit(1);
  }

  return { warnings, httpsReady };
}

module.exports = { validate };
