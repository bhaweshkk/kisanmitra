/**
 * innovateRoutes.js — AgriInnovate API
 *
 * Routes handled (add these to server.js router):
 *   GET  /api/innovate/companies    → list verified companies + startup ideas
 *   POST /api/innovate/stories      → submit a company story for review
 *   GET  /api/innovate/stories      → admin: list all pending stories
 *   PATCH /api/innovate/stories/:id → admin: approve/reject a story
 *
 * HOW TO WIRE INTO server.js:
 *   const innovateRoutes = require('./lib/innovateRoutes');
 *   if (pathname === '/api/innovate/companies' && method === 'GET') { innovateRoutes.listCompanies(req, res); return; }
 *   if (pathname === '/api/innovate/stories'   && method === 'POST') { const body = await parseBody(req).catch(()=>null); innovateRoutes.submitStory(req, res, body); return; }
 *   if (pathname === '/api/innovate/stories'   && method === 'GET')  { innovateRoutes.adminListStories(req, res); return; }
 *   if (pathname.match(/^\/api\/innovate\/stories\/[^/]+$/) && method === 'PATCH') {
 *     const storyId = pathname.split('/').pop();
 *     const body = await parseBody(req).catch(()=>null);
 *     innovateRoutes.adminUpdateStory(req, res, storyId, body); return;
 *   }
 *
 * HOW TO SEED COMPANIES:
 *   Run node seed-innovate.js once (file below) to populate the database.
 *   After that, all data is live from your JSON DB — no hardcoded arrays.
 */

const db = require('../db');

const companies = db.collection('innovate_companies');
const ideas     = db.collection('innovate_ideas');
const stories   = db.collection('innovate_stories');   // pending submissions
const users     = db.collection('users');

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

// ── GET /api/innovate/companies ────────────────────────────────
async function listCompanies(req, res) {
  const verified = await companies.find({ status: 'published' });
  verified.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const allIdeas = await ideas.find({});
  allIdeas.sort((a, b) => (a.order || 99) - (b.order || 99));

  sendJSON(res, 200, { companies: verified, ideas: allIdeas });
}

// ── POST /api/innovate/stories ─────────────────────────────────
async function submitStory(req, res, body) {
  if (!body)
    return sendJSON(res, 400, { error: 'Request body required' });

  const { name, sector, founded, location, shortDesc } = body;
  if (!name || !sector || !founded || !location || !shortDesc)
    return sendJSON(res, 400, { error: 'Name, sector, founded year, location and description are required' });

  const user = await getUserFromReq(req);

  const newStory = {
    ...body,
    submittedBy:     user ? user.name : (body.submittedBy || 'Anonymous'),
    submittedById:   user ? user._id : null,
    status:          'pending',
    createdAt:       Date.now(),
  };

  const created = await stories.insert(newStory);
  sendJSON(res, 201, { message: 'Story submitted for review. Our team will review within 3 business days.', id: created._id });
}

// ── GET /api/innovate/stories (admin) ─────────────────────────
async function adminListStories(req, res) {
  const user = await getUserFromReq(req);
  if (!user || user.role !== 'admin')
    return sendJSON(res, 403, { error: 'Admin access required' });

  const all = await stories.find({});
  all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  sendJSON(res, 200, { stories: all });
}

// ── PATCH /api/innovate/stories/:id (admin approve/reject) ────
async function adminUpdateStory(req, res, storyId, body) {
  const user = await getUserFromReq(req);
  if (!user || user.role !== 'admin')
    return sendJSON(res, 403, { error: 'Admin access required' });

  const story = await stories.findOne({ _id: storyId });
  if (!story)
    return sendJSON(res, 404, { error: 'Story not found' });

  if (!body || !body.action)
    return sendJSON(res, 400, { error: 'action (approve|reject) required' });

  if (body.action === 'approve') {
    // Promote story to a published company
    const company = {
      name:              story.name,
      tagline:           story.shortDesc ? story.shortDesc.slice(0, 80) : '',
      shortDesc:         story.shortDesc || '',
      sector:            story.sector || '',
      category:          body.category || 'platform',
      founded:           story.founded || '',
      location:          story.location || '',
      founders:          story.founders || [],
      funding:           story.funding || '',
      farmersImpacted:   story.farmersImpacted || '',
      employees:         story.employees || '',
      states:            story.states || '',
      website:           story.website || '',
      emoji:             body.emoji || '🌾',
      bannerColor:       body.bannerColor || 'linear-gradient(135deg,#064e3b,#065f46)',
      stage:             body.stage || '',
      model:             story.model || '',
      innovation:        story.innovation || '',
      lessons:           story.lessons || [],
      forStarters:       story.forStarters || '',
      story:             body.story || [],       // admin can enrich this
      certifications:    body.certifications || [],
      tags:              body.tags || [],
      authenticityScore: body.authenticityScore || 85,
      auditor:           body.auditor || 'KisanMitra Team',
      verified:          true,
      status:            'published',
      createdAt:         Date.now(),
      originalStoryId:   storyId,
    };
    const created = await companies.insert(company);
    await stories.update({ _id: storyId }, { status: 'approved', approvedAt: Date.now() });
    sendJSON(res, 200, { message: 'Story approved and published', company: created });
  } else if (body.action === 'reject') {
    await stories.update({ _id: storyId }, { status: 'rejected', rejectedAt: Date.now(), reason: body.reason || '' });
    sendJSON(res, 200, { message: 'Story rejected' });
  } else {
    sendJSON(res, 400, { error: 'action must be approve or reject' });
  }
}

module.exports = { listCompanies, submitStory, adminListStories, adminUpdateStory };
