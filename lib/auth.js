'use strict';
const crypto = require('node:crypto');

const COOKIE = 'adm';
const SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours

const b64 = buf => Buffer.from(buf).toString('base64url');
const sha = s => crypto.createHash('sha256').update(String(s)).digest();

function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha(a), sha(b)); // equal length digests -> constant time
}
function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}
function issueToken(secret, now = Date.now()) {
  const payload = b64(JSON.stringify({ exp: now + SESSION_MS, n: crypto.randomBytes(8).toString('hex') }));
  return `${payload}.${sign(secret, payload)}`;
}
function verifyToken(secret, token, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return false;
  const good = sign(secret, payload);
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > now; } catch { return false; }
}
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

module.exports = { COOKIE, SESSION_MS, safeEqual, issueToken, verifyToken, parseCookies };
