/**
 * KisanMitra server.js — v6 (MongoDB + permanent storage)
 *
 * All data routes now store permanently via db.js (MongoDB or JSON).
 * Every route has try/catch — no more 500 "Internal server errors".
 *
 * ROUTES:
 *   Auth:        POST /api/auth/register|login   GET /api/auth/me
 *   Community:   GET/POST /api/groups            GET/POST /api/groups/:id/messages
 *   Marketplace: GET/POST /api/marketplace/products
 *                GET/POST /api/marketplace/orders    GET /api/marketplace/orders/mine
 *   Innovate:    GET /api/innovate/companies     POST /api/innovate/stories
 *                GET /api/innovate/stories (admin)   PATCH /api/innovate/stories/:id (admin)
 *   Docs:        All existing /api/docs/* routes
 *   Admin:       All existing /api/admin/* routes
 *   Plugins:     GET /api/plugins   POST /api/plugins/:name
 */
'use strict';

const { loadEnv } = require('./lib/env');
loadEnv();

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const logger          = require('./lib/logger');
const RateLimiter     = require('./lib/rateLimiter');
const { serveStatic } = require('./lib/staticServer');
const routes          = require('./lib/routes');
const adminRoutes     = require('./lib/adminRoutes');
const docRoutes       = require('./lib/docRoutes');
const apiRegistry     = require('./lib/apiRegistry');
const auth            = require('./lib/auth');
const { validate }    = require('./lib/validator');
const { connectDB, collection } = require('./db');

// ── Collections (all data stored permanently) ────────────────────
const groupsCol    = collection('community_groups');
const msgsCol      = collection('community_messages');
const productsCol  = collection('mp_products');
const ordersCol    = collection('mp_orders');
const companiesCol = collection('innovate_companies');
const ideasCol     = collection('innovate_ideas');
const storiesCol   = collection('innovate_stories');
const usersCol     = collection('users');

// ── Config ───────────────────────────────────────────────────────
const CONFIG = {
  PORT:            parseInt(process.env.PORT)       || 3000,
  HTTPS_PORT:      parseInt(process.env.HTTPS_PORT) || 3443,
  HOST:            process.env.HOST                 || '0.0.0.0',
  PUBLIC_DIR:      path.join(__dirname, 'public'),
  CERT_DIR:        path.join(__dirname, 'certs'),
  MAX_REQ_PER_MIN: parseInt(process.env.MAX_REQ_PER_MIN) || 120,
  ENABLE_HTTPS:    fs.existsSync(path.join(__dirname, 'certs', 'cert.pem')),
};

const rateLimiter = new RateLimiter({
  windowMs: 60000, maxRequests: CONFIG.MAX_REQ_PER_MIN, blockDurationMs: 60000
});

// ── Helpers ──────────────────────────────────────────────────────
function sendJSON(res, status, obj) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  });
  res.end(JSON.stringify(obj));
}

function addCORS(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Powered-By', 'KisanMitra');
}

