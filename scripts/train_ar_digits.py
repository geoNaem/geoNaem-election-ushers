#!/usr/bin/env python3
"""Train the tiny Arabic-Indic digit classifier used by public/js/ar-digits.js (Tesseract's `ara` model cannot read them).
Synthetic data: digits U+0660-0669 and Persian U+06F0-06F9 rendered in many system fonts, plus an 'other' class
(Western digits, Arabic/Latin letters, specks, rules). Pure numpy; writes public/js/ar-digits-model.json.
Run:  python3 scripts/train_ar_digits.py   (needs numpy, Pillow; macOS system fonts)"""
import glob, json, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'js', 'ar-digits-model.json')
GH, GW = 24, 16               # glyph bitmap size fed to the network (must match ar-digits.js)
NCLS = 11                     # 0..9 = digit value, 10 = other
HID = 64
random.seed(7); np.random.seed(7)

# ---------- fonts ----------
CANDIDATES = []
for d in ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts']:
    CANDIDATES += glob.glob(d + '/*.ttf') + glob.glob(d + '/*.ttc') + glob.glob(d + '/*.otf')
AR = [chr(0x0660 + i) for i in range(10)]
FA = [chr(0x06F0 + i) for i in range(10)]

def render(ch, font, size=200, canvas=(420, 420)):
    im = Image.new('L', canvas, 255); ImageDraw.Draw(im).text((60, 330), ch, font=font, fill=0, anchor='ls')
    return im

def probe(path):
    """-> list of (path, index) faces where all 10 Arabic-Indic digits render distinct, non-tofu glyphs."""
    good = []
    for idx in range(0, 12):
        try: f = ImageFont.truetype(path, 120, index=idx)
        except Exception: break
        try:
            tofu = np.asarray(render('͸', f, canvas=(300, 300)))
            ims = [np.asarray(render(c, f, canvas=(300, 300))) for c in AR]
        except Exception: continue
        if any((a == 255).all() for a in ims): continue
        if any((a == tofu).all() for a in ims): continue
        if len({a.tobytes() for a in ims}) < 10: continue
        good.append((path, idx))
    return good

ARABIC_FACES = []
for p in sorted(set(CANDIDATES)):
    if any(s in os.path.basename(p) for s in ['Emoji', 'LastResort', 'Braille', 'Symbols']): continue
    ARABIC_FACES += probe(p)
LATIN_FACES = [(p, 0) for p in sorted(set(CANDIDATES)) if os.path.basename(p) in
               ('Arial.ttf', 'Arial Bold.ttf', 'Times New Roman.ttf', 'Courier New.ttf', 'Georgia.ttf', 'Verdana.ttf', 'Tahoma.ttf',
                'Trebuchet MS.ttf', 'Helvetica.ttc', 'HelveticaNeue.ttc', 'Arial Narrow.ttf', 'Impact.ttf', 'Menlo.ttc')]
