/**
 * lib/apiRegistry.js — Hot-reloading plugin API proxy system
 * Reads apis_config.json, creates routes at /api/plugins/<name>
 */
const fs     = require('fs');
const path   = require('path');
const https  = require('https');
const http   = require('http');
const logger = require('./logger');

const CONFIG_FILE  = path.join(process.cwd(), 'apis_config.json');
const CACHE        = new Map(); // key → { data, expiresAt }

let _config = null;
let _configMtime = 0;

function loadConfig() {
  try {
    const stat = fs.statSync(CONFIG_FILE);
    if (stat.mtimeMs !== _configMtime) {
      _config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      _configMtime = stat.mtimeMs;
      logger.info('apis_config.json reloaded', { apis: _config.apis?.length });
    }
  } catch (e) {
    logger.error('Failed to load apis_config.json', { message: e.message });
    if (!_config) _config = { apis: [] };
  }
  return _config;
}

function resolveEnvVars(str) {
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => process.env[key] || '');
}

function buildHeaders(api) {
  const headers = { ...(api.headers || {}) };
  if (api.apiKeyEnvVar && api.apiKeyHeader) {
    const keyVal = process.env[api.apiKeyEnvVar] || '';
    if (api.apiKeyFormat) {
      headers[api.apiKeyHeader] = resolveEnvVars(api.apiKeyFormat.replace(`{{${api.apiKeyEnvVar}}}`, keyVal));
    } else {
      headers[api.apiKeyHeader] = keyVal;
    }
  }
  return headers;
}

function buildBody(template, incoming) {
  if (!template) return null;
  const out = {};
  for (const [k, v] of Object.entries(template)) {
    if (typeof v === 'string' && v.startsWith('{{') && v.endsWith('}}')) {
      const key = v.slice(2, -2);
      out[k] = incoming[key] !== undefined ? incoming[k] : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function fetchRaw(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib     = isHttps ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   options.method || 'GET',
      headers:  options.headers || {},
      timeout:  (options.timeoutSeconds || 15) * 1000,
    };
    const req = lib.request(reqOpts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, raw: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function handleListPlugins(req, res) {
  const cfg = loadConfig();
  const list = (cfg.apis || []).map(a => ({
    name: a.name,
    description: a.description || '',
    enabled: a.enabled,
    method: a.method,
    route: `/api/plugins/${a.name}`,
  }));
  sendJSON(res, 200, { plugins: list });
}

async function handlePluginRoute(req, res, pathname, body) {
  const cfg  = loadConfig();
  const name = pathname.replace('/api/plugins/', '').split('/')[0];
  const api  = (cfg.apis || []).find(a => a.name === name);

  if (!api) return false;
  if (!api.enabled) { sendJSON(res, 403, { error: `Plugin '${name}' is disabled` }); return true; }

  // Cache check
  const cacheKey = `${name}:${JSON.stringify(body || {})}`;
  if (api.cache?.ttlMinutes) {
    const cached = CACHE.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) { sendJSON(res, 200, cached.data); return true; }
  }

  try {
    const headers  = buildHeaders(api);
    let targetUrl  = resolveEnvVars(api.url);

    // Append query params for GET
    if (api.method === 'GET') {
      const queryParams = new URL(req.url, 'http://localhost').searchParams;
      const urlObj = new URL(targetUrl);
      if (api.forwardParams) {
        for (const p of api.forwardParams) {
          if (queryParams.has(p)) urlObj.searchParams.set(p, queryParams.get(p));
        }
      }
      if (api.staticParams) {
        for (const [k, v] of Object.entries(api.staticParams)) {
          urlObj.searchParams.set(k, resolveEnvVars(String(v)));
        }
      }
      targetUrl = urlObj.toString();
    }

    const requestBody = api.method === 'POST' ? buildBody(api.bodyTemplate, body || {}) : null;

    const result = await fetchRaw(targetUrl, {
      method:         api.method,
      headers,
      body:           requestBody,
      timeoutSeconds: api.timeoutSeconds || 15,
    });

    let parsed;
    try { parsed = JSON.parse(result.raw); } catch { parsed = { raw: result.raw }; }

    if (result.status >= 400) {
      sendJSON(res, result.status, { error: 'Plugin API error', detail: parsed }); return true;
    }

    const response = api.responseField
      ? api.responseField.split('.').reduce((o, k) => o?.[k], parsed)
      : parsed;

    const finalData = { success: true, plugin: name, data: response };

    if (api.cache?.ttlMinutes) {
      CACHE.set(cacheKey, { data: finalData, expiresAt: Date.now() + api.cache.ttlMinutes * 60000 });
    }

    sendJSON(res, 200, finalData);
  } catch (err) {
    logger.error(`Plugin ${name} error`, { message: err.message });
    sendJSON(res, 500, { error: 'Plugin request failed', detail: err.message });
  }
  return true;
}

module.exports = { handleListPlugins, handlePluginRoute, loadConfig };
