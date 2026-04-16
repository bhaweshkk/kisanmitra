/**
 * routes.js — KisanMitra Core Route Handlers
 * AI: Groq (Llama 3) as primary — free & fast
 * Fixed: chat, weather, mandi, news, contact, groups
 */

const https  = require('https');
const http   = require('http');
const db     = require('../db');
const logger = require('./logger');

// ── Helpers ─────────────────────────────────────────────────────────────────

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
    'Content-Length':              Buffer.byteLength(body),
  });
  res.end(body);
}

function parseBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '', size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('Body too large')); req.destroy(); return; }
      body += chunk;
    });
    req.on('end', () => {
      if (!body) { resolve({}); return; }
      try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function getQueryParams(req) {
  try { return Object.fromEntries(new URL(req.url, 'http://localhost').searchParams); }
  catch { return {}; }
}

function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed   = new URL(url);
    const isHttps  = parsed.protocol === 'https:';
    const lib      = isHttps ? https : http;
    const reqOpts  = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   options.method || 'GET',
      headers:  options.headers || {},
      timeout:  (options.timeoutSeconds || 15) * 1000,
    };
    const req = lib.request(reqOpts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

// ── /api/health ──────────────────────────────────────────────────────────────

function handleHealth(req, res, ctx) {
  const groqKey = process.env.GROQ_API_KEY || '';
  sendJSON(res, 200, {
    status:    'ok',
    timestamp: new Date().toISOString(),
    uptime:    Math.floor(process.uptime()),
    version:   'v5',
    ai:        groqKey ? 'groq-configured' : 'no-ai-key',
    port:      ctx?.config?.PORT || 3000,
  });
}

// ── /api/chat — Groq primary, graceful fallback ───────────────────────────

const SYSTEM_PROMPT = `You are KisanMitra, an expert AI assistant for Indian farmers.
You help with: crop advice, pest control, weather interpretation, mandi prices, government schemes (PM-KISAN, PMFBY, KCC), soil health, irrigation, organic farming, and selling produce.
Always reply in the same language the farmer uses (Hindi, English, or regional). Be simple, practical, and encouraging.
If asked about prices, remind the farmer to also check local mandi rates. Always prioritize the farmer's wellbeing.`;

async function handleChat(req, res, ctx) {
  let body;
  try { body = await parseBody(req); }
  catch (e) { sendJSON(res, 400, { error: e.message }); return; }

  const messages = body?.messages;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    sendJSON(res, 400, { error: 'messages array is required' }); return;
  }

  const groqKey = process.env.GROQ_API_KEY || ctx?.config?.GROQ_API_KEY || '';
  if (!groqKey) {
    sendJSON(res, 503, {
      error:   'AI not configured',
      message: 'Please set GROQ_API_KEY in your .env file. Get a free key at https://console.groq.com',
      hint:    'GROQ_API_KEY=gsk_...',
    });
    return;
  }

  try {
    const result = await fetchJSON('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${groqKey}`,
      },
      body: {
        model:      body.model || 'llama3-8b-8192',
        max_tokens: body.max_tokens || 1000,
        messages:   [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.7,
      },
      timeoutSeconds: 30,
    });

    if (result.status !== 200) {
      logger.error('Groq API error', { status: result.status, data: result.data });
      sendJSON(res, 502, { error: 'AI service error', detail: result.data?.error?.message || 'Unknown error' });
      return;
    }

    // Save chat to DB for admin logs
    try {
      const lastMsg = messages[messages.length - 1];
      await db.collection('chatlogs').insert({
        userMessage: lastMsg?.content?.substring(0, 200) || '',
        aiResponse:  result.data.choices?.[0]?.message?.content?.substring(0, 200) || '',
        model:       'groq/llama3',
        timestamp:   new Date().toISOString(),
      });
    } catch { /* non-fatal */ }

    sendJSON(res, 200, {
      success: true,
      message: result.data.choices?.[0]?.message?.content || '',
      model:   result.data.model,
      usage:   result.data.usage,
    });

  } catch (err) {
    logger.error('Chat handler error', { message: err.message });
    sendJSON(res, 500, { error: 'Chat failed', detail: err.message });
  }
}

// ── /api/weather ─────────────────────────────────────────────────────────────

