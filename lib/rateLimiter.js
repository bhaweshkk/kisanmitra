/**
 * rateLimiter.js — sliding window rate limiter, no npm needed
 */

class RateLimiter {
  constructor({ windowMs = 60000, maxRequests = 60, blockDurationMs = 60000 } = {}) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.blockDurationMs = blockDurationMs;
    this.records = new Map();   // ip → { hits: [{ts}], blocked: bool, blockedUntil }

    // Cleanup stale entries every 2 minutes
    setInterval(() => this._cleanup(), 2 * 60 * 1000).unref();
  }

  check(ip) {
    const now = Date.now();
    let record = this.records.get(ip);

    if (!record) {
      record = { hits: [], blocked: false, blockedUntil: 0 };
      this.records.set(ip, record);
    }

    // Still blocked?
    if (record.blocked) {
      if (now < record.blockedUntil) {
        return { allowed: false, retryAfter: Math.ceil((record.blockedUntil - now) / 1000) };
      }
      record.blocked = false;
      record.hits = [];
    }

    // Remove hits outside the window
    record.hits = record.hits.filter(ts => now - ts < this.windowMs);
    record.hits.push(now);

    if (record.hits.length > this.maxRequests) {
      record.blocked = true;
      record.blockedUntil = now + this.blockDurationMs;
      return { allowed: false, retryAfter: Math.ceil(this.blockDurationMs / 1000) };
    }

    return {
      allowed: true,
      remaining: this.maxRequests - record.hits.length,
      resetIn: Math.ceil(this.windowMs / 1000),
    };
  }

  _cleanup() {
    const now = Date.now();
    for (const [ip, record] of this.records.entries()) {
      const allOld = record.hits.every(ts => now - ts > this.windowMs);
      if (allOld && !record.blocked) this.records.delete(ip);
    }
  }

  stats() {
    return { trackedIPs: this.records.size };
  }
}

module.exports = RateLimiter;