if len(ARABIC_FACES) < 4: sys.exit('too few fonts with Arabic-Indic digits found: %d' % len(ARABIC_FACES))
print('Arabic-digit faces:', len(ARABIC_FACES), '| latin faces:', len(LATIN_FACES))
random.shuffle(ARABIC_FACES)
n_val = max(3, len(ARABIC_FACES) // 5)
VAL_FACES, TRAIN_FACES = ARABIC_FACES[:n_val], ARABIC_FACES[n_val:]   # validation = fonts never seen in training

OTHER_CHARS = list('0123456789') + list('ABCDEFGHJKLMNPRSTUVWXYZabdefghkmnrtu') + list('عدبهوينمسقكلرتثجحخذزشصضطظغفاأإآ') + ['بع', 'دب', '/', '-', '.', ':']

# ---------- shared feature pipeline (mirrors public/js/ar-digits.js) ----------
def otsu(g):
    hist = np.bincount(g.ravel(), minlength=256).astype(float); total = g.size
    s = (np.arange(256) * hist).sum(); wB = 0.0; sB = 0.0; best = 0.0; thr = 127
    for i in range(256):
        wB += hist[i]
        if not wB: continue
        wF = total - wB
        if not wF: break
        sB += i * hist[i]
        d = sB / wB - (s - sB) / wF; v = wB * wF * d * d
        if v > best: best, thr = v, i
    return thr

def binarize(g):
    g = g.astype(np.uint8)
    lo, hi = np.percentile(g, 2), np.percentile(g, 98)
    if hi - lo >= 20: g = np.clip((g.astype(float) - lo) * 255.0 / (hi - lo), 0, 255).astype(np.uint8)
    t = otsu(g); b = g <= t           # True = ink (dark)
    if b.mean() > 0.5: b = ~b
    return b

def box_resize(m, th, tw):
    h, w = m.shape; ii = np.zeros((h + 1, w + 1)); ii[1:, 1:] = m.cumsum(0).cumsum(1)
    out = np.zeros((th, tw))
    for i in range(th):
        r0 = (i * h) // th; r1 = max(r0 + 1, -(-((i + 1) * h) // th))
        for j in range(tw):
            c0 = (j * w) // tw; c1 = max(c0 + 1, -(-((j + 1) * w) // tw))
            out[i, j] = (ii[r1, c1] - ii[r0, c1] - ii[r1, c0] + ii[r0, c0]) / ((r1 - r0) * (c1 - c0))
    return out

def feat(mask, top, href, line_top):
    h, w = mask.shape
    cy = top + h / 2.0
    return np.concatenate([box_resize(mask.astype(float), GH, GW).ravel(),
                           [min(w / h, 3.0) / 3.0, min(h / href, 1.0), min(w / href, 1.5), min(max((cy - line_top) / href, 0.0), 1.5) / 1.5]]).astype(np.float32)

# ---------- synthetic lines ----------
def glyph_canvas(ch, face, size, W, H, x0):
    f = ImageFont.truetype(face[0], size, index=face[1])
    im = Image.new('L', (W, H), 255); ImageDraw.Draw(im).text((x0, int(H * 0.7)), ch, font=f, fill=0, anchor='ls'); return im

def make_line(faces, label_fn, allow_other=True):
    size = random.randint(90, 230); W, H = 1000, 340
    n = random.randint(2, 5); x = random.randint(20, 120); items = []
    for _ in range(n):
        if allow_other and random.random() < 0.18:
            ch = random.choice(OTHER_CHARS); lab = 10; face = random.choice(LATIN_FACES + faces[: max(1, len(faces))]) 
        else:
            lab = random.randint(0, 9); ch = (AR if random.random() < 0.75 else FA)[lab]; face = None
        items.append((ch, lab, face))
    base_face = random.choice(faces)           # one font per line (as on a real card)
    ang = random.uniform(-4, 4); shear = random.uniform(-0.12, 0.12)
    canv = []; line_ink = np.full((H, W), 255, np.uint8)
    for ch, lab, face in items:
        use = face if face is not None else base_face
        if lab == 10 and face is not None and use in LATIN_FACES: pass
        try: g = glyph_canvas(ch, use, size, W, H, x)
        except Exception: g = glyph_canvas(ch, base_face, size, W, H, x)
        bbox = np.asarray(g) < 128
        if not bbox.any(): x += size // 2; continue
        cols = np.where(bbox.any(0))[0]; adv = cols.max() - cols.min()
        g = g.transform(g.size, Image.AFFINE, (1, shear, -shear * H * 0.5, 0, 1, 0), fillcolor=255).rotate(ang, fillcolor=255, resample=Image.BILINEAR)
        a = np.asarray(g); canv.append((a, lab)); line_ink = np.minimum(line_ink, a)
        x += int(adv + size * random.uniform(0.22, 0.5))
        if x > W - size: break
    if len(canv) < 1: return []
    im = Image.fromarray(line_ink)
    if random.random() < 0.6: im = im.filter(ImageFilter.GaussianBlur(random.uniform(0.3, 1.8)))
    arr = np.asarray(im).astype(float)
    arr = arr * random.uniform(0.55, 1.0) + random.uniform(0, 70)                    # low contrast / bright
    gy, gx = np.mgrid[0:H, 0:W]; arr += (gx / W - 0.5) * random.uniform(-60, 60)    # lighting gradient (glare)
    arr += np.random.normal(0, random.uniform(0, 12), arr.shape)
    bw = binarize(np.clip(arr, 0, 255))
    if random.random() < 0.3:                                                         # stroke thickness change
        k = random.choice([3, 3, 5]); im2 = Image.fromarray((~bw * 255).astype(np.uint8)).filter(random.choice([ImageFilter.MaxFilter(k), ImageFilter.MinFilter(k)])); bw = np.asarray(im2) < 128
    boxes = []
    for a, lab in canv:
        m = a < 128
        ys, xs = np.where(m); y0, y1, x0b, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        sub = bw[max(0, y0 - 3):y1 + 3, max(0, x0b - 3):x1 + 3]
        ys2, xs2 = np.where(sub)
        if len(ys2) < 8: continue
        ty, tx = ys2.min() + max(0, y0 - 3), xs2.min() + max(0, x0b - 3)
        mask = sub[ys2.min():ys2.max() + 1, xs2.min():xs2.max() + 1]
        boxes.append((mask, ty, lab))
    if not boxes: return []
    href = max(m.shape[0] for m, _, _ in boxes); top = min(t for _, t, _ in boxes)
    # specks / rules as 'other' (card edges, dust)
    out = [(feat(m, t, href, top), lab) for m, t, lab in boxes if m.shape[0] >= 0.12 * href]
    for _ in range(random.randint(0, 2)):
        sw, sh = random.randint(4, max(5, href // 4)), random.randint(4, max(5, href // 3))
        sp = np.ones((sh, sw), bool); out.append((feat(sp if random.random() < 0.5 else np.ones((href, 3), bool), top + random.randint(0, href), href, top), 10))
    return out

def dataset(faces, n_lines):
    X, Y = [], []
    for i in range(n_lines):
        for f, l in make_line(faces, None): X.append(f); Y.append(l)
        if i % 500 == 0: print('  lines', i, '/', n_lines, flush=True)
    return np.array(X), np.array(Y)

# ---------- tiny MLP (numpy, Adam) ----------
def softmax(z): z = z - z.max(1, keepdims=True); e = np.exp(z); return e / e.sum(1, keepdims=True)
def forward(P, X): h = np.maximum(0, X @ P['W1'] + P['b1']); return h, softmax(h @ P['W2'] + P['b2'])

def train(Xtr, Ytr, Xva, Yva, epochs=30):
    d = Xtr.shape[1]; rng = np.random.default_rng(1)
    P = {'W1': rng.normal(0, np.sqrt(2 / d), (d, HID)), 'b1': np.zeros(HID), 'W2': rng.normal(0, np.sqrt(2 / HID), (HID, NCLS)), 'b2': np.zeros(NCLS)}
    M = {k: np.zeros_like(v) for k, v in P.items()}; V = {k: np.zeros_like(v) for k, v in P.items()}; t = 0
    cw = np.ones(NCLS); cw[10] = 0.6
    for ep in range(epochs):
        idx = rng.permutation(len(Xtr)); lr = 0.003 * (0.5 ** (ep // 10))
        for s in range(0, len(idx), 128):
            b = idx[s:s + 128]; X, Y = Xtr[b], Ytr[b]
            Xn = X + rng.normal(0, 0.03, X.shape)
            h, p = forward(P, Xn); g = p.copy(); g[np.arange(len(b)), Y] -= 1; g *= (cw[Y] / len(b))[:, None]
            gr = {'W2': h.T @ g, 'b2': g.sum(0)}; dh = (g @ P['W2'].T) * (h > 0); gr['W1'] = Xn.T @ dh; gr['b1'] = dh.sum(0)
            gr['W1'] += 1e-4 * P['W1']; t += 1
            for k in P:
                M[k] = 0.9 * M[k] + 0.1 * gr[k]; V[k] = 0.999 * V[k] + 0.001 * gr[k] ** 2
                P[k] -= lr * (M[k] / (1 - 0.9 ** t)) / (np.sqrt(V[k] / (1 - 0.999 ** t)) + 1e-8)
        if ep % 5 == 4 or ep == epochs - 1:
            print('epoch', ep + 1, 'train', round(float((forward(P, Xtr)[1].argmax(1) == Ytr).mean()), 4), 'val(unseen fonts)', round(float((forward(P, Xva)[1].argmax(1) == Yva).mean()), 4), flush=True)
    return P

if __name__ == '__main__':
    NL = int(os.environ.get('LINES', 6000))
    print('generating train'); Xtr, Ytr = dataset(TRAIN_FACES, NL)
    print('generating val (unseen fonts)'); Xva, Yva = dataset(VAL_FACES, max(600, NL // 8))
    print('samples', len(Xtr), len(Xva))
    P = train(Xtr, Ytr, Xva, Yva)
    _, pv = forward(P, Xva); pred = pv.argmax(1)
    dig = Yva < 10
    print('digit-only accuracy on unseen fonts:', round(float((pred[dig] == Yva[dig]).mean()), 4), '| other-class accuracy:', round(float((pred[~dig] == 10).mean()), 4))
    r = lambda a: np.round(a, 4).tolist()
    json.dump({'gh': GH, 'gw': GW, 'hid': HID, 'classes': NCLS, 'W1': r(P['W1']), 'b1': r(P['b1']), 'W2': r(P['W2']), 'b2': r(P['b2']),
               'meta': {'fonts_train': len(TRAIN_FACES), 'fonts_val': len(VAL_FACES), 'samples': int(len(Xtr)), 'val_digit_acc': round(float((pred[dig] == Yva[dig]).mean()), 4)}},
              open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')
