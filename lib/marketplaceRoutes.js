/**
 * lib/marketplaceRoutes.js — KisanBazaar Real Marketplace Backend
 *
 * ROUTES:
 *   GET    /api/marketplace/products              → list products (public)
 *   POST   /api/marketplace/products              → create listing (auth)
 *   DELETE /api/marketplace/products/:id          → delete own listing (auth)
 *   GET    /api/marketplace/my-listings           → my products (auth)
 *   GET    /api/marketplace/orders/mine           → my orders as buyer (auth)
 *   GET    /api/marketplace/rzp-key               → Razorpay public key (public)
 *   POST   /api/marketplace/payment/create        → create Razorpay order (auth)
 *   POST   /api/marketplace/payment/verify        → verify + confirm order (auth)
 *
 * SETUP:
 *   1. Create Razorpay account at https://razorpay.com (free)
 *   2. Dashboard → Settings → API Keys → Generate Key
 *   3. Add to .env:
 *        RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxx
 *        RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxx
 *   4. For testing use rzp_test_... keys — no real money deducted
 *
 * PAYMENT FLOW:
 *   Browser  →  POST /payment/create  →  Server creates Razorpay order
 *   Server   →  Returns { razorpayOrderId, internalOrderId, amount }
 *   Browser  →  Opens Razorpay modal (UPI / Card / NetBanking / Wallet)
 *   User pays →  Razorpay calls handler(response) in browser
 *   Browser  →  POST /payment/verify with razorpay_signature
 *   Server   →  Verifies HMAC-SHA256 signature
 *   Server   →  Deducts stock, saves order as paid
 *   Browser  →  Shows "Payment successful!"
 */

'use strict';

const https  = require('https');
const crypto = require('crypto');
const db     = require('../db');

const productsCol = db.collection('mp_products');
const ordersCol   = db.collection('mp_orders');
const usersCol    = db.collection('users');

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

function getUser(req) {
  try {
    const h = req.headers['authorization'] || '';
    if (!h.startsWith('Bearer ')) return null;
    const token = h.slice(7).trim();
    if (!token) return null;
    return usersCol.find({}).find(u => u.token === token) || null;
  } catch { return null; }
}

function requireAuth(req, res) {
  const u = getUser(req);
  if (!u) { sendJSON(res, 401, { error: 'Login required' }); return null; }
  return u;
}

