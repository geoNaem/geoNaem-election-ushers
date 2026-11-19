# AGENTS.md — Election Ushers

Instructions for AI coding agents (Claude Code, Codex, etc.). Humans: see `README.md`.

## What this is
A small, high-reliability web app used by 20+ ushers at one event (Friday 20/11/2026). Member ID → committee number (from a PDF) → block location (set by admins). Arabic, RTL, mobile-first. **Simplicity and reliability beat features.**

## Commands
- `npm install` · `npm test` · `npm run extract` · `npm run ocr:eval` · `npm run dev` (= `vercel dev`; needs the env vars in `.env.example`)
- Tests must pass before any change is considered done: `npm test` (lookup, API, security headers, rate limit, CSRF).

## Map of the repo
- `data/source/*.pdf` — official list (read-only source of truth). `data/committees.json` — generated; never hand-edit.
- `scripts/extract_committees.py` — PDF → JSON, with sanity checks.
- `api/` — thin Vercel Function adapters. `lib/` — `api.js` handlers, `auth.js` PIN+session, `db.js` Supabase adapter, `validate.js` input validation. `supabase/migrations/` — SQL (apply in order). `vercel.json` — headers/CSP/caching.
- `public/` — static front end, **no build step, no framework**. `js/lookup.js` (pure logic, UMD, unit-tested), `js/app.js` (usher UI), `js/admin.js` (admin UI), `sw.js` (offline), `css/` (tokens in `base.css`).
- `docs/` — design system, system design, security & QA, plan. Keep them in sync with code.

## Hard rules
1. **No inline `<script>` or inline event handlers.** CSP is `script-src 'self'`. Do not loosen it.
2. **Never build HTML from strings with user/scanned data.** Use `textContent` / DOM APIs (see `el()` in admin.js).
3. **All admin writes** (`PUT /api/admin/blocks`, `DELETE /api/admin/served`) need the auth cookie + `X-Requested-With: admin` + JSON. The only public write is `POST /api/serve` (header `X-Requested-With: usher`; the server computes the committee itself via `lookup.js`). Keep validation in `lib/validate.js`; add a test for every new rule.
4. **No usher login, no names.** Stored server-side: side config (left/right committees), an audit log, and — by the owner's explicit request — the *membership numbers that were looked up* with type, resulting committee and time (the "people served" table, clearable from /admin). Camera frames, photos and OCR text never leave the device; the usher app sends only `{type, number}` after a lookup. No names, no IPs in that table. Never add analytics/third-party scripts or CDNs (fonts and OCR engine are self-hosted so it works offline).
5. **Lookup logic lives only in `public/js/lookup.js`.** Do not re-implement it elsewhere; extend its tests (`tests/lookup.test.js`) first.
6. Arabic UI copy, RTL layout, tap targets ≥ 44px, text contrast ≥ 4.5:1, never colour alone (see `docs/design-system.md`).
7. Do not add dependencies without a reason written in the PR/commit. Prefer the standard library.
8. Secrets only via env vars. Never commit `.env` or `data/app.db`.

## Workflow
- Small commits; run `npm test` first. For UI changes, run the app and test at 390px width in a real browser (camera + manual entry + result states: found, not found, no block assigned, offline).
- When changing the PDF logic, run `npm run extract` and confirm the script's sanity checks pass; never loosen those checks to make data pass.
- Update `docs/` when behavior, API, or security controls change.

## Definition of done
Tests green · works at 390×844 · RTL correct · no console errors (CSP violations count) · docs updated · no secrets committed.

## Sub-agents available (`.claude/agents/`)
`qa-reviewer` (test/regression review) and `security-reviewer` (threat-model review of a diff). Use them before merging anything that touches `api/`, `lib/` or `public/js/`.
