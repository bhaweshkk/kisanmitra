/**
 * docRoutes.js — KisanMitra Document Upload & Management
 *
 * Endpoints:
 *   POST   /api/docs/upload          — upload a document (multipart base64 JSON)
 *   GET    /api/docs/my              — get current user's documents
 *   DELETE /api/docs/:docKey         — delete one document
 *   POST   /api/docs/submit          — mark docs as submitted for review
 *   GET    /api/admin/docs           — admin: get all users' doc submissions
 *   PATCH  /api/admin/docs/:userId/status — admin: approve/reject submission
 *
 * Storage strategy:
 *   - Document metadata + base64 content saved in db collection 'user_documents'
 *   - One record per user, updated in place
 *   - Actual file bytes stored as base64 in the JSON DB (fine for small files ≤5MB)
 *   - Render ephemeral filesystem is fine here — DB writes to /data/*.json
 *
 * No external deps — pure Node.js + existing db.js
 */

const db   = require('./db');   // adjust to './db' if docRoutes is in root
const docs  = db.collection('user_documents');

// ── helpers ────────────────────────────────────────────────────────
function sendJSON(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  });
  res.end(JSON.stringify(obj));
}

/** Extract user from Bearer token (same logic as auth.js) */
function getUserFromReq(req) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  const users = db.collection('users');
  return users.findOne({ token }) || null;
}

/** Parse raw body as Buffer (for multipart / binary) */
function parseRawBody(req, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('File too large (max 10 MB)')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Parse JSON body */
function parseJSONBody(req, maxBytes = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '', size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > maxBytes) { reject(new Error('Body too large')); req.destroy(); return; }
      body += c;
    });
    req.on('end', () => {
      if (!body) return resolve(null);
      try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const ALLOWED_EXT = /\.(pdf|jpg|jpeg|png|docx)$/i;
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// ── POST /api/docs/upload ──────────────────────────────────────────
// Body (JSON): { docKey, fileName, fileType, fileSize, base64, role }
async function handleUpload(req, res) {
  const user = getUserFromReq(req);
  if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });

  let body;
  try { body = await parseJSONBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
  if (!body) return sendJSON(res, 400, { error: 'Body required' });

  const { docKey, fileName, fileType, fileSize, base64, role } = body;

  // Validate
  if (!docKey || !fileName || !base64)
    return sendJSON(res, 400, { error: 'docKey, fileName and base64 are required' });
  if (!ALLOWED_TYPES.includes(fileType) && !ALLOWED_EXT.test(fileName))
    return sendJSON(res, 400, { error: 'Invalid file type. Allowed: PDF, JPG, PNG, DOCX' });
  if (fileSize && fileSize > MAX_SIZE_BYTES)
    return sendJSON(res, 400, { error: 'File exceeds 5 MB limit' });

  const userId = user._id || user.id;

  // Load or create user doc record
  let record = docs.findOne({ userId });
  const docEntry = {
    docKey,
    fileName,
    fileType: fileType || 'application/octet-stream',
    fileSize: fileSize || 0,
    base64,               // store file content as base64
    uploadedAt: new Date().toISOString(),
    role: role || user.role,
  };

  if (record) {
    // Update existing record — replace this docKey
    const existingDocs = record.documents || {};
    existingDocs[docKey] = docEntry;
    docs.updateById(record._id, { documents: existingDocs });
  } else {
    // Create new record
    docs.insert({
      userId,
      userName: user.name,
      userRole: user.role,
      userPhone: user.phone,
      documents: { [docKey]: docEntry },
      submittedAt: null,
      status: 'draft',
    });
  }

  return sendJSON(res, 200, { ok: true, docKey, fileName, uploadedAt: docEntry.uploadedAt });
}

// ── GET /api/docs/my ──────────────────────────────────────────────
function handleGetMy(req, res) {
  const user = getUserFromReq(req);
  if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });

  const userId = user._id || user.id;
  const record = docs.findOne({ userId });

  if (!record) return sendJSON(res, 200, { documents: {}, status: 'draft', submittedAt: null });

  // Return metadata only (no base64) for listing
  const meta = {};
  Object.entries(record.documents || {}).forEach(([k, v]) => {
    meta[k] = {
      docKey:     v.docKey,
      fileName:   v.fileName,
      fileType:   v.fileType,
      fileSize:   v.fileSize,
      uploadedAt: v.uploadedAt,
      role:       v.role,
    };
  });

  return sendJSON(res, 200, {
    documents:   meta,
    status:      record.status || 'draft',
    submittedAt: record.submittedAt || null,
    adminNote:   record.adminNote  || null,
  });
}