function parseBody(req, max = 2097152) {
  return new Promise((resolve, reject) => {
    let body = '', size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > max) { reject(new Error('Request body too large')); req.destroy(); return; }
      body += chunk;
    });
    req.on('end',   () => { if (!body) { resolve(null); return; } try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

async function getUser(req) {
  try {
    const h = req.headers['authorization'] || '';
    if (!h.startsWith('Bearer ')) return null;
    const token = h.slice(7).trim();
    if (!token) return null;
    const allUsers = await usersCol.find({});
    return allUsers.find(u => u.token === token) || null;
  } catch { return null; }
}
async function requireAuth(req, res)  { const u = await getUser(req); if(!u){sendJSON(res,401,{error:'Login required. Please sign in.'});return null;} return u; }
async function requireAdmin(req, res) { const u = await getUser(req); if(!u||u.role!=='admin'){sendJSON(res,403,{error:'Admin access required.'});return null;} return u; }

// ── Community Groups ─────────────────────────────────────────────
async function handleGetGroups(req, res) {
  try {
    let groups = (await groupsCol.find({})).filter(g => !g.status || g.status === 'approved');
    groups.sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
    sendJSON(res, 200, { groups });
  } catch(e) { logger.error('getGroups',{msg:e.message}); sendJSON(res, 500, {error:'Could not load groups'}); }
}

async function handleCreateGroup(req, res, body) {
  try {
    if (!body || !body.name || !body.name.trim()) return sendJSON(res, 400, {error:'Group name is required'});
    const u = await getUser(req);
    const g = await groupsCol.insert({
      name: body.name.trim(), emoji: body.emoji||'👥',
      desc: (body.desc||'').trim(), category: body.category||'general',
      createdBy: u?(u._id||u.id):(body.createdBy||'anon'),
      creatorName: u?u.name:(body.creatorName||'User'),
      members:1, active:0, status:'approved'
    });
    sendJSON(res, 201, g);
  } catch(e) { logger.error('createGroup',{msg:e.message}); sendJSON(res, 500, {error:'Could not create group'}); }
}

async function handleGetMessages(req, res, gid) {
  try {
    const msgs = await msgsCol.find({ groupId: gid });
    msgs.sort((a,b) => (a.createdAt||0)-(b.createdAt||0));
    sendJSON(res, 200, { messages: msgs.slice(-100) });
  } catch(e) { sendJSON(res, 500, {error:'Could not load messages'}); }
}

async function handlePostMessage(req, res, gid, body) {
  try {
    if (!body||!body.content||!body.content.trim()) return sendJSON(res, 400, {error:'Message content required'});
    const u = await getUser(req);
    const m = await msgsCol.insert({
      groupId: gid, content: body.content.trim(),
      userId:     u?(u._id||u.id):(body.userId||'anon'),
      userName:   u?u.name:(body.userName||'User'),
      userAvatar: body.userAvatar||(u?(u.role==='buyer'?'🏪':'👨‍🌾'):'👤'),
      userRole:   u?u.role:(body.userRole||'farmer'),
      likes: 0,
      time: new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})
    });
    sendJSON(res, 201, m);
  } catch(e) { sendJSON(res, 500, {error:'Could not post message'}); }
}

// ── Marketplace ──────────────────────────────────────────────────
async function handleListProducts(req, res) {
  try {
    const url   = new URL('http://x'+req.url);
    const limit = parseInt(url.searchParams.get('limit'))||60;
    const cat   = url.searchParams.get('category')||'';
    const q     = (url.searchParams.get('q')||'').toLowerCase();
    let all = (await productsCol.find({})).filter(p => p.status !== 'rejected');
    if (cat) all = all.filter(p => p.category===cat);
    if (q)   all = all.filter(p => (p.name||'').toLowerCase().includes(q)||(p.sellerName||'').toLowerCase().includes(q)||(p.tags||[]).some(t=>t.toLowerCase().includes(q)));
    all.sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
    sendJSON(res, 200, { products: all.slice(0,limit), total: all.length });
  } catch(e) { logger.error('listProducts',{msg:e.message}); sendJSON(res, 500, {error:'Could not load products'}); }
}

async function handleCreateProduct(req, res, body) {
  try {
    const u = await requireAuth(req,res); if(!u) return;
    if (!body)                              return sendJSON(res, 400, {error:'Request body required'});
    if (!body.name||!body.name.trim())      return sendJSON(res, 400, {error:'Product name required'});
    if (!body.price||+body.price<=0)        return sendJSON(res, 400, {error:'Valid price required'});
    if (!body.stock||+body.stock<=0)        return sendJSON(res, 400, {error:'Stock quantity required'});
    if (!body.unit)                         return sendJSON(res, 400, {error:'Unit required (kg, litre, etc.)'});
    const p = await productsCol.insert({
      name: body.name.trim(), category: body.category||'grains',
      desc: (body.desc||'').trim(), emoji: body.emoji||'🌾',
      price: parseFloat(body.price),
      mrp:   body.mrp?parseFloat(body.mrp):parseFloat(body.price),
      unit: body.unit, minQty: parseInt(body.minQty)||1,
      stock: parseInt(body.stock), organic: !!body.organic,
      tags: body.tags||(body.organic?['Organic','Direct Farm']:['Direct Farm']),
      certifications: [],
      sellerId:       u._id||u.id,
      sellerName:     u.name||'KisanMitra Seller',
      sellerEmoji:    u.role==='buyer'?'🏪':'👨‍🌾',
      sellerLocation: [u.district,u.state].filter(Boolean).join(', ')||'India',
      sellerVerified: u.status==='active',
      status:'active', rating:0, reviews:0, featured:false, isNew:true
    });
    sendJSON(res, 201, p);
  } catch(e) { logger.error('createProduct',{msg:e.message}); sendJSON(res, 500, {error:'Could not create listing'}); }
}

