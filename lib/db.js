/**
 * db.js — Zero-dependency JSON file database
 * Supports: insert, find, findOne, update, delete, count
 * Data is persisted to /data/*.json files
 * Uses atomic writes (write to .tmp then rename) to prevent corruption
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

class Collection {
  constructor(name) {
    this.name = name;
    this.file = path.join(DATA_DIR, `${name}.json`);
    this._data = null; // lazy-loaded
  }

  // ── Internal ─────────────────────────────────
  _load() {
    if (this._data) return;
    if (!fs.existsSync(this.file)) { this._data = []; return; }
    try {
      this._data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this._data = [];
    }
  }

  _save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this._data, null, 2));
    fs.renameSync(tmp, this.file); // atomic swap
  }

  _genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  _match(doc, query) {
    return Object.entries(query).every(([k, v]) => {
      if (typeof v === 'object' && v !== null) {
        if ('$gt'  in v) return doc[k] >  v.$gt;
        if ('$gte' in v) return doc[k] >= v.$gte;
        if ('$lt'  in v) return doc[k] <  v.$lt;
        if ('$lte' in v) return doc[k] <= v.$lte;
        if ('$ne'  in v) return doc[k] !== v.$ne;
        if ('$in'  in v) return v.$in.includes(doc[k]);
      }
      return doc[k] === v;
    });
  }

  // ── Public API ───────────────────────────────

  /** Insert one document, returns it with _id and createdAt */
  insert(doc) {
    this._load();
    const record = { _id: this._genId(), createdAt: new Date().toISOString(), ...doc };
    this._data.push(record);
    this._save();
    return record;
  }

  /** Insert multiple documents */
  insertMany(docs) {
    return docs.map(d => this.insert(d));
  }

  /** Find all matching docs. query = {} returns all */
  find(query = {}, { limit = 0, skip = 0, sort = null } = {}) {
    this._load();
    let results = Object.keys(query).length === 0
      ? [...this._data]
      : this._data.filter(d => this._match(d, query));

    if (sort) {
      const [field, dir] = Object.entries(sort)[0];
      results.sort((a, b) => dir === -1 ? (b[field] > a[field] ? 1 : -1) : (a[field] > b[field] ? 1 : -1));
    }
    if (skip) results = results.slice(skip);
    if (limit) results = results.slice(0, limit);
    return results;
  }

  /** Find a single document */
  findOne(query = {}) {
    this._load();
    return this._data.find(d => this._match(d, query)) || null;
  }

  /** Find by _id */
  findById(id) {
    return this.findOne({ _id: id });
  }

  /** Update all matching docs. Returns count updated */
  update(query, changes) {
    this._load();
    let count = 0;
    this._data = this._data.map(doc => {
      if (!this._match(doc, query)) return doc;
      count++;
      return { ...doc, ...changes, updatedAt: new Date().toISOString() };
    });
    if (count > 0) this._save();
    return count;
  }

  /** Update one doc by _id */
  updateById(id, changes) {
    return this.update({ _id: id }, changes);
  }

  /** Delete all matching docs. Returns count deleted */
  delete(query) {
    this._load();
    const before = this._data.length;
    this._data = this._data.filter(d => !this._match(d, query));
    const count = before - this._data.length;
    if (count > 0) this._save();
    return count;
  }

  /** Delete by _id */
  deleteById(id) {
    return this.delete({ _id: id });
  }

  /** Count matching docs */
  count(query = {}) {
    this._load();
    if (!Object.keys(query).length) return this._data.length;
    return this._data.filter(d => this._match(d, query)).length;
  }

  /** Drop entire collection */
  drop() {
    this._data = [];
    if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
  }

  stats() {
    this._load();
    return { name: this.name, count: this._data.length, file: this.file };
  }
}

// ── DB facade (MongoDB-like) ──────────────────
const _collections = {};

const db = {
  collection(name) {
    if (!_collections[name]) _collections[name] = new Collection(name);
    return _collections[name];
  },

  stats() {
    return Object.values(_collections).map(c => c.stats());
  },
};

// ── Pre-defined collections ───────────────────
db.contacts  = db.collection('contacts');
db.chatLogs  = db.collection('chat_logs');
db.sessions  = db.collection('sessions');
db.cropPrices = db.collection('crop_prices');

module.exports = db;