// ── GET /api/docs/file/:docKey — download a specific file ─────────
function handleGetFile(req, res, docKey) {
  const user = getUserFromReq(req);
  if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });

  const userId = user._id || user.id;
  const record = docs.findOne({ userId });
  if (!record || !record.documents || !record.documents[docKey])
    return sendJSON(res, 404, { error: 'Document not found' });

  const doc = record.documents[docKey];
  const buf = Buffer.from(doc.base64, 'base64');
  res.writeHead(200, {
    'Content-Type':        doc.fileType || 'application/octet-stream',
    'Content-Disposition': `inline; filename="${doc.fileName}"`,
    'Content-Length':      buf.length,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(buf);
}

// ── DELETE /api/docs/:docKey ───────────────────────────────────────
function handleDelete(req, res, docKey) {
  const user = getUserFromReq(req);
  if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });

  const userId = user._id || user.id;
  const record = docs.findOne({ userId });
  if (!record) return sendJSON(res, 404, { error: 'No documents found' });

  const existingDocs = record.documents || {};
  if (!existingDocs[docKey]) return sendJSON(res, 404, { error: 'Document not found' });

  delete existingDocs[docKey];
  // Reset submission if deleting after submit
  docs.updateById(record._id, { documents: existingDocs, status: 'draft', submittedAt: null });

  return sendJSON(res, 200, { ok: true, deleted: docKey });
}

// ── POST /api/docs/submit ─────────────────────────────────────────
async function handleSubmit(req, res) {
  const user = getUserFromReq(req);
  if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });

  const userId = user._id || user.id;
  const record = docs.findOne({ userId });
  if (!record) return sendJSON(res, 400, { error: 'No documents uploaded yet' });

  const uploadedKeys = Object.keys(record.documents || {});
  if (uploadedKeys.length === 0)
    return sendJSON(res, 400, { error: 'Please upload at least one document before submitting' });

  docs.updateById(record._id, {
    status:      'pending',
    submittedAt: new Date().toISOString(),
    adminNote:   null,
  });

  return sendJSON(res, 200, { ok: true, status: 'pending', submittedAt: new Date().toISOString() });
}

// ── GET /api/admin/docs ───────────────────────────────────────────
function handleAdminGetDocs(req, res) {
  const user = getUserFromReq(req);
  if (!user || user.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });

  const all = docs.find({});
  // Strip base64 from response — just metadata
  const result = all.map(record => ({
    userId:      record.userId,
    userName:    record.userName,
    userRole:    record.userRole,
    userPhone:   record.userPhone,
    status:      record.status || 'draft',
    submittedAt: record.submittedAt,
    adminNote:   record.adminNote,
    docCount:    Object.keys(record.documents || {}).length,
    docs:        Object.fromEntries(
      Object.entries(record.documents || {}).map(([k, v]) => [k, {
        fileName:   v.fileName,
        fileType:   v.fileType,
        fileSize:   v.fileSize,
        uploadedAt: v.uploadedAt,
      }])
    ),
  }));

  return sendJSON(res, 200, { submissions: result, total: result.length });
}

// ── GET /api/admin/docs/:userId/file/:docKey — admin downloads file
function handleAdminGetFile(req, res, userId, docKey) {
  const user = getUserFromReq(req);
  if (!user || user.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });

  const record = docs.findOne({ userId });
  if (!record || !record.documents || !record.documents[docKey])
    return sendJSON(res, 404, { error: 'Document not found' });

  const doc = record.documents[docKey];
  const buf = Buffer.from(doc.base64, 'base64');
  res.writeHead(200, {
    'Content-Type':        doc.fileType || 'application/octet-stream',
    'Content-Disposition': `inline; filename="${doc.fileName}"`,
    'Content-Length':      buf.length,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(buf);
}

// ── PATCH /api/admin/docs/:userId/status ──────────────────────────
async function handleAdminUpdateStatus(req, res, userId) {
  const user = getUserFromReq(req);
  if (!user || user.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });

  let body;
  try { body = await parseJSONBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
  if (!body) return sendJSON(res, 400, { error: 'Body required' });

  const { status, adminNote } = body;
  if (!['approved', 'rejected', 'pending'].includes(status))
    return sendJSON(res, 400, { error: 'status must be approved, rejected, or pending' });

  const record = docs.findOne({ userId });
  if (!record) return sendJSON(res, 404, { error: 'No documents found for this user' });

  docs.updateById(record._id, { status, adminNote: adminNote || '' });
  return sendJSON(res, 200, { ok: true, userId, status, adminNote });
}

module.exports = {
  handleUpload,
  handleGetMy,
  handleGetFile,
  handleDelete,
  handleSubmit,
  handleAdminGetDocs,
  handleAdminGetFile,
  handleAdminUpdateStatus,
};