async function handleMyOrders(req, res) {
  try {
    const u = await requireAuth(req,res); if(!u) return;
    const mine = await ordersCol.find({ buyerId: u._id||u.id });
    mine.sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
    sendJSON(res, 200, { orders: mine });
  } catch(e) { sendJSON(res, 500, {error:'Could not load orders'}); }
}

async function handleCreateOrder(req, res, body) {
  try {
    const u = await requireAuth(req,res); if(!u) return;
    if (!body||!body.items||!body.items.length) return sendJSON(res, 400, {error:'Order items required'});
    for (const item of body.items) {
      const p = await productsCol.findOne({_id: item._id});
      if (!p)          return sendJSON(res, 404, {error:`Product not found: ${item._id}`});
      if (p.stock<item.qty) return sendJSON(res, 400, {error:`Not enough stock for ${p.name} (available: ${p.stock})`});
    }
    for (const item of body.items) {
      const p = await productsCol.findOne({_id: item._id});
      if (p) await productsCol.updateById(item._id, {stock: p.stock-item.qty});
    }
    const total = parseFloat(body.total)||body.items.reduce((a,c)=>a+c.price*c.qty,0);
    const order = await ordersCol.insert({
      buyerId: u._id||u.id, buyerName: u.name||'',
      items: body.items, total, status:'processing', currency:'INR',
      productName: body.items.length===1?body.items[0].name:body.items.length+' items',
      emoji: body.items.length===1?(body.items[0].emoji||'📦'):'🛒',
      qty: body.items.reduce((a,c)=>a+c.qty,0),
      unit: body.items.length===1?body.items[0].unit:'items'
    });
    sendJSON(res, 201, order);
  } catch(e) { logger.error('createOrder',{msg:e.message}); sendJSON(res, 500, {error:'Could not place order'}); }
}

// ── AgriInnovate ──────────────────────────────────────────────────
async function handleListCompanies(req, res) {
  try {
    const cos   = await companiesCol.find({status:'published'});
    cos.sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
    const ideas = await ideasCol.find({});
    ideas.sort((a,b) => (a.order||99)-(b.order||99));
    sendJSON(res, 200, { companies: cos, ideas });
  } catch(e) { sendJSON(res, 500, {error:'Could not load companies'}); }
}

async function handleSubmitStory(req, res, body) {
  try {
    if (!body) return sendJSON(res, 400, {error:'Request body required'});
    if (!body.name||!body.sector||!body.founded||!body.location||!body.shortDesc)
      return sendJSON(res, 400, {error:'name, sector, founded, location and shortDesc are required'});
    const u = await getUser(req);
    const s = await storiesCol.insert({
      ...body,
      submittedBy:   u?u.name:(body.submittedBy||'Anonymous'),
      submittedById: u?(u._id||u.id):null,
      status: 'pending'
    });
    sendJSON(res, 201, {message:'Story submitted! Our team will review within 3 business days.', id: s._id});
  } catch(e) { sendJSON(res, 500, {error:'Could not submit story'}); }
}

async function handleAdminListStories(req, res) {
  try {
    const u = await requireAdmin(req,res); if(!u) return;
    const all = await storiesCol.find({});
    all.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    sendJSON(res, 200, {stories: all});
  } catch(e) { sendJSON(res, 500, {error:'Could not load stories'}); }
}

