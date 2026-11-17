# Security & quality assurance

## 1. Data & privacy
- **No personal data stored.** Only block names/notes/committee numbers and an audit log (event type, IP, short detail).
- Scanned IDs are processed **in the browser only**; the server never receives them. Do not add server-side logging of scans.
- All assets self-hosted (no CDN, no analytics, no external fonts, OCR engine + language data included) → no third-party data leaks; app works offline.
- **Camera frames and OCR text stay on the device**: the scanner has no fetch/upload/storage/logging; `connect-src 'self'` and the API have no scan endpoint.

## 2. Threat model
| # | Threat | Control (where) | Verified by |
|---|---|---|---|
| T1 | Stranger edits blocks | PIN login, signed HttpOnly session, `requireAdmin` (`lib/api.js`, `lib/auth.js`) | api.test: anonymous → 401 |
| T2 | PIN brute force | 5 failures / 15 min / IP (Postgres, survives cold starts) → 429 + audit; PIN ≥ 6 chars, functions fail closed otherwise | api.test: rate limit |
| T3 | CSRF on admin writes | `SameSite=Strict` cookie + required `X-Requested-With: admin` + JSON content-type; no CORS | api.test: CSRF guard |
| T4 | XSS (stored via block names/notes, or scanned text) | DOM built with `textContent`; strict CSP `script-src 'self'`; input length limits | manual: `<img onerror>` as block name renders as text |
| T5 | Session theft | Secure+HttpOnly+SameSite=Strict cookie (prod), 8 h expiry, HMAC signature, `SESSION_SECRET` from env | api.test: cookie flags |
| T6 | Clickjacking | CSP `frame-ancestors 'none'` | header test |
| T7 | Bad/hostile payloads | Strict validation (`lib/validate.js`), 64 KB body limit, transaction rollback on error | api.test: validation matrix |
| T8 | Info leak via errors | Generic 500 handler; `x-powered-by` off; no stack traces to client | review |
| T9 | Secrets in repo | `.env`, `data/app.db` git-ignored; boot refuses to start without `ADMIN_PIN` | review |
| T10 | Supply chain | 2 runtime deps (express, better-sqlite3); OCR engine **vendored and pinned** in `public/ocr/t7.0.0/` (tesseract.js 7.0.0, tesseract.js-core 7.0.0, eng data 1.0.0; Apache-2.0 licences included; no runtime fetch from npm/CDN); dev-only deps for `ocr:eval` (tesseract.js, jpeg-js, pngjs); lockfile committed; `npm audit` before release | `npm audit` |
| T13 | OCR needs CSP relaxations | Two additions only: `script-src 'self' 'wasm-unsafe-eval'` (WebAssembly compile; **no** `unsafe-eval`) and `worker-src 'self' blob:` (blob only as a Tesseract fallback; the app sets `workerBlobURL:false`, so workers load from `/ocr/t7.0.0/`). `connect-src 'self'`, no external hosts, no `unsafe-inline` for styles | header test in api.test |
| T14 | Wrong digit read → wrong committee | Consensus (3 frames), implausible reads rejected, number shown big + one-tap edit, type chips | ocr-parse.test; manual QA |
| T11 | DoS at the venue | Static serving + tiny JSON; SQLite WAL; ushers keep working from cache if server is slow | load test (plan) |
| T12 | Wrong committee shown | Pure-logic unit tests over **every** range boundary; extraction sanity checks | lookup.test |

| T15 | Database exposure | RLS on, no policies, grants revoked for anon/authenticated; service-role key only in Vercel env, never in `public/` | anon-key lockout check; api.test scans `public/` |

Residual risks accepted: shared PIN (anyone who knows it is an admin — rotate it after the event); blocks endpoint is public; the repo is public (no secrets in it).

## 3. Automated tests (`npm test`, 21 tests)
Lookup: every range start/end/midpoint, known values from the PDF, out-of-range → null, all 100 committees reachable, scan parsing (Arabic digits, suffixes). OCR: digit normalisation, confusion fixes, suffix extraction, implausible reads, consensus (N frames, reset, high confidence, 3 s cooldown), preprocessing. API: anonymous rejected, login/cookie flags, rate limit, CSRF guard, save + public read + audit, validation matrix, security headers.

## 4. Manual QA checklist (run on a real phone, HTTPS URL)
**Before the event**
- [ ] Scan 5 real cards of different types (working, ع, د, Port Said, foreign); confirm the **recognised number** equals the printed one; run `npm run ocr:eval` on >= 20 labelled photos (target >= 95%).
- [ ] OCR conditions: bright indoor, dim room (torch on/off), window daylight, glare on laminate, 15–20° tilt, worn/scratched card, hand shake. Note read time (target <= 2 s).
- [ ] Wrong read: tap **عدّل الرقم**, number is pre-filled, fix and look up. Change the type chip on the result: committee updates instantly.
- [ ] Camera permission denied: message + manual entry works. Slow phone: slow notice, manual works. Torch button only where supported.
- [ ] Offline first load of the scanner (airplane mode after one online visit): OCR still loads from cache; check cache size (~14 MB) on low-storage phones.
- [ ] iOS Safari and Android Chrome: camera, torch, tab switching (camera released and restarted).
- [ ] For each type, check 1 first-of-range and 1 last-of-range number against the PDF by hand.
- [ ] Number not in list shows red "not found". Committee 100 flow works (foreign chip).
- [ ] Admin: wrong PIN rejected; right PIN works; assign/move/clear committees; range input `1-12, 20`; save; usher phone shows block within ~30 s.
- [ ] Unassigned committee shows "لم يُحدَّد المكان بعد" on the result.
- [ ] Airplane mode after first load: app opens, lookups work, pill says offline. Reconnect: pill returns to "محدّث".
- [ ] Camera denied: error text visible, manual entry works.
- [ ] 390×844 and 360×740 screens: no horizontal scroll; keyboard does not hide the button; text readable in sunlight (max brightness).
- [ ] Browser console: no errors / CSP violations on `/` and `/admin`.
- [ ] 20-device dry run on venue Wi-Fi with simultaneous scans.
- [ ] `npm audit` clean; `ADMIN_PIN` and `SESSION_SECRET` are strong and not the defaults; HTTPS enforced.
**Event day**: back up `app.db`; keep admin phone logged in; one usher with the manual-entry fallback card printed from the PDF.
**After**: change/revoke the PIN; export audit log; archive DB.

## 5. Quality gates
CI (add when a repo exists): `npm ci && npm test && npm audit --omit=dev`. Accuracy gate (manual, needs real photos): `npm run ocr:eval`. No merge with failing tests. Changes to `api/`, `lib/` or `public/js/` go through the `qa-reviewer` and `security-reviewer` agents.
