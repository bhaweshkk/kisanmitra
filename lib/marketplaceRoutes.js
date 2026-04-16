/**
 * marketplaceRoutes.js — KisanBazaar Marketplace API
 * 
 * Routes handled (add these to server.js router):
 *   GET  /api/marketplace/products        → list all active products
 *   POST /api/marketplace/products        → seller creates a listing (auth required)
 *   GET  /api/marketplace/orders/mine     → buyer's own orders (auth required)
 *   POST /api/marketplace/orders          → place an order (auth required)
 * 
 * HOW TO WIRE INTO server.js:
 *   const marketplaceRoutes = require('./lib/marketplaceRoutes');
 *   // Inside router(), add before the static-files section:
 *   if (pathname === '/api/marketplace/products' && method === 'GET')  { marketplaceRoutes.listProducts(req, res); return; }
 *   if (pathname === '/api/marketplace/products' && method === 'POST') { const body = await parseBody(req).catch(()=>null); marketplaceRoutes.createProduct(req, res, body); return; }
 *   if (pathname === '/api/marketplace/orders/mine' && method === 'GET')  { marketplaceRoutes.myOrders(req, res); return; }
 *   if (pathname === '/api/marketplace/orders'      && method === 'POST') { const body = await parseBody(req).catch(()=>null); marketplaceRoutes.createOrder(req, res, body); return; }
 */

const db     = require('../db');
const crypto = require('crypto');

const products = db.collection('mp_products');
const orders   = db.collection('mp_orders');
const users    = db.collection('users');

// ── helpers ────────────────────────────────────────────────────
function sendJSON(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  });
  res.end(JSON.stringify(obj));
}

async function getUserFromReq(req) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  const all = await users.find({});
  return all.find(u => u.token === token) || null;
}

// ── GET /api/marketplace/products ─────────────────────────────
async function listProducts(req, res) {
  const url   = new URL('http://x' + req.url);
  const limit = parseInt(url.searchParams.get('limit')) || 60;
  const cat   = url.searchParams.get('category') || '';
  const q     = (url.searchParams.get('q') || '').toLowerCase();

  let all = await products.find({ status: 'active' });

  if (cat) all = all.filter(p => p.category === cat);
  if (q)   all = all.filter(p =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.sellerName || '').toLowerCase().includes(q) ||
    (p.tags || []).some(t => t.toLowerCase().includes(q))
  );

  // newest first
  all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  sendJSON(res, 200, { products: all.slice(0, limit), total: all.length });
}

// ── POST /api/marketplace/products ────────────────────────────
async function createProduct(req, res, body) {
  const seller = await getUserFromReq(req);
  if (!seller)
    return sendJSON(res, 401, { error: 'Login required to list a product' });

  if (!body)
    return sendJSON(res, 400, { error: 'Request body required' });

  const { name, category, desc, emoji, price, mrp, unit, minQty, stock, organic, cert } = body;

  if (!name || !name.trim())
    return sendJSON(res, 400, { error: 'Product name is required' });
  if (!price || isNaN(price) || parseFloat(price) <= 0)
    return sendJSON(res, 400, { error: 'Valid price is required' });
  if (!stock || isNaN(stock) || parseInt(stock) <= 0)
    return sendJSON(res, 400, { error: 'Available stock is required' });
  if (!unit)
    return sendJSON(res, 400, { error: 'Unit is required' });

  const newProduct = {
    name:            name.trim(),
    category:        category || 'grains',
    desc:            (desc || '').trim(),
    emoji:           emoji || '🌾',
    price:           parseFloat(price),
    mrp:             mrp ? parseFloat(mrp) : parseFloat(price),
    unit:            unit,
    minQty:          parseInt(minQty) || 1,
    stock:           parseInt(stock),
    organic:         !!organic,
    certifications:  cert ? cert.split(',').map(s => s.trim()).filter(Boolean) : [],
    tags:            organic ? ['Organic', 'Direct Farm'] : ['Direct Farm'],
    sellerId:        seller._id,
    sellerName:      seller.name || 'KisanMitra Seller',
    sellerEmoji:     seller.role === 'buyer' ? '🏪' : '👨‍🌾',
    sellerLocation:  [seller.district, seller.state].filter(Boolean).join(', ') || 'India',
    sellerVerified:  seller.status === 'active',
    status:          'active',     // admin can set to 'pending' for review
    rating:          0,
    reviews:         0,
    isNew:           true,
    featured:        false,
    createdAt:       Date.now(),
  };

  const created = await products.insert(newProduct);
  sendJSON(res, 201, created);
}

// ── GET /api/marketplace/orders/mine ─────────────────────────
async function myOrders(req, res) {
  const user = await getUserFromReq(req);
  if (!user)
    return sendJSON(res, 401, { error: 'Login required' });

  const mine = await orders.find({ buyerId: user._id });
  mine.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  sendJSON(res, 200, { orders: mine });
}

// ── POST /api/marketplace/orders ──────────────────────────────
async function createOrder(req, res, body) {
  const user = await getUserFromReq(req);
  if (!user)
    return sendJSON(res, 401, { error: 'Login required to place an order' });

  if (!body || !body.items || !body.items.length)
    return sendJSON(res, 400, { error: 'Order items required' });

  const { items, total } = body;

  // Validate & deduct stock
  for (const item of items) {
    const product = await products.findOne({ _id: item._id });
    if (!product)
      return sendJSON(res, 404, { error: `Product not found: ${item._id}` });
    if (product.stock < item.qty)
      return sendJSON(res, 400, { error: `Insufficient stock for ${product.name}` });
  }
  for (const item of items) {
    const product = await products.findOne({ _id: item._id });
    if (product) {
      await products.update({ _id: item._id }, { stock: product.stock - item.qty });
    }
  }

  const newOrder = {
    buyerId:     user._id,
    buyerName:   user.name || '',
    items:       items,
    total:       parseFloat(total) || items.reduce((a, c) => a + (c.price * c.qty), 0),
    status:      'processing',
    currency:    'INR',
    productName: items.length === 1 ? items[0].name : `${items.length} items`,
    emoji:       items.length === 1 ? (items[0].emoji || '📦') : '🛒',
    qty:         items.reduce((a, c) => a + c.qty, 0),
    unit:        items.length === 1 ? items[0].unit : 'items',
    createdAt:   Date.now(),
  };

  const created = await orders.insert(newOrder);
  sendJSON(res, 201, created);
}

module.exports = { listProducts, createProduct, myOrders, createOrder };