async function handleAdminApproveStory(req, res, storyId, body) {
  try {
    const u = await requireAdmin(req,res); if(!u) return;
    const s = await storiesCol.findOne({_id: storyId});
    if (!s) return sendJSON(res, 404, {error:'Story not found'});
    if (!body||!['approve','reject'].includes(body.action)) return sendJSON(res, 400, {error:'action must be approve or reject'});
    if (body.action === 'approve') {
      const company = await companiesCol.insert({
        name: s.name, tagline: (s.shortDesc||'').slice(0,80), shortDesc: s.shortDesc||'',
        sector: s.sector||'', category: body.category||'platform',
        founded: s.founded||'', location: s.location||'',
        founders: s.founders||[], funding: s.funding||'',
        farmersImpacted: s.farmersImpacted||'', employees: s.employees||'',
        states: s.states||'', website: s.website||'',
        emoji: body.emoji||'🌾',
        bannerColor: body.bannerColor||'linear-gradient(135deg,#064e3b,#065f46)',
        stage: body.stage||'', model: s.model||'', innovation: s.innovation||'',
        lessons: s.lessons||[], forStarters: s.forStarters||'',
        story: body.enrichedStory||[], certifications: body.certifications||[],
        tags: body.tags||[], authenticityScore: body.authenticityScore||85,
        auditor: body.auditor||'KisanMitra Team',
        verified: true, status: 'published', originalStoryId: storyId
      });
      await storiesCol.updateById(storyId, {status:'approved', approvedAt: Date.now()});
      sendJSON(res, 200, {message:'Approved and published', company});
    } else {
      await storiesCol.updateById(storyId, {status:'rejected', rejectedAt: Date.now(), reason: body.reason||''});
      sendJSON(res, 200, {message:'Story rejected'});
    }
  } catch(e) { sendJSON(res, 500, {error:'Could not update story'}); }
}

