/**
 * routes.js — all API route handlers
 */
const { request } = require('./httpHelper');
const Cache = require('./cache');
const logger = require('./logger');
const db     = require('./db');
const mailer = require('./mailer');

const weatherCache = new Cache({ ttlMs: 10 * 60 * 1000 }); // 10 min
const mandiCache   = new Cache({ ttlMs: 30 * 60 * 1000 }); // 30 min
const newsCache    = new Cache({ ttlMs: 15 * 60 * 1000 }); // 15 min

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function parseBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '', size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('Request body too large')); req.destroy(); return; }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// ─────────────────────────────────────────────
// ROUTE: GET /api/health
// ─────────────────────────────────────────────
function handleHealth(req, res, ctx) {
  const dbStats = {};
  try {
    const db = require('./db');
    dbStats.contacts = db.contacts.count();
    dbStats.chatlogs = db.chatLogs.count();
  } catch(_) {}

  sendJSON(res, 200, {
    status: 'ok',
    version: '3.0.0',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    apiKeyConfigured: !!ctx.config.ANTHROPIC_API_KEY,
    db: dbStats,
    cache: {
      weather: weatherCache.stats(),
      mandi:   mandiCache.stats(),
      news:    newsCache.stats(),
    },
    rateLimit: ctx.rateLimiter.stats(),
  });
}

// ─────────────────────────────────────────────
// ROUTE: POST /api/chat  (Claude proxy)
// ─────────────────────────────────────────────
async function handleChat(req, res, ctx) {
  if (!ctx.config.ANTHROPIC_API_KEY) {
    sendJSON(res, 503, { error: 'Claude API key not configured on server. Add ANTHROPIC_API_KEY to .env' });
    return;
  }

  let payload;
  try { payload = await parseBody(req); }
  catch (e) { sendJSON(res, 400, { error: e.message }); return; }

  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: Math.min(payload.max_tokens || 1000, 4096),
    system: payload.system || `You are KisanMitra (किसानमित्र), a helpful AI assistant for Indian farmers.
- Answer questions about crops, weather, government schemes, mandi prices, and farming techniques
- Respond in the same language the user writes in (Hindi or English)
- Keep answers practical and easy to understand
- Use simple language suitable for farmers`,
    messages: payload.messages || [],
  };

  try {
    const result = await request('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ctx.config.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body,
      timeoutMs: 30000,
    });
    sendJSON(res, result.status, result.json || { error: result.text });
  } catch (e) {
    logger.error('Claude API error', { message: e.message });
    sendJSON(res, 502, { error: 'Failed to reach Claude API: ' + e.message });
  }
}

// ─────────────────────────────────────────────
// ROUTE: GET /api/weather?lat=&lon=
// ─────────────────────────────────────────────
async function handleWeather(req, res) {
  const u = new URL('http://x' + req.url);
  const lat = u.searchParams.get('lat') || '26.9124';
  const lon = u.searchParams.get('lon') || '75.7873';
  const cacheKey = `weather:${lat}:${lon}`;

  const cached = weatherCache.get(cacheKey);
  if (cached) { sendJSON(res, 200, { ...cached, _cache: true }); return; }

  try {
    const result = await request(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=7&timezone=Asia%2FKolkata`
    );
    if (result.status === 200 && result.json) {
      weatherCache.set(cacheKey, result.json);
      sendJSON(res, 200, result.json);
    } else {
      sendJSON(res, result.status, { error: 'Weather API error' });
    }
  } catch (e) {
    sendJSON(res, 502, { error: 'Failed to fetch weather: ' + e.message });
  }
}

// ─────────────────────────────────────────────
// ROUTE: GET /api/mandi?state=&commodity=
// ─────────────────────────────────────────────
async function handleMandi(req, res) {
  const u = new URL('http://x' + req.url);
  const state = u.searchParams.get('state') || 'Rajasthan';
  const commodity = u.searchParams.get('commodity') || '';
  const cacheKey = `mandi:${state}:${commodity}`;

  const cached = mandiCache.get(cacheKey);
  if (cached) { sendJSON(res, 200, { ...cached, _cache: true }); return; }

  // Agmarknet public API (no key needed for basic data)
  const apiUrl = `https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070` +
    `?api-key=579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b` +
    `&format=json&limit=20&filters%5Bstate%5D=${encodeURIComponent(state)}` +
    (commodity ? `&filters%5Bcommodity%5D=${encodeURIComponent(commodity)}` : '');

  try {
    const result = await request(apiUrl, { timeoutMs: 10000 });
    if (result.status === 200 && result.json) {
      mandiCache.set(cacheKey, result.json);
      sendJSON(res, 200, result.json);
    } else {
      // Fallback: return mock data so UI doesn't break
      sendJSON(res, 200, { records: [], _fallback: true, message: 'Live mandi data unavailable' });
    }
  } catch (e) {
    sendJSON(res, 200, { records: [], _fallback: true, message: e.message });
  }
}

// ─────────────────────────────────────────────
// ROUTE: GET /api/news
// ─────────────────────────────────────────────
async function handleNews(req, res) {
  const cached = newsCache.get('news:agri');
  if (cached) { sendJSON(res, 200, { ...cached, _cache: true }); return; }

  // GNews free RSS → JSON (no key needed for RSS)
  try {
    const result = await request(
      'https://news.google.com/rss/search?q=farming+agriculture+india+kisan&hl=hi&gl=IN&ceid=IN:hi',
      { timeoutMs: 8000 }
    );

    if (result.status === 200 && result.text) {
      // Simple XML parse for RSS items
      const items = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;
      while ((match = itemRegex.exec(result.text)) !== null && items.length < 10) {
        const block = match[1];
        const title = (/<title><!\[CDATA\[(.*?)\]\]>/.exec(block) || /<title>(.*?)<\/title>/.exec(block) || [])[1] || '';
        const link  = (/<link>(.*?)<\/link>/.exec(block) || [])[1] || '';
        const pubDate = (/<pubDate>(.*?)<\/pubDate>/.exec(block) || [])[1] || '';
        if (title) items.push({ title: title.trim(), link: link.trim(), pubDate: pubDate.trim() });
      }
      const data = { articles: items, fetchedAt: new Date().toISOString() };
      newsCache.set('news:agri', data);
      sendJSON(res, 200, data);
    } else {
      sendJSON(res, 200, { articles: [], _fallback: true });
    }
  } catch (e) {
    sendJSON(res, 200, { articles: [], _fallback: true, message: e.message });
  }
}

// ─────────────────────────────────────────────
// ROUTE: POST /api/contact
// ─────────────────────────────────────────────
async function handleContact(req, res) {
  let body;
  try { body = await parseBody(req, 10 * 1024); }
  catch (e) { sendJSON(res, 400, { error: e.message }); return; }

  const { name, phone, message } = body || {};
  if (!name || !phone || !message) {
    sendJSON(res, 400, { error: 'name, phone, and message are required' });
    return;
  }

  // Save to DB
  const record = db.contacts.insert({ name, phone, message });
  logger.info('New contact form submission', { name, phone, id: record._id });
  // Fire email notification (non-blocking)
  mailer.notifyContact({ name, phone, message }).catch(() => {});
  sendJSON(res, 200, { success: true, message: 'Contact saved successfully', id: record._id });
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────
module.exports = {
  handleHealth,
  handleChat,
  handleWeather,
  handleMandi,
  handleNews,
  handleContact,
  sendJSON,
};
