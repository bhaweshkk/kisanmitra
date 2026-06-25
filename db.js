'use strict';
const { Pool } = require('pg');
let _pool = null;
function getPool() {
  if (_pool) return _pool;
  if (!process.env.DATABASE_URL) {
    throw new Error(
      '\n[db] ❌  DATABASE_URL is not set!\n' +
      '[db]    Add it to your .env file:\n' +
      '[db]    DATABASE_URL=postgres://user:pass@host:5432/dbname\n' +
      '[db]    Free options: neon.tech | supabase.com | render.com/docs/databases\n'
    );
  }

  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
    max:                    10,
    idleTimeoutMillis:      30000,
    connectionTimeoutMillis: 10000,
  });

  _pool.on('error', err => {
    console.error('[db] Pool error:', err.message);
  });

  return _pool;
}


let _schemaReady = false;

async function ensureSchema() {
  if (_schemaReady) return;
  await getPool().query(`
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
    _id: row.id,
    ...row.data,
    createdAt: new Date(row.created_at).getTime(),
  };
}

function matchQuery(doc, query) {
  if (!query || !Object.keys(query).length) return true;
  return Object.entries(query).every(([k, v]) => doc[k] === v);
}

async function dbFind(colName, query = {}) {
  await ensureSchema();
  const res = await getPool().query(
    `SELECT id, data, created_at
       FROM km_documents
      WHERE collection = $1
      ORDER BY created_at DESC`,
    [colName]
  );
  const docs = res.rows.map(rowToDoc);
  return docs.filter(d => matchQuery(d, query));
}

async function dbFindById(colName, id) {
  await ensureSchema();
  const res = await getPool().query(
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

    async find(query)     { return dbFind(name, query); },
    async findOne(query)  { const all = await dbFind(name, query); return all[0] || null; },
    async findById(id)    { return dbFindById(name, id); },
    async findAll()       { return dbFind(name); },
    async count(query)    { return (await dbFind(name, query)).length; },

    async findAsync(query)    { return dbFind(name, query); },
    async findOneAsync(query) { const all = await dbFind(name, query); return all[0] || null; },
    async countAsync(query)   { return (await dbFind(name, query)).length; },

    async insert(doc) {
      await ensureSchema();
      const { _id, id, createdAt, created_at, updatedAt, updated_at, ...payload } = doc;
      const res = await getPool().query(
        `INSERT INTO km_documents (collection, data)
         VALUES ($1, $2)
         RETURNING id, data, created_at`,
        [name, JSON.stringify(payload)]
      );
      return rowToDoc(res.rows[0]);
    },
    async update(query, changes) {
      const docs = await dbFind(name, query);
      if (!docs.length) return 0;
      const { _id, id, createdAt, created_at, ...patch } = changes;
      let count = 0;
      for (const doc of docs) {
        await getPool().query(
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
      const res = await getPool().query(
        `UPDATE km_documents
            SET data = data || $1::jsonb
          WHERE collection = $2 AND id = $3
          RETURNING id, data, created_at`,
        [JSON.stringify({ ...patch, updatedAt: Date.now() }), name, id]
      );
      return res.rows.length ? rowToDoc(res.rows[0]) : null;
    },

    async remove(query) {
      const docs = await dbFind(name, query);
      if (!docs.length) return 0;
      let count = 0;
      for (const doc of docs) {
        await getPool().query(
          `DELETE FROM km_documents WHERE collection = $1 AND id = $2`,
          [name, doc._id]
        );
        count++;
      }
      return count;
    },

    async removeById(id) {
      await ensureSchema();
      await getPool().query(
        `DELETE FROM km_documents WHERE collection = $1 AND id = $2`,
        [name, id]
      );
      return 1;
    },

    async deleteById(id) { return this.removeById(id); },
  };
}

async function connectDB() {
  try {
    await ensureSchema();
    const r = await getPool().query('SELECT version()');
    console.log('[db]  PostgreSQL connected:', r.rows[0].version.split(' ').slice(0, 2).join(' '));
  } catch (err) {
    console.error('[db]  PostgreSQL connection failed:', err.message);
    throw err;
  }
}

function isMongoReady() { return false; }

module.exports = { connectDB, collection, isMongoReady, getPool };
