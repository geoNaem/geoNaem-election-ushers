# System design

## 1. Goals / non-goals
**Goals:** correct committee for every member type; block location shown; ≥20 simultaneous ushers; no usher login; keeps working if the venue Wi-Fi drops; tiny ops surface.
**Non-goals:** member names, attendance tracking, vote recording, multi-event support, user accounts.

## 2. Architecture
```
 Usher phone (PWA-ish)                         Vercel (static + Functions)
 ┌───────────────────────────┐   HTTPS   ┌─────────────────────────────────┐
 │ index.html + app.js       │──────────▶│ GET /api/blocks   (public)      │
 │ lookup.js  (pure logic)   │           │ static: /, /admin, /data/*.json │
 │ committees.json (cached)  │           │ PUT /api/admin/blocks (PIN)     │
 │ blocks (localStorage)     │           │ SQLite (WAL): blocks, audit     │
 │ sw.js (offline shell)     │           └─────────────────────────────────┘
 └───────────────────────────┘
```
**Key decision:** the committee lookup runs **in the browser** from `committees.json` (works offline). After a lookup the usher app reports `{type, number}` to `POST /api/serve` for the "people served" count (section 4/5); images and OCR text never leave the device. Load is therefore trivial (static files + one tiny JSON poll every 30 s per usher) and a network outage cannot stop lookups.

## 3. Logic (the PDF)
- Source: `data/source/*.pdf` → `scripts/extract_committees.py` → `data/committees.json`: `rows: [suffix, from, to, committee]`.
- Suffix = card letter: none (working), `ع`, `د`, `ب`, `بع`, `دب`; `*` = foreign/political/refugee → committee 100 for every number.
- Lookup = binary search over sorted ranges per suffix (`public/js/lookup.js`). Result is a committee or `null` ("not found").
- Scan parsing accepts `12345`, `822 ع`, `ع822`, Arabic-Indic digits. The type chips handle manual entry so ushers never type Arabic letters.
- Extraction guards: ranges per suffix contiguous (no gaps/overlaps), working = exactly 1..84, committees 1..100 all present.

## 4. Database (Supabase Postgres; migrations in `supabase/migrations/`)
```
blocks(id identity PK, name text 1-40 UNIQUE, note text ≤120, position int)
block_committees(committee int PK 1..100  -- a committee belongs to at most one block
                 , block_id FK → blocks ON DELETE CASCADE)
config(key PK, value)                    -- blocks_version counter (bumped on every save)
audit_log(id, at, action, ip, detail)    -- login.ok / login.fail / blocks.replace
login_attempts(id, ip, at)               -- persistent login rate limit; pruned after 1 day
served(id, at, suffix, n, committee)     -- people served: one row per (type, number), first lookup time; committee NULL = not on the list;
                                          -- foreign '*' has no number (n NULL) so each lookup is a row. UNIQUE(suffix, n).
record_served() / served_stats() / clear_served()  -- idempotent insert (p_ago back-dates offline lookups), counters, wipe + audit row
get_blocks() / replace_blocks(jsonb, ip) -- one transaction: delete all, re-insert, bump version, audit
```
Access: RLS enabled on every table with **no policies**; all grants revoked from `public/anon/authenticated`; functions executable only by `service_role`. The browser never talks to Supabase; only the Vercel Functions do, with the service-role key (env var, server-side only). Verified: the anon/publishable key gets 401 on every table and function.

## 5. API
| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | none | liveness |
| `GET /api/blocks` | none | `{version, blocks:[{id,name,note,committees:[…]}]}` — public by design (only location info) |
| `POST /api/admin/login` | CSRF hdr | `{pin}` → sets `adm` cookie (HttpOnly, SameSite=Strict, Secure, 8 h). 5 failures / 15 min / IP (stored in Postgres) → 429 + Retry-After |
| `POST /api/admin/logout` | CSRF hdr | clears cookie |
| `GET /api/admin/session` | cookie | `{authed}` |
| `POST /api/serve` | `X-Requested-With: usher` + JSON | `{suf, n, ago?}` → records the lookup; the committee is computed server-side from the official list; idempotent per (type, number) |
| `GET /api/admin/served?limit=200` | cookie | `{totalIds, served, foreign, notFound, percent, bySuffix[], entries[] newest first, entriesTotal}` |
| `DELETE /api/admin/served` | cookie + CSRF hdr | removes every entry (audited as `served.clear`) |
| `PUT /api/admin/blocks` | cookie + CSRF hdr | `{blocks:[{name,note,committees:[int]}]}` full replace. 400 on: >30 blocks, bad name/note, committee ∉ 1..100, committee in two blocks, duplicate names |
| `GET /api/admin/audit` | cookie | last 50 audit entries |
CSRF header = `X-Requested-With: admin` + `Content-Type: application/json` (no CORS is enabled, so other sites cannot send these).

