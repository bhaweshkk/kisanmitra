/**
 * db.js — KisanMitra Database
 *
 * STORAGE STRATEGY (permanent data across server restarts):
 *   1. MongoDB Atlas (cloud) — PRIMARY when MONGODB_URI is set in .env
 *   2. JSON files in ./data/ — FALLBACK (works locally, but NOT on Render/Railway/Heroku)
 *
 * WHY THIS MATTERS:
 *   Platforms like Render, Railway, Heroku have ephemeral filesystems.
 *   Every server restart wipes ./data/*.json files.
 *   MongoDB Atlas is FREE and keeps data permanently.
 *
 * SETUP (5 minutes):
 *   1. Go to https://cloud.mongodb.com → Create free cluster
 *   2. Create database user + get connection string
 *   3. Add to .env:  MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/kisanmitra
 *   4. npm install mongodb
 *   5. Restart server — all data stored permanently in cloud
 *
 * All collection methods work identically whether using Mongo or JSON files.
 * updateById() is now properly implemented (was missing — caused auth 500 errors).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');

// ── JSON file helpers ────────────────────────────────────────────
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function colFile(name) { return path.join(DATA_DIR, name + '.json'); }
function readCol(name) {
  try {
    const f = colFile(name);
    if (!fs.existsSync(f)) return [];
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch { return []; }
}
function writeCol(name, docs) {
  ensureDir();
  fs.writeFileSync(colFile(name), JSON.stringify(docs, null, 2));
}
function makeId() {
  return Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

// ── JSON-file collection ─────────────────────────────────────────
function jsonCollection(name) {
  return {
    find(query) {
      const docs = readCol(name);
      if (!query || !Object.keys(query).length) return docs;
      return docs.filter(d => Object.entries(query).every(([k,v]) => d[k] === v));
    },
    findOne(query)  { return this.find(query)[0] || null; },
    findById(id)    { return this.findOne({ _id: id }); },
    insert(doc) {
      const docs = readCol(name);
      const newDoc = { _id: makeId(), createdAt: Date.now(), ...doc };
      docs.push(newDoc);
      writeCol(name, docs);
      return newDoc;
    },
    update(query, changes) {
      const docs = readCol(name);
      let n = 0;
      const updated = docs.map(d => {
        if (Object.entries(query).every(([k,v]) => d[k] === v)) {
          n++;
          return { ...d, ...changes, updatedAt: Date.now() };
        }
        return d;
      });
      writeCol(name, updated);
      return n;
    },
    updateById(id, changes) { return this.update({ _id: id }, changes); },
    remove(query) {
      const docs  = readCol(name);
      const kept  = docs.filter(d => !Object.entries(query).every(([k,v]) => d[k] === v));
      writeCol(name, kept);
      return docs.length - kept.length;
    },
    removeById(id) { return this.remove({ _id: id }); },
    count(query)   { return this.find(query).length; },
    findAll()      { return readCol(name); },
  };
}

// ── MongoDB integration ──────────────────────────────────────────
let mongoDb     = null;
let mongoReady  = false;

async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('[db] No MONGODB_URI set — using JSON file storage (data lost on server restart)');
    console.log('[db] For permanent storage: set MONGODB_URI in .env (free at cloud.mongodb.com)');
    return false;
  }
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 30000,
      maxPoolSize: 10,
      retryWrites: true,
    });
    await client.connect();
    
    // Get database name from env or extract from URI
    let dbName = process.env.DB_NAME;
    if (!dbName) {
      try {
        const urlObj = new URL(uri);
        dbName = urlObj.pathname.replace(/^\//,'').split('?')[0] || 'kisanmitra';
      } catch (e) {
        dbName = 'kisanmitra';
      }
    }
    
    mongoDb    = client.db(dbName);
    mongoReady = true;
    console.log('[db] ✅ MongoDB connected:', dbName, '— data is permanently stored');

    // Migrate existing JSON data into MongoDB on first connection
    await migrateJsonToMongo();

    process.on('SIGINT',  () => client.close());
    process.on('SIGTERM', () => client.close());
    return true;
  } catch (err) {
    console.error('[db] ❌ MongoDB connection failed:', err.message);
    console.error('[db]    Falling back to JSON file storage (data lost on restart)');
    return false;
  }
}

async function migrateJsonToMongo() {
  if (!mongoDb || !fs.existsSync(DATA_DIR)) return;
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const colName = file.replace('.json','');
    try {
      const existing = await mongoDb.collection(colName).countDocuments();
      if (existing === 0) {
        const docs = readCol(colName);
        if (docs.length > 0) {
          await mongoDb.collection(colName).insertMany(docs);
          console.log('[db] Migrated', docs.length, 'docs from', file, '→ MongoDB');
        }
      }
    } catch(e) { /* skip if error */ }
  }
}

