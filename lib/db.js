/**
 * lib/db.js  — KisanMitra Database  (lib folder version)
 * ─────────────────────────────────────────────────────────
 * Mongoose + MongoDB Atlas has been REMOVED.
 * This file now uses PostgreSQL exclusively via the `pg` package.
 *
 * It re-exports the same { connectDB, collection } interface as the
 * root db.js so every file that does:
 *
 *   const { connectDB, collection } = require('./db');        // root files
 *   const { connectDB, collection } = require('../db');       // lib/ files
 *   const { connectDB, collection } = require('./lib/db');    // root → lib
 *
 * … will all get the same PostgreSQL-backed implementation.
 *
 * HOW DATA IS STORED
 *   One shared table: km_documents
 *     id         UUID  — primary key (exposed as _id in the app)
 *     collection TEXT  — logical "table name"
 *     data       JSONB — the full document
 *     created_at TIMESTAMPTZ
 *
 * API (identical to the old Mongoose interface)
 *   .find(query?)       → Promise<array>
 *   .findOne(query)     → Promise<object | null>
 *   .findById(id)       → Promise<object | null>
 *   .findAll()          → Promise<array>
 *   .insert(doc)        → Promise<inserted object>
 *   .update(query, ch)  → Promise<count>
 *   .updateById(id, ch) → Promise<updated object>
 *   .remove(query)      → Promise<count>
 *   .removeById(id)     → Promise<count>
 *   .count(query?)      → Promise<number>
 *
 * ENV (add to .env or hosting dashboard)
 *   DATABASE_URL=postgres://user:pass@host:5432/dbname
 */

'use strict';

const { Pool } = require('pg');

// ── Shared singleton pool ─────────────────────────────────────────
// Stored on the global object so root db.js and lib/db.js share ONE pool
// even if both files are required separately (avoids duplicate connections).
if (!global.__km_pg_pool) {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      '\n[lib/db] ❌  DATABASE_URL is not set!\n' +
      '[lib/db]    Add it to your .env file:\n' +
      '[lib/db]    DATABASE_URL=postgres://user:pass@host:5432/dbname\n' +
      '[lib/db]    Free options: neon.tech | supabase.com | render.com/docs/databases\n'
    );
  }

  global.__km_pg_pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_URL.includes('localhost') ||
      process.env.DATABASE_URL.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  global.__km_pg_pool.on('error', err => {
    console.error('[lib/db] Pool error:', err.message);
  });
}

const pool = global.__km_pg_pool;

// ── Schema bootstrap ──────────────────────────────────────────────
let _schemaReady = false;

async function ensureSchema() {
  if (_schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS km_documents (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      collection TEXT        NOT NULL,
      data       JSONB       NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_km_collection ON km_documents (collection);
    CREATE INDEX IF NOT EXISTS idx_km_created    ON km_documents (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_km_data_gin   ON km_documents USING gin (data);
  `);
  _schemaReady = true;
}

// ── Row → app document ────────────────────────────────────────────
function rowToDoc(row) {
  return {
    _id:       row.id,
    ...row.data,
    createdAt: new Date(row.created_at).getTime(),
  };
}

// ── Simple filter (mirrors MongoDB .find behaviour) ───────────────
function matchQuery(doc, query) {
  if (!query || !Object.keys(query).length) return true;
  return Object.entries(query).every(([k, v]) => doc[k] === v);
}

// ── Shared fetch helper ───────────────────────────────────────────
async function pgFind(colName, query = {}) {
  await ensureSchema();
  const res = await pool.query(
    `SELECT id, data, created_at
       FROM km_documents
      WHERE collection = $1
      ORDER BY created_at DESC`,
    [colName]
  );
  return res.rows.map(rowToDoc).filter(d => matchQuery(d, query));
}

async function pgFindById(colName, id) {
  await ensureSchema();
  const res = await pool.query(
    `SELECT id, data, created_at
       FROM km_documents
      WHERE collection = $1 AND id = $2
      LIMIT 1`,
    [colName, id]
  );
  return res.rows.length ? rowToDoc(res.rows[0]) : null;
}

// ── Collection factory ────────────────────────────────────────────
// Identical interface to the old Mongoose collection() helper.
function collection(name) {
  return {

    // ── READ ────────────────────────────────────────────────────────
    find(query = {})  { return pgFind(name, query); },
    findOne(query)    { return pgFind(name, query).then(r => r[0] || null); },
    findById(id)      { return pgFindById(name, id); },
    findAll()         { return pgFind(name); },
    count(query = {}) { return pgFind(name, query).then(r => r.length); },

    // ── INSERT ──────────────────────────────────────────────────────
    async insert(doc) {
      await ensureSchema();
      const { _id, id, createdAt, created_at, updatedAt, updated_at, ...payload } = doc;
      const res = await pool.query(
        `INSERT INTO km_documents (collection, data)
         VALUES ($1, $2)
         RETURNING id, data, created_at`,
        [name, JSON.stringify(payload)]
      );
      return rowToDoc(res.rows[0]);
    },

    // ── UPDATE ──────────────────────────────────────────────────────
    async update(query, changes) {
      const docs = await pgFind(name, query);
      if (!docs.length) return 0;
      const { _id, id, createdAt, created_at, ...patch } = changes;
      let count = 0;
      for (const doc of docs) {
        await pool.query(
          `UPDATE km_documents
              SET data = data || $1::jsonb
            WHERE collection = $2 AND id = $3`,
          [JSON.stringify({ ...patch, updatedAt: Date.now() }), name, doc._id]
        );
        count++;
      }
      return count;
    },

    async updateById(id, changes) {
      await ensureSchema();
      const { _id, id: _i, createdAt, created_at, ...patch } = changes;
      const res = await pool.query(
        `UPDATE km_documents
            SET data = data || $1::jsonb
          WHERE collection = $2 AND id = $3
          RETURNING id, data, created_at`,
        [JSON.stringify({ ...patch, updatedAt: Date.now() }), name, id]
      );
      return res.rows.length ? rowToDoc(res.rows[0]) : null;
    },

    // ── DELETE ──────────────────────────────────────────────────────
    async remove(query) {
      const docs = await pgFind(name, query);
      if (!docs.length) return 0;
      let count = 0;
      for (const doc of docs) {
        await pool.query(
          `DELETE FROM km_documents WHERE collection = $1 AND id = $2`,
          [name, doc._id]
        );
        count++;
      }
      return count;
    },

    async removeById(id) {
      await ensureSchema();
      await pool.query(
        `DELETE FROM km_documents WHERE collection = $1 AND id = $2`,
        [name, id]
      );
      return 1;
    },

    // Alias kept for back-compat with server.js
    deleteById(id) { return this.removeById(id); },
  };
}

// ── connectDB — call once at server startup ───────────────────────
async function connectDB() {
  try {
    await ensureSchema();
    const r = await pool.query('SELECT version()');
    console.log('[lib/db] ✅ PostgreSQL connected:', r.rows[0].version.split(' ').slice(0, 2).join(' '));
  } catch (err) {
    console.error('[lib/db] ❌ PostgreSQL connection failed:', err.message);
    throw err;
  }
}

module.exports = { connectDB, collection, pool };
