const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../lib/api');
const { createFakeDb } = require('./helpers/fake-db');

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(30), ADMIN_PIN: 'test-pin-123', SESSION_SECRET: 'x'.repeat(32) };
const ROUTES = { 'GET /api/health': 'health', 'GET /api/blocks': 'blocks', 'POST /api/admin/login': 'login', 'POST /api/admin/logout': 'logout',
  'GET /api/admin/session': 'session', 'PUT /api/admin/blocks': 'adminBlocks', 'GET /api/admin/audit': 'audit' };

function setup(ip = '1.2.3.4') {
  const db = createFakeDb();
  const clock = { t: Date.now() };
  db.state.now = () => clock.t;
  const deps = { env: ENV, db, now: () => clock.t };
  const call = async (method, url, { body, cookie, xhr = true } = {}) => {
    const headers = {};
    if (xhr) headers['x-requested-with'] = 'admin';
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const name = ROUTES[`${method} ${url}`];
    return api.run(name, { method, headers, body, ip }, deps);
  };
  const login = async pin => {
    const r = await call('POST', '/api/admin/login', { body: { pin } });
    return { r, cookie: ((r.headers && r.headers['Set-Cookie']) || '').split(';')[0] };
  };
  return { db, clock, call, login };
}

test('public blocks start empty; admin endpoints reject anonymous callers', async () => {
  const t = setup();
  const b = await t.call('GET', '/api/blocks');
  assert.equal(b.status, 200); assert.deepEqual(b.body, { version: 0, blocks: [] });
  assert.equal((await t.call('PUT', '/api/admin/blocks', { body: { blocks: [] } })).status, 401);
  assert.equal((await t.call('GET', '/api/admin/audit')).status, 401);
  assert.equal((await t.call('GET', '/api/admin/session')).body.authed, false);
});