function makeId() {
  return Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

// ── Razorpay API call ────────────────────────────────────────────
function razorpayRequest(method, path, body) {
  const keyId     = process.env.RAZORPAY_KEY_ID     || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET  || '';

  if (!keyId || !keySecret) {
    return Promise.reject(new Error('Razorpay keys not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env'));
  }

  const auth    = Buffer.from(keyId + ':' + keySecret).toString('base64');
  const bodyStr = body ? JSON.stringify(body) : '';

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.razorpay.com',
      port: 443,
      path: '/v1' + path,
      method: method,
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.error?.description || parsed.error || 'Razorpay error ' + res.statusCode));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error('Invalid Razorpay response'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Razorpay request timed out')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── ROUTES ───────────────────────────────────────────────────────

/**
 * GET /api/marketplace/products
 * Public — returns all active products with optional filters
 */
function listProducts(req, res) {
  try {
    const urlObj  = new URL('http://x' + req.url);
    const limit   = Math.min(parseInt(urlObj.searchParams.get('limit'))  || 60, 100);
    const cat     = urlObj.searchParams.get('category') || '';
    const q       = (urlObj.searchParams.get('q') || '').toLowerCase().trim();
    const organic = urlObj.searchParams.get('organic');

    let all = productsCol.find({}).filter(p => p.status !== 'rejected' && p.status !== 'deleted');

    if (cat)     all = all.filter(p => p.category === cat);
    if (q)       all = all.filter(p =>
      (p.name        || '').toLowerCase().includes(q) ||
      (p.desc        || '').toLowerCase().includes(q) ||
      (p.sellerName  || '').toLowerCase().includes(q) ||
      (p.tags        || []).some(t => t.toLowerCase().includes(q))
    );
    if (organic === 'true') all = all.filter(p => p.organic);

    // Sort: in-stock first, then newest
    all.sort((a, b) => {
      if ((b.stock > 0) !== (a.stock > 0)) return b.stock > 0 ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    sendJSON(res, 200, { products: all.slice(0, limit), total: all.length });
  } catch (e) {
    console.error('[marketplace] listProducts error:', e.message);
    sendJSON(res, 500, { error: 'Could not load products' });
  }
}

/**
 * POST /api/marketplace/products
 * Auth required — create a new product listing
 */
async function createProduct(req, res, body) {
  try {
    const user = requireAuth(req, res); if (!user) return;
    if (!body) return sendJSON(res, 400, { error: 'Request body required' });

    const { name, price, stock, unit } = body;
    if (!name  || !String(name).trim())              return sendJSON(res, 400, { error: 'Product name is required' });
    if (!price || isNaN(price) || +price <= 0)       return sendJSON(res, 400, { error: 'Valid selling price is required' });
    if (!stock || isNaN(stock) || +stock <= 0)       return sendJSON(res, 400, { error: 'Stock quantity is required' });
    if (!unit)                                        return sendJSON(res, 400, { error: 'Unit is required (kg, litre, etc.)' });

    const product = productsCol.insert({
      name:          String(name).trim(),
      category:      body.category    || 'grains',
      desc:          (body.desc       || '').trim(),
      emoji:         body.emoji       || '🌾',
      price:         parseFloat(price),
      mrp:           body.mrp ? parseFloat(body.mrp) : parseFloat(price),
      unit:          String(unit),
      minQty:        parseInt(body.minQty) || 1,
      stock:         parseInt(stock),
      organic:       !!body.organic,
      tags:          Array.isArray(body.tags) ? body.tags.filter(Boolean) :
                     (body.tags ? String(body.tags).split(',').map(t => t.trim()).filter(Boolean) : []),
      certifications: [],
      sellerId:       user._id || user.id,
      sellerName:     user.name     || 'KisanMitra Seller',
      sellerEmoji:    user.role === 'buyer' ? '🏪' : '👨‍🌾',
      sellerLocation: [user.district, user.state].filter(Boolean).join(', ') || 'India',
      sellerVerified: user.status === 'active',
      sellerPhone:    user.phone || '',
      status:         'active',
      rating:         0,
      reviews:        0,
      totalSold:      0,
    });

    sendJSON(res, 201, product);
  } catch (e) {
    console.error('[marketplace] createProduct error:', e.message);
    sendJSON(res, 500, { error: 'Could not create listing' });
  }
}

/**
 * DELETE /api/marketplace/products/:id
 * Auth required — seller can delete their own listing
 */
function deleteProduct(req, res, productId) {
  try {
    const user = requireAuth(req, res); if (!user) return;
    const product = productsCol.findOne({ _id: productId });
    if (!product) return sendJSON(res, 404, { error: 'Product not found' });

    const uid = user._id || user.id;
    if (product.sellerId !== uid && user.role !== 'admin')
      return sendJSON(res, 403, { error: 'You can only delete your own listings' });

    productsCol.updateById(productId, { status: 'deleted', deletedAt: Date.now() });
    sendJSON(res, 200, { message: 'Listing removed' });
  } catch (e) {
    console.error('[marketplace] deleteProduct error:', e.message);
    sendJSON(res, 500, { error: 'Could not remove listing' });
  }
}

/**
 * GET /api/marketplace/my-listings
 * Auth required — seller sees their own listings
 */
function myListings(req, res) {
  try {
    const user = requireAuth(req, res); if (!user) return;
    const uid  = user._id || user.id;
    const mine = productsCol.find({ sellerId: uid }).filter(p => p.status !== 'deleted');
    mine.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    sendJSON(res, 200, { products: mine });
  } catch (e) {
    sendJSON(res, 500, { error: 'Could not load listings' });
  }
}

/**
 * GET /api/marketplace/orders/mine
 * Auth required — buyer sees their order history
 */
function myOrders(req, res) {
  try {
    const user = requireAuth(req, res); if (!user) return;
    const uid  = user._id || user.id;
    const mine = ordersCol.find({ buyerId: uid });
    mine.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    sendJSON(res, 200, { orders: mine });
  } catch (e) {
    sendJSON(res, 500, { error: 'Could not load orders' });
  }
}

/**
 * GET /api/marketplace/rzp-key
 * Public — returns Razorpay public key ID for frontend
 */
function getRzpKey(req, res) {
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  if (!keyId) {
    return sendJSON(res, 200, { key: '', configured: false,
      message: 'Razorpay not configured. Add RAZORPAY_KEY_ID to .env' });
  }
  sendJSON(res, 200, { key: keyId, configured: true });
}

/**
 * POST /api/marketplace/payment/create
 * Auth required — creates a Razorpay order on Razorpay servers
 * Body: { amount (paise), currency, items[], buyerName, buyerEmail, buyerPhone }
 */
async function createPayment(req, res, body) {
  try {
    const user = requireAuth(req, res); if (!user) return;
    if (!body || !body.items || !body.items.length)
      return sendJSON(res, 400, { error: 'Cart items required' });
    if (!body.amount || body.amount < 100)
      return sendJSON(res, 400, { error: 'Invalid payment amount' });

    // Validate stock availability before creating payment
    for (const item of body.items) {
      const product = productsCol.findOne({ _id: item._id });
      if (!product || product.status === 'deleted')
        return sendJSON(res, 404, { error: `Product not found: ${item.name || item._id}` });
      if (product.stock < item.qty)
        return sendJSON(res, 400, { error: `Insufficient stock for "${product.name}". Available: ${product.stock} ${product.unit}` });
      if (item.price !== product.price)
        return sendJSON(res, 400, { error: `Price changed for "${product.name}". Current price: ₹${product.price}/${product.unit}. Please refresh cart.` });
    }

    const receiptId = 'km_' + makeId().slice(0, 30);

    // Create order on Razorpay
    const rzpOrder = await razorpayRequest('POST', '/orders', {
      amount:   Math.round(body.amount),  // in paise
      currency: body.currency || 'INR',
      receipt:  receiptId,
      notes: {
        buyerName:  user.name  || '',
        buyerPhone: user.phone || '',
        platform:   'KisanBazaar',
      },
    });

    // Save pending order in DB
    const internalOrder = ordersCol.insert({
      buyerId:         user._id || user.id,
      buyerName:       user.name  || '',
      buyerPhone:      user.phone || '',
      buyerEmail:      user.email || '',
      items:           body.items,
      total:           body.amount / 100,
      status:          'payment_pending',
      currency:        'INR',
      razorpayOrderId: rzpOrder.id,
      receiptId:       receiptId,
      productName:     body.items.length === 1
                         ? body.items[0].name
                         : `${body.items.length} items`,
      emoji:           body.items.length === 1 ? (body.items[0].emoji || '📦') : '🛒',
      qty:             body.items.reduce((a, c) => a + c.qty, 0),
      unit:            body.items.length === 1 ? body.items[0].unit : 'items',
    });

    sendJSON(res, 200, {
      razorpayOrderId: rzpOrder.id,
      internalOrderId: internalOrder._id,
      amount:          rzpOrder.amount,
      currency:        rzpOrder.currency,
      receipt:         receiptId,
    });

  } catch (e) {
    console.error('[marketplace] createPayment error:', e.message);
    sendJSON(res, 500, { error: e.message || 'Payment setup failed' });
  }
}

/**
 * POST /api/marketplace/payment/verify
 * Auth required — verifies Razorpay signature, confirms order, deducts stock
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, internalOrderId, items[], total }
 */
async function verifyPayment(req, res, body) {
  try {
    const user = requireAuth(req, res); if (!user) return;
    if (!body) return sendJSON(res, 400, { error: 'Request body required' });

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      internalOrderId,
      items,
      total,
    } = body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
      return sendJSON(res, 400, { error: 'Missing Razorpay payment details' });

    // ── CRITICAL: Verify HMAC-SHA256 signature ─────────────────
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    if (!keySecret)
      return sendJSON(res, 500, { error: 'Payment verification not configured' });

    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.error('[marketplace] SIGNATURE MISMATCH — possible fraud attempt');
      console.error('  Expected:', expectedSignature);
      console.error('  Received:', razorpay_signature);
      return sendJSON(res, 400, { error: 'Payment verification failed — invalid signature', verified: false });
    }
    // ── Signature verified ✅ ───────────────────────────────────

    // Find internal order
    const internalOrder = ordersCol.findOne({ _id: internalOrderId });
    if (!internalOrder)
      return sendJSON(res, 404, { error: 'Order not found' });

    // Prevent double-processing
    if (internalOrder.status === 'paid')
      return sendJSON(res, 200, { verified: true, message: 'Already confirmed', order: internalOrder });

    // Deduct stock for each item
    const orderItems = items || internalOrder.items || [];
    const stockErrors = [];
    for (const item of orderItems) {
      const product = productsCol.findOne({ _id: item._id });
      if (!product) { stockErrors.push(`${item.name}: not found`); continue; }
      if (product.stock < item.qty) { stockErrors.push(`${product.name}: only ${product.stock} left`); continue; }
      productsCol.updateById(item._id, {
        stock:     product.stock - item.qty,
        totalSold: (product.totalSold || 0) + item.qty,
      });
    }

    // Confirm order as paid
    ordersCol.updateById(internalOrderId, {
      status:            'paid',
      paymentId:         razorpay_payment_id,
      razorpayOrderId:   razorpay_order_id,
      razorpaySignature: razorpay_signature,
      paidAt:            Date.now(),
      total:             total || internalOrder.total,
      stockWarnings:     stockErrors.length ? stockErrors : undefined,
    });

    const confirmedOrder = ordersCol.findOne({ _id: internalOrderId });

    console.log(`[marketplace] ✅ Payment verified — Order ${internalOrderId} — ₹${total} — Payment ${razorpay_payment_id}`);

    sendJSON(res, 200, {
      verified:  true,
      message:   'Payment verified and order confirmed',
      order:     confirmedOrder,
      warnings:  stockErrors.length ? stockErrors : undefined,
    });

  } catch (e) {
    console.error('[marketplace] verifyPayment error:', e.message);
    sendJSON(res, 500, { error: 'Payment verification error: ' + e.message });
  }
}

module.exports = {
  listProducts,
  createProduct,
  deleteProduct,
  myListings,
  myOrders,
  getRzpKey,
  createPayment,
  verifyPayment,
};