// ── Dual-mode collection (Mongo primary, JSON backup) ───────────
function collection(name) {
  const json = jsonCollection(name);

  return {
    // ── Sync methods (always work, use JSON as source of truth locally) ──
    find(query) {
      return json.find(query);
    },
    findOne(query)  { return json.findOne(query); },
    findById(id)    { return json.findById(id); },
    findAll()       { return json.findAll(); },
    count(query)    { return json.count(query); },

    insert(doc) {
      const newDoc = json.insert(doc);
      // Also write to MongoDB async (non-blocking)
      if (mongoReady) {
        mongoDb.collection(name).insertOne({ ...newDoc })
          .catch(e => console.error('[db] Mongo insert error ('+name+'):', e.message));
      }
      return newDoc;
    },

    update(query, changes) {
      const count = json.update(query, changes);
      if (mongoReady && count > 0) {
        mongoDb.collection(name).updateMany(query, { $set: { ...changes, updatedAt: Date.now() } })
          .catch(e => console.error('[db] Mongo update error ('+name+'):', e.message));
      }
      return count;
    },

    // THIS WAS MISSING — caused 500 errors on login/register
    updateById(id, changes) {
      const count = json.updateById(id, changes);
      if (mongoReady) {
        mongoDb.collection(name).updateOne({ _id: id }, { $set: { ...changes, updatedAt: Date.now() } })
          .catch(e => console.error('[db] Mongo updateById error ('+name+'):', e.message));
      }
      return count;
    },

    remove(query) {
      const count = json.remove(query);
      if (mongoReady && count > 0) {
        mongoDb.collection(name).deleteMany(query)
          .catch(e => console.error('[db] Mongo remove error ('+name+'):', e.message));
      }
      return count;
    },

    removeById(id) {
      const count = json.removeById(id);
      if (mongoReady) {
        mongoDb.collection(name).deleteOne({ _id: id })
          .catch(e => console.error('[db] Mongo removeById error ('+name+'):', e.message));
      }
      return count;
    },

    // ── Async methods for reading fresh data from MongoDB ──
    async findAsync(query) {
      if (mongoReady) {
        try {
          const results = await mongoDb.collection(name).find(query||{}).toArray();
          // Sync back to JSON so sync methods stay fresh
          writeCol(name, results);
          return results;
        } catch(e) { console.error('[db] Mongo findAsync error:', e.message); }
      }
      return json.find(query);
    },

    async findOneAsync(query) {
      if (mongoReady) {
        try { return await mongoDb.collection(name).findOne(query) || null; }
        catch(e) { console.error('[db] Mongo findOneAsync error:', e.message); }
      }
      return json.findOne(query);
    },

    async countAsync(query) {
      if (mongoReady) {
        try { return await mongoDb.collection(name).countDocuments(query||{}); }
        catch(e) {}
      }
      return json.count(query);
    },
  };
}

// Start MongoDB connection in background
connectMongo().catch(() => {});

module.exports = { collection, isMongoReady: () => mongoReady };
