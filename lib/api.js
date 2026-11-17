'use strict';
// Framework-free request handlers. Each takes { method, headers, body, ip } and returns { status, body, headers? }.
// api/*.js are thin Vercel adapters around these; tests call them with a fake DB.
const auth = require('./auth');
const { validateBlocks } = require('./validate');
const { createDb } = require('./db');

const MAX_FAILS = 5, WINDOW_MS = 15 * 60 * 1000, PRUNE_MS = 24 * 60 * 60 * 1000;
const MAX_COMMITTEE = 100;
const json = (status, body, headers) => ({ status, body, headers });
const bad = () => json(400, { error: 'bad request' });

function isAuthed(req, deps) {
  return auth.verifyToken(deps.env.SESSION_SECRET, auth.parseCookies(req.headers.cookie)[auth.COOKIE], deps.now());
}
// CSRF: state-changing calls need JSON + a custom header (cannot be sent cross-site without CORS, which is off)
function csrfOk(req) {
  return req.headers['x-requested-with'] === 'admin' && /^application\/json\b/i.test(req.headers['content-type'] || '');
}
const cookie = (value, maxAge) => [`${auth.COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Secure', `Max-Age=${maxAge}`].join('; ');

const handlers = {
  health: { methods: ['GET'], run: async () => json(200, { ok: true }) },

  blocks: { methods: ['GET'], run: async (req, d) => json(200, await d.db.getBlocks()) },

  login: {
    methods: ['POST'],
    run: async (req, d) => {
      if (!csrfOk(req)) return bad();
      const now = d.now();
      const ip = req.ip;
      await d.db.pruneLoginAttempts(now - PRUNE_MS);
      const fails = await d.db.loginFailures(ip, now - WINDOW_MS);
      if (fails.length >= MAX_FAILS) {
        const retry = Math.max(1, Math.ceil((fails[0] + WINDOW_MS - now) / 1000));
        return json(429, { error: 'too many attempts' }, { 'Retry-After': String(retry) });
      }
      const pin = req.body && typeof req.body.pin === 'string' ? req.body.pin : '';
      if (!auth.safeEqual(pin, d.env.ADMIN_PIN)) {
        await d.db.recordLoginFailure(ip);
        await d.db.audit('login.fail', ip);
        return json(401, { error: 'wrong pin' });
      }
      await d.db.clearLoginFailures(ip);
      await d.db.audit('login.ok', ip);
      return json(200, { ok: true }, { 'Set-Cookie': cookie(auth.issueToken(d.env.SESSION_SECRET, now), auth.SESSION_MS / 1000) });
    },
  },

  logout: {
    methods: ['POST'],
    run: async req => (csrfOk(req) ? json(200, { ok: true }, { 'Set-Cookie': cookie('', 0) }) : bad()),
  },

  session: { methods: ['GET'], run: async (req, d) => json(200, { authed: isAuthed(req, d) }) },

  adminBlocks: {
    methods: ['PUT'],
    run: async (req, d) => {
      if (!isAuthed(req, d)) return json(401, { error: 'unauthorized' });
      if (!csrfOk(req)) return bad();
      const v = validateBlocks(req.body, MAX_COMMITTEE);
      if (!v.ok) return json(400, { error: v.error });
      return json(200, await d.db.replaceBlocks(v.value, req.ip));
    },
  },

  audit: {
    methods: ['GET'],
    run: async (req, d) => (isAuthed(req, d) ? json(200, { entries: await d.db.recentAudit(50) }) : json(401, { error: 'unauthorized' })),
  },
};

// Fail closed: any missing/weak setting -> null (callers answer a generic 500).
function readEnv(env) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PIN, SESSION_SECRET } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  if (!ADMIN_PIN || ADMIN_PIN.length < 6) return null;
  if (!SESSION_SECRET || SESSION_SECRET.length < 16) return null;
  return { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PIN, SESSION_SECRET };
}
function defaultDeps(env = process.env) {
  const cfg = readEnv(env);
  if (!cfg) return null;
  return { env: cfg, db: createDb({ url: cfg.SUPABASE_URL, key: cfg.SUPABASE_SERVICE_ROLE_KEY }), now: Date.now };
}

// First hop of x-forwarded-for (Vercel sets it; clients cannot spoof the first hop there)
function clientIp(headers) {
  const first = String(headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 64);
  return /^[0-9a-fA-F:.]+$/.test(first) ? first : 'unknown';
}

async function run(name, req, deps) {
  const h = handlers[name];
  if (!deps) return json(500, { error: 'server error' });
  if (!h.methods.includes(req.method)) return json(405, { error: 'method not allowed' }, { Allow: h.methods.join(', ') });
  try { return await h.run(req, deps); } catch (e) {
    console.error('api error', name, e && e.name); // never log messages/bodies (may contain data)
    return json(500, { error: 'server error' });
  }
}

// Vercel Node adapter. makeDeps is injectable for tests.
function nodeHandler(name, makeDeps = defaultDeps) {
  return async (req, res) => {
    let out;
    try {
      const headers = req.headers || {};
      let body;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (Number(headers['content-length'] || 0) > 64 * 1024) { out = bad(); }
        else { try { body = req.body; if (typeof body === 'string') body = JSON.parse(body); } catch { out = bad(); } }
      }
      if (!out) out = await run(name, { method: req.method, headers, body, ip: clientIp(headers) }, makeDeps());
    } catch (e) { out = json(500, { error: 'server error' }); }
    res.statusCode = out.status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
    res.end(JSON.stringify(out.body));
  };
}

module.exports = { handlers, run, nodeHandler, defaultDeps, readEnv, clientIp, MAX_FAILS, WINDOW_MS };