## 5a. Places = two sides, tracking = people served
**Places:** the admin page has two fixed sides, **الجانب الأيمن** and **الجانب الأيسر** (stored as two blocks with these names, so the API/DB did not change). Each side holds committees (range input like `51-100`, quick split "1..N on the left, the rest on the right", or tap a committee to cycle none → left → right → none) and an optional description. Ushers see the side name (+ description) on the result. Blocks created by the old design are ignored by the new UI and replaced on the next save.
**Tracking tab:** cards (served = distinct found numbers, total numbers on the official list = 85,500, percentage, not-found, foreign), a per-type table, and the latest 200 entries with a Cairo-time timestamp (refreshes every 15 s). **مسح كل السجلات** shows a "هل أنت متأكد؟" box and then deletes everything (the same member can then be counted again).
**Counting rules:** one entry per (type, number) — looking the same member up again is not counted twice (time = first lookup). Foreign (committee 100, no number) counts per lookup and is excluded from the percentage. A lookup is sent when the usher taps التالي or after 4 s on the result (a corrected type or number is therefore not double counted; "عدّل الرقم" cancels it). Offline lookups are queued in localStorage (max 500) and sent when back online with their original time (`ago`, max 24 h).

## 6. Front end
Static files, no build step. `app.js` (usher) and `admin.js` are plain ES5-style modules wrapped in IIFEs; DOM built with `textContent`/`createElement`. State: `localStorage` keys `committees`, `blocks` (fallback when offline). `sw.js` precaches the shell (stale-while-revalidate) so the app starts with no network. Camera + number reader: see §6a. Results pause the reader; **التالي** resumes it. Same number within 3 s is ignored.

