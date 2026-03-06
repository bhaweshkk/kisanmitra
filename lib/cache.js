/**
 * cache.js — simple in-memory TTL cache, no npm needed
 * Used to cache weather/mandi/news API responses
 */

class Cache {
  constructor({ ttlMs = 5 * 60 * 1000, maxSize = 500 } = {}) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
    this.store = new Map();

    // Periodic cleanup
    setInterval(() => this._cleanup(), ttlMs).unref();
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.store.size >= this.maxSize) this._evictOldest();
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  has(key) { return this.get(key) !== null; }

  delete(key) { this.store.delete(key); }

  clear() { this.store.clear(); }

  stats() {
    return { size: this.store.size, maxSize: this.maxSize };
  }

  _cleanup() {
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (now > v.expiresAt) this.store.delete(k);
    }
  }

  _evictOldest() {
    const oldest = [...this.store.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) this.store.delete(oldest[0]);
  }
}

module.exports = Cache;