test('login: wrong pin 401, right pin sets a hardened cookie', async () => {
  const t = setup();
  assert.equal((await t.login('nope')).r.status, 401);
  const { r, cookie } = await t.login('test-pin-123');
  assert.equal(r.status, 200);
  const sc = r.headers['Set-Cookie'];
  for (const f of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Max-Age=28800', 'Path=/']) assert.ok(sc.includes(f), f);
  assert.equal((await t.call('GET', '/api/admin/session', { cookie })).body.authed, true);
  assert.equal((await t.call('GET', '/api/admin/session', { cookie: cookie + 'x' })).body.authed, false);
});

test('login is rate limited after 5 failures (429 + Retry-After), per IP, and recovers', async () => {
  const t = setup();
  for (let i = 0; i < 5; i++) assert.equal((await t.login('bad' + i)).r.status, 401);
  const blocked = await t.login('test-pin-123');
  assert.equal(blocked.r.status, 429);
  assert.ok(Number(blocked.r.headers['Retry-After']) > 0);
  const other = setup('9.9.9.9'); // different IP = separate counter (own fake db here)
  assert.equal((await other.login('test-pin-123')).r.status, 200);
  t.clock.t += 15 * 60 * 1000 + 1000;
  assert.equal((await t.login('test-pin-123')).r.status, 200);
});

test('CSRF guard: state-changing admin calls need the custom header and JSON', async () => {
  const t = setup();
  const { cookie } = await t.login('test-pin-123');
  assert.equal((await t.call('PUT', '/api/admin/blocks', { body: { blocks: [] }, cookie, xhr: false })).status, 400);
  assert.equal((await t.call('POST', '/api/admin/login', { body: { pin: 'test-pin-123' }, xhr: false })).status, 400);
  assert.equal((await t.call('POST', '/api/admin/logout', { xhr: false })).status, 400);
  const r = await api.run('adminBlocks', { method: 'PUT', headers: { cookie, 'x-requested-with': 'admin', 'content-type': 'text/plain' }, body: { blocks: [] }, ip: 'i' }, { env: ENV, db: t.db, now: Date.now });
  assert.equal(r.status, 400); // wrong content-type is rejected before touching the db
  assert.equal(t.db.state.version, 0);
});

test('save + public read + version bump + audit', async () => {
  const t = setup();
  const { cookie } = await t.login('test-pin-123');
  const body = { blocks: [{ name: 'A', note: 'بجوار المسبح', committees: [3, 1, 2] }, { name: 'B', note: '', committees: [20] }] };
  const put = await t.call('PUT', '/api/admin/blocks', { body, cookie });
  assert.equal(put.status, 200); assert.equal(put.body.version, 1);
  const pub = await t.call('GET', '/api/blocks');
  assert.deepEqual(pub.body.blocks.map(b => [b.name, b.note, b.committees]), [['A', 'بجوار المسبح', [1, 2, 3]], ['B', '', [20]]]);
  assert.equal((await t.call('PUT', '/api/admin/blocks', { body, cookie })).body.version, 2);
  const audit = await t.call('GET', '/api/admin/audit', { cookie });
  assert.ok(audit.body.entries.some(e => e.action === 'blocks.replace'));
  assert.ok(audit.body.entries.some(e => e.action === 'login.ok'));
});

test('validation matrix', async () => {
  const t = setup();
  const { cookie } = await t.login('test-pin-123');
  const put = blocks => t.call('PUT', '/api/admin/blocks', { body: { blocks }, cookie });
  const cases = {
    'duplicate committee': [{ name: 'A', note: '', committees: [5] }, { name: 'B', note: '', committees: [5] }],
    'committee 0': [{ name: 'A', note: '', committees: [0] }],
    'committee 101': [{ name: 'A', note: '', committees: [101] }],
    'non-integer': [{ name: 'A', note: '', committees: [1.5] }],
    'string committee': [{ name: 'A', note: '', committees: ['3'] }],
    'duplicate name': [{ name: 'A', note: '', committees: [1] }, { name: 'A', note: '', committees: [2] }],
    'empty name': [{ name: '  ', note: '', committees: [1] }],
    'name too long': [{ name: 'x'.repeat(41), note: '', committees: [] }],
    'note too long': [{ name: 'A', note: 'x'.repeat(121), committees: [] }],
    'too many blocks': Array.from({ length: 31 }, (_, i) => ({ name: 'b' + i, note: '', committees: [] })),
  };
  for (const [label, blocks] of Object.entries(cases)) assert.equal((await put(blocks)).status, 400, label);
  assert.equal((await t.call('PUT', '/api/admin/blocks', { body: { blocks: 'nope' }, cookie })).status, 400, 'non-array');
  assert.equal((await t.call('PUT', '/api/admin/blocks', { body: null, cookie })).status, 400, 'no body');
  assert.equal((await t.call('GET', '/api/blocks')).body.version, 0); // nothing was saved
});

test('wrong method -> 405; db failure -> generic 500 without details', async () => {
  const t = setup();
  const r = await api.run('blocks', { method: 'POST', headers: {}, ip: 'i' }, { env: ENV, db: t.db, now: Date.now });
  assert.equal(r.status, 405);
  t.db.state.failNext = true;
  const e = await t.call('GET', '/api/blocks');
  assert.equal(e.status, 500); assert.deepEqual(e.body, { error: 'server error' });
});

test('fail closed: missing or weak settings -> generic 500 from every adapter', async () => {
  for (const bad of [{}, { ...ENV, SUPABASE_URL: '' }, { ...ENV, SUPABASE_SERVICE_ROLE_KEY: undefined }, { ...ENV, ADMIN_PIN: '12345' }, { ...ENV, SESSION_SECRET: 'short' }]) {
    assert.equal(api.readEnv(bad), null);
    const h = api.nodeHandler('health', () => api.defaultDeps(bad));
    const out = {}; const res = { statusCode: 0, setHeader(k, v) { out[k] = v; }, end(b) { out.body = b; } };
    await h({ method: 'GET', headers: {} }, res);
    assert.equal(res.statusCode, 500); assert.equal(out.body, '{"error":"server error"}'); assert.equal(out['Cache-Control'], 'no-store');
  }
  assert.ok(api.readEnv(ENV));
});

test('client IP = first x-forwarded-for hop', () => {
  assert.equal(api.clientIp({ 'x-forwarded-for': '5.6.7.8, 10.0.0.1' }), '5.6.7.8');
  assert.equal(api.clientIp({}), 'unknown');
  assert.equal(api.clientIp({ 'x-forwarded-for': "'; drop table" }), 'unknown');
});

test('vercel.json: security headers incl. OCR CSP directives, caching rules, no external hosts', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const all = Object.fromEntries(cfg.headers.find(h => h.source === '/(.*)').headers.map(h => [h.key, h.value]));
  const csp = all['Content-Security-Policy'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'(;|$)/);
  assert.match(csp, /worker-src 'self' blob:/);
  assert.match(csp, /connect-src 'self'(;|$)/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /(^|\s)'unsafe-eval'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.doesNotMatch(csp, /https?:\/\//);
  assert.equal(all['X-Content-Type-Options'], 'nosniff');
  assert.equal(all['Referrer-Policy'], 'no-referrer');
  assert.match(all['Permissions-Policy'], /camera=\(self\)/);
  assert.match(all['Strict-Transport-Security'], /max-age=\d+/);
  const rule = src => cfg.headers.find(h => h.source === src).headers[0].value;
  assert.equal(rule('/api/(.*)'), 'no-store');
  assert.equal(rule('/sw.js'), 'no-cache');
  assert.equal(rule('/data/committees.json'), 'no-cache');
  assert.match(rule('/ocr/t7.0.0/(.*)'), /immutable/);
  assert.deepEqual(cfg.rewrites, [{ source: '/admin', destination: '/admin.html' }]);
});

test('no service-role key or db adapter is referenced from public/', () => {
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(__dirname, '..', 'public')).filter(f => /\.(js|html|css)$/.test(f) && !f.includes('/ocr/'))) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /SERVICE_ROLE|service_role|supabase/i, f);
  }
});
