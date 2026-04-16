/**
 * lib/rateLimiter.js — In-memory IP rate limiter
 */
class RateLimiter {
  constructor({ windowMs = 60000, maxRequests = 60, blockDurationMs = 60000 } = {}) {
    this.windowMs      = windowMs;
    this.maxRequests   = maxRequests;
    this.blockDurationMs = blockDurationMs;
    this.store         = new Map();
    // Clean up old entries every 5 minutes
    setInterval(() => this._cleanup(), 5 * 60 * 1000).unref();
  }

  check(ip) {
    const now  = Date.now();
    let entry  = this.store.get(ip);
    if (!entry) { entry = { count: 0, start: now, blocked: false, blockedUntil: 0 }; this.store.set(ip, entry); }

    if (entry.blocked) {
      if (now < entry.blockedUntil) return { allowed: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
      entry.blocked = false; entry.count = 0; entry.start = now;
    }

    if (now - entry.start > this.windowMs) { entry.count = 0; entry.start = now; }

    entry.count++;
    if (entry.count > this.maxRequests) {
      entry.blocked = true;
      entry.blockedUntil = now + this.blockDurationMs;
      return { allowed: false, retryAfter: Math.ceil(this.blockDurationMs / 1000) };
    }
    return { allowed: true };
  }

  _cleanup() {
    const now = Date.now();
    for (const [ip, entry] of this.store) {
      if (now - entry.start > this.windowMs * 2 && !entry.blocked) this.store.delete(ip);
    }
  }
}

module.exports = RateLimiter;
