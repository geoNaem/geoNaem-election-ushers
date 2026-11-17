# Implementation plan

Status: **v1 scaffold is working** (tests green, end-to-end verified in headless Chrome: admin saves blocks → usher sees committee + block).

## Done
- Number scanner: on-device OCR (tesseract.js, self-hosted, offline), consensus, edit + type chips, torch, lazy load; html5-qrcode removed; 21 tests.
- PDF → `committees.json` extraction with sanity checks (101 ranges + foreign rule; committees 1–100 all covered).
- Usher UI (design B): scan + manual on one screen, result ring, block card, not-found, offline pill, service worker.
- Admin UI: PIN login, blocks CRUD, 1–100 committee grid, range input, unassigned indicator, save with dirty guard.
- Backend: Express 5, SQLite, PIN session, rate limit, CSRF guard, CSP + security headers, audit log, validation.
- Tests (12), Dockerfile, env template, agent docs (`AGENTS.md`, `CLAUDE.md`, sub-agents).

## Next (ordered)
1. **Real-card OCR test** — photograph 20+ real cards (all types) into `tests/fixtures/cards/` (named by number, e.g. `2367.jpg`, `822_ع.png`), run `npm run ocr:eval` (target >= 95%), record digit script/position/suffix in `system-design.md` §6a, tune `HIGH_CONFIDENCE`/`CONSENSUS_FRAMES` in `ocr-parse.js`. *(blocks event day)*
1b. **Deployment to Vercel + Supabase** (designed, NOT done): needs gh logged in as the account that owns the Vercel GitHub integration (geoNaem) and approval of the Supabase project ($10/month). Then: repo, `api/` functions, `supabase/migrations/`, env vars, deploy, live verification.
2. **Deploy** to a host with persistent disk + HTTPS; set strong `ADMIN_PIN` and `SESSION_SECRET`; verify camera on iOS Safari and Android Chrome.
3. **Block setup** — get the venue layout from organisers; create blocks and assign committees; sanity-check with 3 members per block.
4. **Dry run** with ~20 phones on venue Wi-Fi (simultaneous scans, then airplane-mode test).
5. Polish backlog (only if time): print-friendly block map view; "recently looked up" list (client-side only); Arabic-Indic numeral toggle; admin audit viewer UI; CSV export of block config.
6. Event day runbook (`docs/security-qa.md` §4); after event: rotate PIN, archive DB.

## Out of scope / defer
Attendance counts, member names, multiple events, real accounts, server-side lookup.
