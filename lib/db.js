/**
 * lib/db.js — Lightweight JSON file database (no npm packages needed)
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function colFile(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readCol(name) {
  const file = colFile(name);
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

function writeCol(name, docs) {
  ensureDir();
  fs.writeFileSync(colFile(name), JSON.stringify(docs, null, 2));
}

function collection(name) {
  return {
    find(query) {
      const docs = readCol(name);
      if (!query) return docs;
      return docs.filter(d => Object.entries(query).every(([k, v]) => d[k] === v));
    },
    findOne(query) {
      return this.find(query)[0] || null;
    },
    insert(doc) {
      const docs = readCol(name);
      const newDoc = { _id: Date.now() + '_' + Math.random().toString(36).slice(2), ...doc };
      docs.push(newDoc);
      writeCol(name, docs);
      return newDoc;
    },
    update(query, changes) {
      const docs = readCol(name);
      let count = 0;
      const updated = docs.map(d => {
        if (Object.entries(query).every(([k, v]) => d[k] === v)) { count++; return { ...d, ...changes }; }
        return d;
      });
      writeCol(name, updated);
      return count;
    },
    remove(query) {
      const docs = readCol(name);
      const kept = docs.filter(d => !Object.entries(query).every(([k, v]) => d[k] === v));
      writeCol(name, kept);
      return docs.length - kept.length;
    },
    removeById(id) {
      return this.remove({ _id: id });
    },
    count(query) { return this.find(query).length; },
  };
}

module.exports = { collection };