// ── Main Router ───────────────────────────────────────────────────
async function router(req, res, isHttps) {
  const method   = req.method.toUpperCase();
  const pathname = req.url.split('?')[0];

  addCORS(res);
  if (isHttps) res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');

  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (!isHttps && CONFIG.ENABLE_HTTPS && pathname !== '/api/health') {
    const host = (req.headers.host||'localhost').split(':')[0];
    res.writeHead(301, {Location:`https://${host}:${CONFIG.HTTPS_PORT}${req.url}`});
    res.end(); return;
  }

  // Auth
  if (pathname==='/api/auth/register'&&method==='POST') { const b=await parseBody(req).catch(()=>null); await auth.handleRegister(req,res,b); return; }
  if (pathname==='/api/auth/login'   &&method==='POST') { const b=await parseBody(req).catch(()=>null); await auth.handleLogin(req,res,b); return; }
  if (pathname==='/api/auth/me'      &&method==='GET')  { await auth.handleMe(req,res); return; }

  // Documents
  if (pathname==='/api/docs/upload' &&method==='POST')  { await docRoutes.handleUpload(req,res); return; }
  if (pathname==='/api/docs/my'     &&method==='GET')   { await docRoutes.handleGetMy(req,res); return; }
  if (pathname==='/api/docs/submit' &&method==='POST')  { await docRoutes.handleSubmit(req,res); return; }
  if (pathname.startsWith('/api/docs/file/')&&method==='GET') { await docRoutes.handleGetFile(req,res,pathname.split('/api/docs/file/')[1]); return; }
  if (pathname.startsWith('/api/docs/')&&method==='DELETE') { await docRoutes.handleDelete(req,res,pathname.split('/').pop()); return; }
  if (pathname==='/api/admin/docs'  &&method==='GET')   { await docRoutes.handleAdminGetDocs(req,res); return; }
  if (pathname.match(/^\/api\/admin\/docs\/[^/]+\/status$/)&&method==='PATCH') { const b=await parseBody(req).catch(()=>null); await docRoutes.handleAdminUpdateStatus(req,res,pathname.split('/')[4]); return; }
  if (pathname.match(/^\/api\/admin\/docs\/[^/]+\/file\/[^/]+$/)&&method==='GET') { const p=pathname.split('/'); await docRoutes.handleAdminGetFile(req,res,p[4],p[6]); return; }

  // Admin
  if (pathname==='/admin'&&method==='GET') { serveStatic({url:'/admin.html',method:'GET',headers:req.headers},res,CONFIG.PUBLIC_DIR); return; }
  if (pathname==='/api/admin/contacts'&&method==='GET')  { await adminRoutes.handleGetContacts(req,res); return; }
  if (pathname==='/api/admin/chatlogs'&&method==='GET')  { await adminRoutes.handleGetChatlogs(req,res); return; }
  if (pathname==='/api/admin/logs'    &&method==='GET')  { adminRoutes.handleGetLogs(req,res); return; }
  if (pathname==='/api/admin/db-stats'&&method==='GET')  { await adminRoutes.handleDbStats(req,res); return; }
  if (pathname==='/api/admin/users'   &&method==='GET')  { await adminRoutes.handleGetUsers(req,res); return; }
  if (pathname.startsWith('/api/admin/contacts/')&&method==='DELETE') { await adminRoutes.handleDeleteContact(req,res,pathname.split('/').pop()); return; }
  if (pathname==='/api/admin/verify-password'&&method==='POST') { const b=await parseBody(req).catch(()=>null); adminRoutes.handleVerifyPassword(req,res,b); return; }

  // Core
  const ctx = {config:CONFIG, rateLimiter};
  if (pathname==='/api/health' &&method==='GET')  { routes.handleHealth(req,res,ctx); return; }
  if (pathname==='/api/chat'   &&method==='POST')  { await routes.handleChat(req,res,ctx); return; }
  if (pathname==='/api/weather'&&method==='GET')   { await routes.handleWeather(req,res); return; }
  if (pathname==='/api/mandi'  &&method==='GET')   { await routes.handleMandi(req,res); return; }
  if (pathname==='/api/news'   &&method==='GET')   { await routes.handleNews(req,res); return; }
  if (pathname==='/api/contact'&&method==='POST')  { await routes.handleContact(req,res); return; }

  // Community Groups (permanent server storage)
  if (pathname==='/api/groups'&&method==='GET')  { await handleGetGroups(req,res); return; }
  if (pathname==='/api/groups'&&method==='POST') { const b=await parseBody(req).catch(()=>null); await handleCreateGroup(req,res,b); return; }
  if (pathname.match(/^\/api\/groups\/[^/]+\/messages$/)&&method==='GET')  { await handleGetMessages(req,res,pathname.split('/')[3]); return; }
  if (pathname.match(/^\/api\/groups\/[^/]+\/messages$/)&&method==='POST') { const b=await parseBody(req).catch(()=>null); await handlePostMessage(req,res,pathname.split('/')[3],b); return; }

  // Marketplace (permanent server storage)
  if (pathname==='/api/marketplace/products'   &&method==='GET')  { await handleListProducts(req,res); return; }
  if (pathname==='/api/marketplace/products'   &&method==='POST') { const b=await parseBody(req).catch(()=>null); await handleCreateProduct(req,res,b); return; }
  if (pathname==='/api/marketplace/orders/mine'&&method==='GET')  { await handleMyOrders(req,res); return; }
  if (pathname==='/api/marketplace/orders'     &&method==='POST') { const b=await parseBody(req).catch(()=>null); await handleCreateOrder(req,res,b); return; }

  // AgriInnovate (permanent server storage)
  if (pathname==='/api/innovate/companies'&&method==='GET')  { await handleListCompanies(req,res); return; }
  if (pathname==='/api/innovate/stories'  &&method==='POST') { const b=await parseBody(req).catch(()=>null); await handleSubmitStory(req,res,b); return; }
  if (pathname==='/api/innovate/stories'  &&method==='GET')  { await handleAdminListStories(req,res); return; }
  if (pathname.match(/^\/api\/innovate\/stories\/[^/]+$/)&&method==='PATCH') { const b=await parseBody(req).catch(()=>null); await handleAdminApproveStory(req,res,pathname.split('/').pop(),b); return; }

  // Plugins
  if (pathname==='/api/plugins'&&method==='GET') { apiRegistry.handleListPlugins(req,res); return; }
  if (pathname.startsWith('/api/plugins/')) {
    let b=null;
    if (method==='POST') { try{b=await parseBody(req);}catch(e){sendJSON(res,400,{error:e.message});return;} }
    const matched = await apiRegistry.handlePluginRoute(req,res,pathname,b);
    if (matched!==false) return;
    sendJSON(res,404,{error:`No plugin: ${pathname}`,hint:'See /api/plugins'}); return;
  }

  if (pathname.startsWith('/api/')) { sendJSON(res,404,{error:`Not found: ${method} ${pathname}`}); return; }
  if (method==='GET'||method==='HEAD') { serveStatic(req,res,CONFIG.PUBLIC_DIR); return; }
  sendJSON(res,405,{error:'Method not allowed'});
}

