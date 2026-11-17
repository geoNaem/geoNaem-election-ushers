'use strict';
// Supabase (PostgREST) adapter using the service-role key. SERVER-SIDE ONLY: never import from public/.
// Interface (also implemented by tests/helpers/fake-db.js): getBlocks, replaceBlocks, audit, recentAudit,
// loginFailures, recordLoginFailure, clearLoginFailures, pruneLoginAttempts.
function createDb({ url, key, fetchImpl = fetch }) {
  const base = String(url).replace(/\/+$/, '') + '/rest/v1';
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  async function call(method, path, body, extra) {
    const res = await fetchImpl(base + path, { method, headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new Error(`db ${method} ${path.split('?')[0]} -> ${res.status}`); // status only: never echo bodies/keys
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  const q = encodeURIComponent;
  return {
    getBlocks: () => call('POST', '/rpc/get_blocks', {}),
    replaceBlocks: (blocks, ip) => call('POST', '/rpc/replace_blocks', { p_blocks: blocks, p_ip: ip || null }),
    audit: (action, ip, detail) => call('POST', '/audit_log', { action, ip: ip || null, detail: detail || null }, { Prefer: 'return=minimal' }),
    recentAudit: n => call('GET', `/audit_log?select=at,action,ip,detail&order=id.desc&limit=${Number(n) | 0}`),
    // timestamps (ms since epoch) of this IP's failed logins since `sinceMs`, oldest first
    loginFailures: async (ip, sinceMs) => {
      const rows = await call('GET', `/login_attempts?select=at&ip=eq.${q(ip)}&at=gte.${q(new Date(sinceMs).toISOString())}&order=at.asc`);
      return rows.map(r => Date.parse(r.at));
    },
    recordLoginFailure: ip => call('POST', '/login_attempts', { ip }, { Prefer: 'return=minimal' }),
    clearLoginFailures: ip => call('DELETE', `/login_attempts?ip=eq.${q(ip)}`, undefined, { Prefer: 'return=minimal' }),
    pruneLoginAttempts: beforeMs => call('DELETE', `/login_attempts?at=lt.${q(new Date(beforeMs).toISOString())}`, undefined, { Prefer: 'return=minimal' }),
  };
}
module.exports = { createDb };
