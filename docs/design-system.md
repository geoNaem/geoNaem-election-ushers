# Design system — "ب · النقاء" (white + mint)

Direction chosen from the three explored on the design canvas. Single-screen usher flow; neutral (no candidate/list branding, no club crest).

## 1. Principles
1. **The committee number is the hero.** Largest element on the result screen; readable at arm's length outdoors.
2. **One screen, no tabs.** Camera on top, manual entry below — a damaged card never costs an extra tap.
3. **Calm and neutral.** White and mint; the only strong colour is the action green. Red is used solely for "not found".
4. **Never colour alone.** Status always has text; blocks always have a number.

## 2. Tokens (see `public/css/base.css`)
Three tiers, each referencing only the one below.

| Tier | Token | Value | Use |
|---|---|---|---|
| 1 brand | `--green-600` | `#0f7a4d` | primary action, ring, focus-adjacent accents |
| 1 | `--green-700` | `#0b5a39` | big numerals, strong text on mint |
| 1 | `--green-100 / 200 / 300` | `#e3f4ea / #dff1e6 / #b9d8c6` | surfaces, scan frame, borders |
| 1 | `--ink` / `--ink-soft` | `#10261c` / `#4b6358` | text / secondary text |
| 1 | `--page` / `--bg` | `#fbfdfb` / `#eef3f0` | app surface / desktop backdrop |
| 1 | `--red-700 / --red-100` | `#8f1d17 / #fbe9e7` | "not found" only |
| 2 alias | `--primary`, `--primary-strong`, `--surface`, `--text`, `--text-soft`, `--danger`, `--danger-surface`, `--focus` | → tier 1 | components use **only** these |
| spacing | `--s1…--s8` | 4,8,12,16,20,24,32 px | 4px grid |
| radius | `--r-sm/md/lg/pill` | 12 / 16 / 24 / 999 | |

Contrast checked: `--ink` on `--page` ≈ 15.6:1; `--ink-soft` on white ≈ 6.5:1; white on `--green-600` ≈ 5.4:1; `--green-700` on white ≈ 8.3:1; `--red-700` on `--red-100` ≈ 7.6:1.

## 3. Typography
Font: **IBM Plex Sans Arabic** (self-hosted woff2 in `public/fonts`, weights 400/500/600/700; Latin digits via the Latin subset). Body 16px / 1.5 (Arabic needs the looser line-height).

| Role | Size | Weight |
|---|---|---|
| Committee number (ring) | 120px | 700 |
| Screen title | 22px | 700 |
| Block name (result) | 22px | 700 |
| Member number | 20px | 700 |
| Body / chips / labels | 15–18px | 500–600 |
| Helper text | 14px | 400 |

Numerals are shown in Western digits (matches the card and the keyboard). Switch to Arabic-Indic by changing display only, never the stored/parsed values.

## 4. Components
- **Viewfinder** — a wide, short strip (`aspect-ratio: 3/1`, ≈ 342×114 at 390px), radius 24px, `--green-200`, four 28px corner brackets in `--primary`; `<video playsinline muted>` fills it (`object-fit: cover`) and the visible strip is exactly what the OCR reads. Below it a full-width **امسح الرقم** primary button (≥58px; label becomes «جارٍ القراءة…» while reading) and the hint «ضع رقم العضوية داخل الإطار ثم اضغط «امسح الرقم»». A successful scan fills the number box (selected, editable) and the type chip; nothing is submitted automatically.
- **Loading state** — inside the frame: «جارٍ تجهيز القارئ…» while the engine loads, «جارٍ تشغيل الكاميرا…» while the camera starts; camera-denied text replaces it. Slow/failed-engine notices appear under the frame (14px, 600).
- **Torch button** — pill inside the frame, bottom centre, ≥44px, white 2px border on dark translucent; `aria-pressed` inverts to white. Hidden when the camera has no torch. Tapping the frame requests a single-shot focus where supported.
- **Number input** — 60px high, 28px text, centred, `dir=ltr`, `inputmode=numeric`, 2px `--green-300` border → `--primary` on focus.
- **Type chips** — pill buttons ≥44px, `aria-pressed` toggles, selected = filled `--primary`. Options: عاملة · عسكري (ع) · سيدات (د) · بورسعيد (ب) · بورسعيد عسكري (بع) · بورسعيد سيدات (دب) · أجنبي/سياسي/لاجئ.
- **Primary button** — 58px, full width, 20px bold.
- **Result ring** — 290px mint disc, 228px white disc, 6px `--primary` border, label + number. Not-found state swaps to red tokens and shows "؟".
- **Facts card** — rows: **الرقم المقروء** (20px bold + **عدّل الرقم** link-button ≥44px that returns to the form pre-filled) · نوع العضوية (the same type chips; tapping one re-runs the lookup immediately) · **مكان اللجنة** (block name 22px bold + optional note). If the committee has no block yet: "لم يُحدَّد المكان بعد" (muted).
- **Sync pill** (header) — "محدّث" (mint) / "غير متصل — آخر نسخة محفوظة" (red tint).
- **Admin (current)** — tabs **الأماكن / المتابعة**; places = two side panels (right panel on the physical right: tag «ي»; left: «س»; description + range input + أفرغ), a quick-split row, and the 1–100 grid (chip = number + side letter; dashed = unassigned; tap cycles none→left→right). Tracking = stat cards (served, total, **percentage with progress bar**, not found, foreign), per-type table, entries table (#, time, number, type, committee; not-found rows in red), refresh, and a red **مسح كل السجلات** with an inline «هل أنت متأكد؟» confirmation box.
- **Admin (old, replaced)** — block cards (name, place note, count, delete), committee grid 1–100 (chips coloured by block with a `ب<number>` label; unassigned = dashed border), range input (`1-12, 20`), sticky bar with save state.
- Block colours: 8 mint/green/teal steps (`.c0–.c7` in `admin.css`) that differ in **lightness**, plus the block number on every chip.

## 5. RTL & accessibility rules
- `<html lang="ar" dir="rtl">`; logical order right→left; numbers inside `dir=ltr` elements.
- Tap targets ≥ 44px; visible `:focus-visible` ring (3px `--focus`); `prefers-reduced-motion` respected.
- Result region is `aria-live="polite"`; focus moves to **التالي** when a result appears.
- Icon-only controls need `aria-label`. No emoji as UI glyphs.

## 6. States to design/test
Camera starting · camera denied · found (with block) · found (block not set) · not found · foreign (committee 100) · offline · admin: logged out / wrong PIN / locked (429) / dirty / saved / save failed.
