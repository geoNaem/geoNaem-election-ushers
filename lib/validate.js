'use strict';
// Strict validation of the admin "blocks" payload. Returns { ok, error?, value? }.
function validateBlocks(body, maxCommittee) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.blocks)) return fail('blocks must be an array');
  if (body.blocks.length > 30) return fail('too many blocks (max 30)');
  const seenNames = new Set();
  const seenCommittees = new Set();
  const out = [];
  for (const [i, b] of body.blocks.entries()) {
    if (!b || typeof b !== 'object') return fail(`block ${i + 1} is invalid`);
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const note = typeof b.note === 'string' ? b.note.trim() : '';
    if (name.length < 1 || name.length > 40) return fail(`block ${i + 1}: name must be 1-40 characters`);
    if (note.length > 120) return fail(`block ${i + 1}: note must be at most 120 characters`);
    if (seenNames.has(name)) return fail(`duplicate block name: ${name}`);
    seenNames.add(name);
    if (!Array.isArray(b.committees) || b.committees.length > maxCommittee) return fail(`block ${i + 1}: committees must be an array`);
    const committees = [];
    for (const c of b.committees) {
      if (!Number.isInteger(c) || c < 1 || c > maxCommittee) return fail(`committee out of range: ${c}`);
      if (seenCommittees.has(c)) return fail(`committee ${c} is assigned to more than one block`);
      seenCommittees.add(c);
      committees.push(c);
    }
    committees.sort((a, b2) => a - b2);
    out.push({ name, note, committees });
  }
  return { ok: true, value: out };
}
const fail = error => ({ ok: false, error });
module.exports = { validateBlocks };
