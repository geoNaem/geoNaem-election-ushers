#!/usr/bin/env python3
"""Extract committee ranges from the official PDF into data/committees.json.

Usage:  python3 scripts/extract_committees.py [path/to/kashf.pdf]
Needs:  poppler-utils (pdftotext).

Output rows: [suffix, from, to, committee]
  suffix ''   = working members (committees 1-84)
  suffix 'ع'  = military      'د' = ladies     'ب' = Port Said
  suffix 'بع' / 'دب' = Port Said military / ladies (committee 99, continued)
  suffix '*'  = foreign + political + refugee (committee 100, all numbers)
The script refuses to write the file if the data fails its sanity checks.
"""
import json, re, subprocess, sys, pathlib, datetime
root = pathlib.Path(__file__).resolve().parent.parent
pdf = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / "data/source/committees-2026-11-20.pdf"
txt = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True, check=True).stdout
txt = re.sub("[‪-‮‎‏⁦-⁩]", "", txt)
txt = txt.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
rows, section = [], None
for line in txt.splitlines():
    s = line.strip()
    if not s: continue
    if "العاملة" in s: section = "work"; continue
    if "العسكريين" in s: section = "mil"; continue
    if "السيدات" in s: section = "ladies"; continue
    if "بورسعيد" in s and "عضوية" in s: section = "ps"; continue
    if "أجنبي" in s and "لجنة" in s: section = "foreign"; continue
    if section == "work":
        n = re.findall(r"\d+", s)
        if len(n) == 6:
            for k in (0, 3):
                to, fr, c = map(int, n[k:k + 3]); rows.append(["", fr, to, c])
    elif section in ("mil", "ladies", "ps"):
        m = re.findall(r"(\d+)\s*([^\d\s()]+)", s); n = re.findall(r"\d+", s)
        if len(m) >= 2 and len(n) >= 3:
            to, sto = int(m[0][0]), m[0][1]; fr, sfr = int(m[1][0]), m[1][1]
            assert sto == sfr, f"suffix mismatch in: {line!r}"
            rows.append([sto, fr, to, int(n[2])])
rows.append(["*", 0, 0, 100])  # foreign/political/refugee: all numbers -> committee 100

# ---- sanity checks (fail loudly) ----
by = {}
for suf, fr, to, c in rows:
    if suf != "*": by.setdefault(suf, []).append((fr, to, c))
for suf, rs in by.items():
    rs.sort(); prev = None
    for fr, to, c in rs:
        assert fr <= to, f"inverted range {suf} {fr}-{to}"
        assert prev is None or fr == prev + 1, f"gap/overlap in '{suf}' at {fr} (prev end {prev})"
        prev = to
work = sorted({r[3] for r in rows if r[0] == ""})
assert work == list(range(1, 85)), "working committees must be exactly 1..84"
assert sorted({r[3] for r in rows}) == list(range(1, 101)), "committees 1..100 must all appear"
out = root / "data/committees.json"
out.write_text(json.dumps({
    "source": pdf.name,
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "maxCommittee": 100,
    "rows": rows}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"OK: {len(rows)} rows written to {out}")