// ── Request handler ───────────────────────────────────────────────
function makeHandler(isHttps) {
  return (req, res) => {
    const ip    = req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown';
    const start = Date.now();
    const limit = rateLimiter.check(ip);
    if (!limit.allowed) {
      res.setHeader('Retry-After', limit.retryAfter);
      sendJSON(res, 429, {error:'Too many requests. Please wait.', retryAfter: limit.retryAfter});
      return;
    }
    router(req, res, isHttps)
      .catch(err => {
        logger.error('Router error', {url:req.url, method:req.method, msg:err.message});
        sendJSON(res, 500, {error:'Internal server error. Please try again.'});
      })
      .finally(() => {
        logger.info(`${req.method} ${req.url} ${res.statusCode} ${Date.now()-start}ms`, {ip:ip.slice(0,20)});
      });
  };
}

// ── Start ────────────────────────────────────────────────────────
const openConnections = new Set();
function trackConn(srv) {
  srv.on('connection', s => { openConnections.add(s); s.on('close', ()=>openConnections.delete(s)); });
}

validate(CONFIG).then(async () => {
  // Connect to MongoDB Atlas first
  await connectDB();

  const httpServer = http.createServer(makeHandler(false));
  trackConn(httpServer);
  httpServer.listen(CONFIG.PORT, CONFIG.HOST, () => logger.info(`🌐 HTTP → http://localhost:${CONFIG.PORT}`));
  httpServer.on('error', err => {
    logger.error('HTTP server error', {code:err.code});
    if (err.code === 'EADDRINUSE') { logger.error(`Port ${CONFIG.PORT} already in use. Kill other process or change PORT in .env`); process.exit(1); }
  });

  if (CONFIG.ENABLE_HTTPS) {
    try {
      const hs = https.createServer({
        key:  fs.readFileSync(path.join(CONFIG.CERT_DIR, 'key.pem')),
        cert: fs.readFileSync(path.join(CONFIG.CERT_DIR, 'cert.pem')),
      }, makeHandler(true));
      trackConn(hs);
      hs.listen(CONFIG.HTTPS_PORT, CONFIG.HOST, () => logger.info(`🔒 HTTPS → https://localhost:${CONFIG.HTTPS_PORT}`));
    } catch(e) { logger.warn('HTTPS disabled', {msg:e.message}); }
  }

  logger.info('══════════════════════════════════════════════');
  logger.info('   🌾  KisanMitra v6 — All systems ready!');
  logger.info(`   Website   : http://localhost:${CONFIG.PORT}`);
  logger.info(`   Admin     : http://localhost:${CONFIG.PORT}/admin`);
  logger.info(`   Health    : http://localhost:${CONFIG.PORT}/api/health`);
  logger.info(`   MongoDB   : ${process.env.MONGODB_URI ? '✅ Connected (permanent storage)' : '⚠️  Not set — data lost on restart!'}`);
  logger.info('══════════════════════════════════════════════');

  function shutdown(sig) {
    logger.info(`${sig} — shutting down gracefully...`);
    for (const s of openConnections) s.destroy();
    setTimeout(() => process.exit(0), 1000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

}).catch(err => {
  logger.error('Startup failed', {msg:err.message});
  process.exit(1);
});

process.on('unhandledRejection', r => logger.error('Unhandled rejection', {reason: String(r)}));
process.on('uncaughtException',  e => { logger.error('Uncaught exception', {msg:e.message, stack:e.stack}); process.exit(1); });
