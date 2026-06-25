'use strict';

const { Pool } = require('pg');

if (!global.__km_pg_pool) {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      '\n[lib/db]   DATABASE_URL is not set!\n' +
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

function rowToDoc(row) {
  return {
    _id:       row.id,
    ...row.data,
    createdAt: new Date(row.created_at).getTime(),
  };
}

function matchQuery(doc, query) {
  if (!query || !Object.keys(query).length) return true;
  return Object.entries(query).every(([k, v]) => doc[k] === v);
}

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

function collection(name) {
  return {

    find(query = {})  { return pgFind(name, query); },
    findOne(query)    { return pgFind(name, query).then(r => r[0] || null); },
    findById(id)      { return pgFindById(name, id); },
    findAll()         { return pgFind(name); },
    count(query = {}) { return pgFind(name, query).then(r => r.length); },

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

    deleteById(id) { return this.removeById(id); },
  };
}
async function connectDB() {
  try {
    await ensureSchema();
    const r = await pool.query('SELECT version()');
    console.log('[lib/db] PostgreSQL connected:', r.rows[0].version.split(' ').slice(0, 2).join(' '));
  } catch (err) {
    console.error('[lib/db] PostgreSQL connection failed:', err.message);
    throw err;
  }
}

module.exports = { connectDB, collection, pool };