async function handleWeather(req, res) {
  const params = getQueryParams(req);
  let { lat, lon, latitude, longitude, city } = params;
  latitude  = latitude  || lat;
  longitude = longitude || lon;

  // If city name provided, geocode it first
  if ((!latitude || !longitude) && city) {
    try {
      const geo = await fetchJSON(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1&countrycodes=in`,
        { headers: { 'User-Agent': 'KisanMitra/1.0' }, timeoutSeconds: 8 }
      );
      if (geo.data?.[0]) {
        latitude  = geo.data[0].lat;
        longitude = geo.data[0].lon;
      }
    } catch { /* fall through */ }
  }

  if (!latitude || !longitude) {
    // Default to Jaipur, Rajasthan
    latitude  = '26.9124';
    longitude = '75.7873';
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,precipitation` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code` +
      `&forecast_days=7&timezone=Asia%2FKolkata`;

    const result = await fetchJSON(url, { timeoutSeconds: 10 });
    if (result.status !== 200) { sendJSON(res, 502, { error: 'Weather service unavailable' }); return; }
    sendJSON(res, 200, { success: true, ...result.data });
  } catch (err) {
    sendJSON(res, 500, { error: 'Weather fetch failed', detail: err.message });
  }
}

// ── /api/mandi ───────────────────────────────────────────────────────────────

async function handleMandi(req, res) {
  const params = getQueryParams(req);
  const { state = 'Rajasthan', commodity, market } = params;

  // Use the gov API key from apis_config or fallback
  const apiKey = '579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b';
  let url = `https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070` +
    `?api-key=${apiKey}&format=json&limit=20&filters[state]=${encodeURIComponent(state)}`;
  if (commodity) url += `&filters[commodity]=${encodeURIComponent(commodity)}`;
  if (market)    url += `&filters[market]=${encodeURIComponent(market)}`;

  try {
    const result = await fetchJSON(url, { timeoutSeconds: 12 });
    if (result.status !== 200) {
      sendJSON(res, 502, { error: 'Mandi data service unavailable', status: result.status });
      return;
    }
    sendJSON(res, 200, { success: true, records: result.data?.records || [], total: result.data?.total || 0 });
  } catch (err) {
    sendJSON(res, 500, { error: 'Mandi fetch failed', detail: err.message });
  }
}

// ── /api/news ────────────────────────────────────────────────────────────────

async function handleNews(req, res) {
  const newsKey = process.env.NEWSAPI_KEY || '';
  if (!newsKey) {
    // Return curated static news when no key available
    sendJSON(res, 200, {
      success: true,
      source:  'static',
      articles: [
        { title: 'PM-KISAN: Next installment due — check your status at pmkisan.gov.in', publishedAt: new Date().toISOString(), url: 'https://pmkisan.gov.in' },
        { title: 'Kharif crop sowing targets: Govt releases district-wise schedule', publishedAt: new Date().toISOString(), url: 'https://agricoop.nic.in' },
        { title: 'PMFBY crop insurance: Claim window open for flood-affected farmers', publishedAt: new Date().toISOString(), url: 'https://pmfby.gov.in' },
        { title: 'Mandi prices update: Wheat and mustard see upward trend this week', publishedAt: new Date().toISOString(), url: 'https://agmarknet.gov.in' },
        { title: 'Soil Health Card portal: Download your latest report online', publishedAt: new Date().toISOString(), url: 'https://soilhealth.dac.gov.in' },
      ],
    });
    return;
  }

  try {
    const params = getQueryParams(req);
    const q = params.q || 'farming agriculture india kisan';
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&pageSize=10&sortBy=publishedAt`;
    const result = await fetchJSON(url, {
      headers: { 'X-Api-Key': newsKey },
      timeoutSeconds: 10,
    });
    sendJSON(res, 200, { success: true, source: 'newsapi', articles: result.data?.articles || [] });
  } catch (err) {
    sendJSON(res, 500, { error: 'News fetch failed', detail: err.message });
  }
}

// ── /api/contact ─────────────────────────────────────────────────────────────

async function handleContact(req, res) {
  let body;
  try { body = await parseBody(req); } catch (e) { sendJSON(res, 400, { error: e.message }); return; }

  const { name, phone, email, message, subject } = body || {};
  if (!name || !message) { sendJSON(res, 400, { error: 'name and message are required' }); return; }

  try {
    const contact = await db.collection('contacts').insert({
      name:      name.substring(0, 100),
      phone:     (phone || '').substring(0, 20),
      email:     (email || '').substring(0, 100),
      subject:   (subject || 'General').substring(0, 100),
      message:   message.substring(0, 1000),
      status:    'new',
      createdAt: new Date().toISOString(),
    });
    sendJSON(res, 200, { success: true, id: contact._id, message: 'Contact saved successfully' });
  } catch (err) {
    sendJSON(res, 500, { error: 'Failed to save contact', detail: err.message });
  }
}

// ── /api/groups ───────────────────────────────────────────────────────────────

async function handleGroups(req, res) {
  try {
    const groups = await db.collection('groups').find() || [];
    sendJSON(res, 200, { success: true, groups });
  } catch (err) {
    sendJSON(res, 500, { error: 'Failed to fetch groups', detail: err.message });
  }
}

async function handleCreateGroup(req, res) {
  let body;
  try { body = await parseBody(req); } catch (e) { sendJSON(res, 400, { error: e.message }); return; }

  const { name, description, category, emoji } = body || {};
  if (!name || !category) { sendJSON(res, 400, { error: 'name and category are required' }); return; }

  try {
    const group = await db.collection('groups').insert({
      name:        name.substring(0, 100),
      description: (description || '').substring(0, 300),
      category:    category.substring(0, 50),
      emoji:       emoji || '🌾',
      members:     1,
      active:      1,
      status:      'pending',
      createdAt:   new Date().toISOString(),
    });
    sendJSON(res, 201, { success: true, group });
  } catch (err) {
    sendJSON(res, 500, { error: 'Failed to create group', detail: err.message });
  }
}

// exports moved to bottom

// ── /api/community/members ────────────────────────────────────────────────────
async function handleCommunityMembers(req, res) {
  try {
    const users = (await db.collection('users').find())
      .filter(u => u.active !== false)
      .map(u => ({
        _id:      u._id,
        name:     u.name,
        role:     u.role,
        village:  u.village || '',
        crop:     u.crop || '',
        buyItem:  u.buyItem || '',
        business: u.business || '',
        verified: u.verified || false,
        createdAt: u.createdAt
      }));
    sendJSON(res, 200, { success: true, members: users });
  } catch(e) { sendJSON(res, 500, { error: e.message }); }
}

// ── /api/community/groups/:id/messages ────────────────────────────────────────
async function handleGroupMessages(req, res, groupId, method, body) {
  if (method === 'GET') {
    try {
      const msgs = await db.collection('groupMessages').find({ groupId });
      msgs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      sendJSON(res, 200, { success: true, messages: msgs.slice(-100) });
    } catch(e) { sendJSON(res, 500, { error: e.message }); }
  } else if (method === 'POST') {
    try {
      const token = (req.headers['authorization'] || '').replace('Bearer ', '');
      const auth  = require('./auth');
      const user   = token ? await auth.verifyToken(token) : null;
      const userId = user?._id || null;
      const msg = await db.collection('groupMessages').insert({
        groupId,
        userId:  userId || 'guest',
        name:    user?.name || body?.name || 'Farmer',
        role:    user?.role || 'farmer',
        avatar:  user?.role === 'buyer' ? '🛒' : '👨‍🌾',
        content: (body?.content || '').substring(0, 500),
        time:    new Date().toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'}),
        likes:   0,
        createdAt: new Date().toISOString()
      });
      sendJSON(res, 201, { success: true, message: msg });
    } catch(e) { sendJSON(res, 500, { error: e.message }); }
  }
}

// ── /api/community/dm ─────────────────────────────────────────────────────────
async function handleDM(req, res, method, body, toUserId) {
  const token  = (req.headers['authorization'] || '').replace('Bearer ', '');
  const auth   = require('./auth');
  const user   = token ? await auth.verifyToken(token) : null;
  const userId = user?._id || null;
  if (!userId) { sendJSON(res, 401, { error: 'Login required for DM' }); return; }

  if (method === 'GET' && toUserId) {
    // Get conversation between current user and toUserId
    const allMsgs = await db.collection('dms').find();
    const msgs = allMsgs.filter(m =>
      (m.from === userId && m.to === toUserId) ||
      (m.from === toUserId && m.to === userId)
    );
    sendJSON(res, 200, { success: true, messages: msgs.slice(-100) });
  } else if (method === 'POST') {
    const msg = await db.collection('dms').insert({
      from:      userId,
      to:        body?.to,
      content:   (body?.content || '').substring(0, 500),
      time:      new Date().toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'}),
      createdAt: new Date().toISOString()
    });
    sendJSON(res, 201, { success: true, message: msg });
  }
}

module.exports = {
  sendJSON,
  handleHealth,
  handleChat,
  handleWeather,
  handleMandi,
  handleNews,
  handleContact,
  handleGroups,
  handleCreateGroup,
  handleCommunityMembers,
  handleGroupMessages,
  handleDM,
};
