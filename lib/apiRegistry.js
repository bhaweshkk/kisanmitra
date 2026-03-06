/**
 * apiRegistry.js — Universal API Plugin System
 *
 * Define ANY external API in apis.config.json and it gets a route automatically.
 * No code changes needed — just add/edit entries in the config file.
 *
 * Each plugin can:
 *  - Proxy requests to any external API
 *  - Inject API keys from .env
 *  - Cache responses for a configurable TTL
 *  - Transform requests and responses with built-in transforms
 *  - Support GET and POST methods
 */

const fs           = require('fs');
const path         = require('path');
const { request }  = require('./httpHelper');
const Cache        = require('./cache');
const logger       = require('./logger');

const CONFIG_FILE  = path.join(__dirname, '..', 'apis.config.json');

// One cache instance per plugin (keyed by plugin name)
const caches = {};

// ── Load & Watch Config ───────────────────────
let plugins = [];

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    plugins = JSON.parse(raw).apis || [];
    // Rebuild caches for any new/changed plugins
    for (const p of plugins) {
      if (p.cache && !caches[p.name]) {
        caches[p.name] = new Cache({ ttlMs: (p.cache.ttlMinutes || 5) * 60 * 1000 });
      }
    }
    logger.info(`API Registry: loaded ${plugins.length} plugin(s)`, {
      names: plugins.map(p => p.name),
    });
  } catch (e) {
    logger.warn('Could not load apis.config.json', { message: e.message });
    plugins = [];
  }
}

// Hot-reload config when file changes
if (fs.existsSync(CONFIG_FILE)) {
  fs.watch(CONFIG_FILE, () => {
    setTimeout(loadConfig, 100); // debounce
    logger.info('apis.config.json changed — reloading plugins');
  });
}

loadConfig();

// ── Template Engine ───────────────────────────
// Replaces {{KEY}} with env vars or request params
function interpolate(template, vars) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key in vars) return vars[key];
    if (process.env[key]) return process.env[key];
    return '';
  });
}

function interpolateObj(obj, vars) {
  if (typeof obj === 'string') return interpolate(obj, vars);
  if (Array.isArray(obj))     return obj.map(v => interpolateObj(v, vars));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = interpolateObj(v, vars);
    return out;
  }
  return obj;
}

// ── Response Transformer ──────────────────────
// Pulls a nested field from the response using dot-notation
// e.g. "data.items" → response.data.items
function extractField(obj, dotPath) {
  if (!dotPath) return obj;
  return dotPath.split('.').reduce((acc, key) => acc?.[key], obj);
}

// ── Build URL with query params ───────────────
function buildUrl(plugin, queryParams, bodyParams, vars) {
  let baseUrl = interpolate(plugin.url, vars);

  // Merge staticParams + forwarded query params
  const allParams = { ...(plugin.staticParams || {}) };

  // Forward whitelisted query params from the incoming request
  if (plugin.forwardParams) {
    for (const key of plugin.forwardParams) {
      if (queryParams[key] !== undefined) allParams[key] = queryParams[key];
      if (bodyParams && bodyParams[key] !== undefined) allParams[key] = bodyParams[key];
    }
  }

  // Interpolate param values (inject env vars / keys)
  const finalParams = interpolateObj(allParams, vars);

  if (Object.keys(finalParams).length > 0) {
    const qs = new URLSearchParams(finalParams).toString();
    baseUrl += (baseUrl.includes('?') ? '&' : '?') + qs;
  }

  return baseUrl;
}