## 6a. Number scanner (on-device OCR, button-triggered)
The card's **printed membership number** is read, not a barcode/QR. The usher aims the rear camera at the number inside the 3:1 viewfinder and taps **امسح الرقم**; the number is written into the manual box (editable) and nothing is looked up until the usher taps **اعرف اللجنة**. Pipeline (all in the browser; frames and text never leave the device):
`getUserMedia (REAR camera only, 1080p ideal; front camera is never used)` → on button press, 4 frames: crop the visible strip (`OcrPre.coverCrop`) → 960x320 canvas → grayscale → 2–98% contrast stretch → (Otsu black-on-white | stretched grayscale | tighter centre crop, per attempt) → **Western digits (0-9):** `tesseract.js` 7.0.0 in a Web Worker (`eng`, digits-only whitelist, PSM 7); **Arabic-Indic digits (٠-٩, also Persian ۰-۹):** `public/js/ar-digits.js` — connected components → 16×24 glyph bitmaps + size/position features → a tiny 1-hidden-layer network (`ar-digits-model.json`, ~190 KB, trained by `scripts/train_ar_digits.py` on synthetic renders in ~39 system fonts; Tesseract's `ara` model was tried and cannot read isolated digits: ٢٣٦٧ came back as «١١ ١١»). A strip counts as Arabic only when ≥ 2 glyphs are confident digits and they outnumber other glyphs 2:1 (one suffix letter tolerated); then Tesseract is skipped for that frame. Western lines are never claimed by the Arabic reader. → `OcrParse.extract` (Arabic-Indic/Persian digits → Western, O/l/S/B/Z→digit fixes only inside mostly-digit tokens, 1–6 digits, non-zero, optional suffix) → most frequent read wins (ties: highest confidence) → fill `#num` and the type chip.
Files: `public/js/scanner.js` (camera/worker/button scan), `ocr-preprocess.js`, `ocr-parse.js` (pure, unit-tested), engine in `public/ocr/t7.0.0/` (pinned, self-hosted, ~14 MB precached by the service worker).
Camera selection: `facingMode: {exact:'environment'}` → ideal → rear camera chosen by device label (main lens before ultra-wide/macro); a front camera is rejected (clear message, manual entry still works). Engine loads lazily after first paint ("جارٍ تجهيز القارئ…"). If nothing is read, the usher sees a retry hint plus the raw text the OCR saw (on-device only, for diagnosis).
The earlier continuous auto-scan with N-frame consensus was removed at the user's request (it never triggered on real phones); `createConsensus` remains in `ocr-parse.js` (tested) but is unused.
**Arabic-Indic reader accuracy: UNVERIFIED on real cards.** It is trained only on synthetic renders; measured **89.7% per glyph on 7 fonts never seen in training** (≈ 65% for a 4-digit number if errors were independent; some fonts are rejected rather than misread). Western digits (Tesseract) are far more reliable. The usher can always edit the box. Real card fonts/print quality may differ — retrain with `python3 scripts/train_ar_digits.py` after collecting card photos (add the card's font if known).
**Card format (B0): UNVERIFIED.** No real card photos were available. Working assumptions, to be confirmed from `tests/fixtures/cards/`: Western digits 0–9, single line, number only (suffix letter probably not printed → chips), up to 5 digits (max 72983). If cards print Arabic-Indic digits, switch to `ara` language data (add the file to `public/ocr/t7.0.0/lang`, the SW list and the worker call); if the suffix letter is printed and must be read, add `ara` and extend the whitelist.
Failure modes: bad light (torch button, contrast stretch), glare (tilt; Otsu may merge digits → consensus rejects), worn/embossed card (low confidence → no stable read → manual), wrong digit (shown prominently + one-tap edit; consensus makes isolated misreads rare), two numbers on the card (first plausible 1–6-digit token wins — UNVERIFIED), camera denied (message, manual works).
Accuracy tool: `npm run ocr:eval` (dev-only, label = file name, e.g. `2367.jpg`, `822_ع.png`).

## 7. Failure modes
| Failure | Behaviour |
|---|---|
| Wi-Fi drops | Lookup continues from cache; pill shows "غير متصل"; blocks edits made meanwhile appear when back online |
| Server down | Same as above for ushers; admin cannot save |
| Camera denied/broken | Error text; manual entry is already on screen |
| OCR misreads / cannot read the card | Number shown prominently, **عدّل الرقم**; manual entry always on screen |
| Admin forgets to assign a block | Result shows "لم يُحدَّد المكان بعد" (committee still shown) |
| Corrupt/old PDF data | Extraction script refuses to write; tests guard every range |

## 8. Deployment (Vercel + Supabase)
GitHub `geoNaem/geoNaem-election-ushers` (main) → Vercel project `election-ushers` (team geonaems-projects, framework Other). `vercel.json`: no install, build = copy `data/committees.json` into `public/data/`, output dir `public`, `/admin` rewrite, security headers, caching (`/sw.js` and committees.json no-cache; `/ocr/t7.0.0/*` immutable). Functions: `api/*.js` (thin adapters) → `lib/api.js`, `lib/db.js` (PostgREST via fetch), `lib/auth.js`, `lib/validate.js`.
Env (Production + Preview): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PIN` (≥6), `SESSION_SECRET` (≥16). Any missing/weak value → generic 500 from every function (fail closed). Production URL: https://election-ushers.vercel.app. Schema changes: add a file to `supabase/migrations/` and apply it with the Supabase MCP/CLI. Functions run in iad1 (Vercel default) while the database is in eu-west-1; consider setting a Vercel function region near Frankfurt if latency matters.

## 9. Decisions log
1. Client-side lookup (privacy, offline, load) — chosen over server lookup.
2. ~~SQLite~~ superseded by decision 7 (Supabase Postgres).
3. Shared admin PIN over accounts — matches "keep it simple"; mitigated by rate limit, audit log, HTTPS-only cookie, short session.
4. No framework/build — fewer failure points; the whole app is ~1k lines.
5. Blocks are public read — they only say where a committee is, not who anyone is.
6. **Number scanner = on-device OCR (tesseract.js) instead of barcode/QR (html5-qrcode).** The cards carry a printed membership number; no barcode contents were confirmed. OCR keeps the privacy rule (nothing leaves the device) and works offline once the ~14 MB engine is cached. Cost: slower and less reliable than a barcode → consensus rule, edit/type chips, manual fallback, accuracy gate. CSP gains `'wasm-unsafe-eval'` and `worker-src blob:` (see security-qa).
8. **People-served tracking stores membership numbers server-side (owner's explicit request, supersedes "scans never reach the server" for numbers only).** Minimal data: type, number, resulting committee, time. No names, no IP, no device id. Clearable by an admin. The public write endpoint is unauthenticated (ushers have no login): it validates strictly, is idempotent, and anyone who can reach the site could inflate the count (accepted; the table can be wiped).
7. **Hosting: Vercel Functions + Supabase Postgres instead of Express + SQLite (DONE).** SQLite cannot persist on Vercel. Rate limiting moved to Postgres so it survives cold starts; whole-config replace is one SQL function (atomic).
