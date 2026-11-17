# Election Ushers — لجان الجمعية العمومية

Election-day tool for ushers. The printed membership number on the member's card is read by the camera (on-device OCR) or typed, and the screen shows:

1. the member's **committee number** (computed from the official PDF), and
2. the **block** where that committee is located (set by an admin).

No logins for ushers. One shared PIN protects the admin page. Works offline after the first load.

## Quick start

```bash
npm install
cp .env.example .env        # then edit ADMIN_PIN and SESSION_SECRET
export $(grep -v '^#' .env | xargs)   # or use your shell's way of loading env
npm start                   # http://localhost:3000   admin: /admin
npm test                    # 21 tests (lookup, OCR parsing, API, security)
npm run ocr:eval            # OCR accuracy over tests/fixtures/cards/ (labelled photos, dev-only)
```

Camera access needs **HTTPS** (or `localhost`). Phones on a LAN will not get a camera over plain `http://192.168...` — deploy with HTTPS (see below).

## The two screens

| URL | Who | What |
|---|---|---|
| `/` | Ushers (no login) | Scan card or type number → committee + block |
| `/admin` | Admins (PIN) | Create blocks, assign committees 1–100 to them, save |

**Admin flow:** open `/admin` → enter the PIN → *+ إضافة بلوك* → name it (and optional place note, e.g. "بجوار المسبح") → with the block selected, tap committee numbers or type ranges like `1-12, 20` → **حفظ**. Ushers pick the change up within ~30 seconds. Dashed committees are not assigned to any block yet.

## Data source = the PDF

`data/source/committees-2026-11-20.pdf` is the source of truth. `scripts/extract_committees.py` converts it to `data/committees.json` and **refuses to write** if the ranges have gaps/overlaps or any committee 1–100 is missing.

```bash
npm run extract        # needs poppler-utils (pdftotext)
npm test
```

If the club issues a corrected PDF: replace the file, run the two commands above, redeploy.

## Membership types

| Card suffix | Type | Committees |
|---|---|---|
| none | Working (عاملة) | 1–84 |
| ع | Military | 85–91 |
| د | Ladies | 92–96 |
| ب | Port Said | 97–99 |
| بع / دب | Port Said military / ladies | 99 |
| — | Foreign / political / refugee | 100 |

## Deploy (pick one)

- **Render / Railway / Fly.io** with a persistent disk: build with the included `Dockerfile`, mount a volume at `/data`, set env vars `ADMIN_PIN`, `SESSION_SECRET`, `NODE_ENV=production`, `TRUST_PROXY=1`. HTTPS is automatic on these platforms.
- **A laptop on the day** + a tunnel (Cloudflare Tunnel / ngrok) for HTTPS. Fine as a fallback; the usher pages still work offline once loaded.

See `docs/` for design system, system design, security & QA, and the implementation plan. AI agents: read `AGENTS.md` first.