// ── Main Handler ──────────────────────────────
function makePluginHandler(plugin) {
  return async function pluginHandler(req, res, queryParams, body) {
    const vars = { ...queryParams, ...(body || {}) };

    // ── Cache check ──────────────────────────
    let cacheKey = null;
    if (plugin.cache && caches[plugin.name]) {
      cacheKey = plugin.name + ':' + JSON.stringify(vars);
      const cached = caches[plugin.name].get(cacheKey);
      if (cached) {
        logger.debug(`Cache HIT for ${plugin.name}`);
        return sendJSON(res, 200, { ...cached, _cached: true, _plugin: plugin.name });
      }
    }

    // ── Build request ────────────────────────
    const url = buildUrl(plugin, queryParams, body, vars);

    const headers = interpolateObj(plugin.headers || {}, vars);

    // Inject API key into header if configured
    if (plugin.apiKeyEnvVar && plugin.apiKeyHeader) {
      const key = process.env[plugin.apiKeyEnvVar];
      if (!key) {
        return sendJSON(res, 503, {
          error: `API key not configured. Set ${plugin.apiKeyEnvVar} in your .env file.`,
          plugin: plugin.name,
        });
      }
      headers[plugin.apiKeyHeader] = interpolate(plugin.apiKeyFormat || '{{' + plugin.apiKeyEnvVar + '}}', { [plugin.apiKeyEnvVar]: key });
    }

    // Build request body for POST plugins
    let requestBody = null;
    if (plugin.method === 'POST' && plugin.bodyTemplate) {
      requestBody = interpolateObj(plugin.bodyTemplate, vars);
    } else if (plugin.method === 'POST' && body) {
      requestBody = body;
    }

    logger.debug(`Plugin [${plugin.name}] → ${plugin.method} ${url}`);

    try {
      const result = await request(url, {
        method: plugin.method || 'GET',
        headers,
        body: requestBody,
        timeoutMs: (plugin.timeoutSeconds || 15) * 1000,
      });

      if (result.status >= 400) {
        logger.warn(`Plugin [${plugin.name}] upstream error`, { status: result.status });
        return sendJSON(res, result.status, {
          error: `Upstream API returned ${result.status}`,
          plugin: plugin.name,
          detail: result.json || result.text?.slice(0, 300),
        });
      }

      // Extract specific field from response if configured
      let data = result.json ?? { raw: result.text };
      if (plugin.responseField) data = extractField(data, plugin.responseField);

      // Wrap in envelope if configured
      const envelope = plugin.responseEnvelope
        ? { [plugin.responseEnvelope]: data, _plugin: plugin.name }
        : (data && typeof data === 'object' ? { ...data, _plugin: plugin.name } : { data, _plugin: plugin.name });

      // Cache successful response
      if (cacheKey && caches[plugin.name]) {
        caches[plugin.name].set(cacheKey, envelope);
      }

      sendJSON(res, 200, envelope);

    } catch (e) {
      logger.error(`Plugin [${plugin.name}] request failed`, { message: e.message });
      sendJSON(res, 502, { error: e.message, plugin: plugin.name });
    }
  };
}

// ── Route Matcher ─────────────────────────────
function parseQueryString(urlStr) {
  const u = new URL('http://x' + urlStr);
  const out = {};
  for (const [k, v] of u.searchParams.entries()) out[k] = v;
  return out;
}

async function handlePluginRoute(req, res, pathname, body) {
  const method = req.method.toUpperCase();
  const queryParams = parseQueryString(req.url);

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;

    const expectedPath = `/api/plugins/${plugin.name}`;
    if (pathname !== expectedPath) continue;

    const allowedMethod = (plugin.method === 'POST') ? 'POST' : 'GET';
    if (method !== allowedMethod && method !== 'GET') {
      return sendJSON(res, 405, { error: `Method not allowed. Use ${allowedMethod}.`, plugin: plugin.name });
    }

    const handler = makePluginHandler(plugin);
    return await handler(req, res, queryParams, body);
  }

  return false; // No plugin matched
}

// ── List all plugins ──────────────────────────
function handleListPlugins(req, res) {
  const list = plugins.map(p => ({
    name:        p.name,
    description: p.description || '',
    method:      p.method || 'GET',
    route:       `/api/plugins/${p.name}`,
    enabled:     p.enabled !== false,
    cached:      !!p.cache,
    cacheTTL:    p.cache ? `${p.cache.ttlMinutes}min` : null,
    params:      p.forwardParams || [],
    requiresKey: !!p.apiKeyEnvVar,
    keyVar:      p.apiKeyEnvVar || null,
  }));
  sendJSON(res, 200, { plugins: list, total: list.length });
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

module.exports = { handlePluginRoute, handleListPlugins, loadConfig, getPlugins: () => plugins };
