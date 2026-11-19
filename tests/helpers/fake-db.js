'use strict';
// In-memory stand-in for lib/db.js (same interface). Mimics the SQL constraints so API tests need no network.
function createFakeDb() {
  const s = { blocks: [], version: 0, audit: [], fails: [], failNext: false, served: [], servedId: 1 };
  const shape = () => ({ version: s.version, blocks: s.blocks.map(b => ({ id: b.id, name: b.name, note: b.note, committees: [...b.committees].sort((a, c) => a - c) })) });
  let nextId = 1;
  return {
    state: s,
    getBlocks: async () => { if (s.failNext) throw new Error('boom'); return shape(); },
    replaceBlocks: async (blocks, ip) => {
      const names = new Set(), comms = new Set();
      for (const b of blocks) {
        if (b.name.length < 1 || b.name.length > 40 || b.note.length > 120 || names.has(b.name)) throw new Error('constraint');
        names.add(b.name);
        for (const c of b.committees) { if (!Number.isInteger(c) || c < 1 || c > 100 || comms.has(c)) throw new Error('constraint'); comms.add(c); }
      }
      s.blocks = blocks.map(b => ({ id: nextId++, ...b, committees: [...b.committees] }));
      s.version++;
      s.audit.push({ at: new Date().toISOString(), action: 'blocks.replace', ip, detail: `${blocks.length} blocks` });
      return shape();
    },
    recordServed: async ({ suffix, n, committee, ago }) => {
      if (n !== null && s.served.some(r => r.suffix === suffix && r.n === n)) return false; // unique (suffix, n); NULL n never conflicts
      s.served.push({ id: s.servedId++, at: new Date((s.now ? s.now() : Date.now()) - Math.max(0, Math.min(ago || 0, 86400)) * 1000).toISOString(), suffix, n, committee });
      return true;
    },
    servedStats: async () => {
      const by = {};
      s.served.filter(r => r.committee !== null && r.suffix !== '*').forEach(r => { by[r.suffix] = (by[r.suffix] || 0) + 1; });
      return { entries: s.served.length, served: s.served.filter(r => r.committee !== null && r.suffix !== '*').length,
        foreign: s.served.filter(r => r.suffix === '*').length, not_found: s.served.filter(r => r.committee === null).length, by_suffix: by };
    },
    recentServed: async limit => [...s.served].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id)).slice(0, limit).map(r => ({ at: r.at, suffix: r.suffix, n: r.n, committee: r.committee })),
    clearServed: async ip => { const k = s.served.length; s.served = []; s.audit.push({ at: new Date().toISOString(), action: 'served.clear', ip, detail: k + ' entries removed' }); return k; },
    audit: async (action, ip, detail) => { s.audit.push({ at: new Date().toISOString(), action, ip, detail }); },
    recentAudit: async n => [...s.audit].reverse().slice(0, n),
    loginFailures: async (ip, sinceMs) => s.fails.filter(f => f.ip === ip && f.t >= sinceMs).map(f => f.t).sort((a, b) => a - b),
    recordLoginFailure: async ip => { s.fails.push({ ip, t: s.now ? s.now() : Date.now() }); },
    clearLoginFailures: async ip => { s.fails = s.fails.filter(f => f.ip !== ip); },
    pruneLoginAttempts: async before => { s.fails = s.fails.filter(f => f.t >= before); },
  };
}
module.exports = { createFakeDb };
