"""Full-site audit for the Baraka prototype.

One check per bug class actually hit in this project, so a regression in any of
them fails loudly instead of being discovered by a persona review:
  dead script references, broken links and anchors, unbalanced or dead CSS,
  cascade-order overrides of the scale tokens, printed dimensions disagreeing
  with the image attributes, inconsistent commission figures, and placeholders.
"""
import io, os, re, sys, glob, json

os.chdir(sys.argv[1] if len(sys.argv) > 1 else ".")
PAGES = sorted(glob.glob("*.html"))
SRC = {f: io.open(f, encoding="utf-8").read() for f in PAGES}
fails, warns = [], []


def fail(c, m): fails.append((c, m))
def warn(c, m): warns.append((c, m))


def body_of(s):
    b = s[s.index("<body>"):] if "<body>" in s else s
    b = re.sub(r"<script.*?</script>", "", b, flags=re.S)
    return re.sub(r"<style.*?</style>", "", b, flags=re.S)


# 1 ── document completeness
for f, s in SRC.items():
    h = s[:400].lower()
    for need, label in (("<!doctype html>", "doctype"), ('charset="utf-8"', "charset"),
                        ("viewport", "viewport meta"), ('<html lang=', "lang")):
        if need not in h:
            fail("document", f"{f}: missing {label}")
    if "</html>" not in s[-40:]:
        fail("document", f"{f}: does not end with </html>")
    if s.count("<h1") != 1:
        warn("document", f"{f}: {s.count('<h1')} <h1> elements")

# 2 ── script references an element that is not on the page
for f, s in SRC.items():
    ids = set(re.findall(r'id="([^"]+)"', s))
    for pat in (r'getElementById\("([^"]+)"\)', r'querySelector\("#([A-Za-z0-9_-]+)'):
        for g in sorted(set(re.findall(pat, s))):
            if g not in ids:
                fail("dead-script-ref", f"{f}: #{g} does not exist on this page")

# 3 ── internal links and fragments resolve
have = set(PAGES)
for f, s in SRC.items():
    assets = set(glob.glob("*.css")) | set(glob.glob("*.js"))
    for href in sorted(set(re.findall(r'href="([^"]+)"', s))):
        if href.startswith(("http", "mailto:", "tel:")) or href in assets:
            continue
        if "'" in href or "+" in href:   # assembled in JS, not a literal target
            continue
        page, _, frag = href.partition("#")
        tgt = page or f
        if page and page not in have:
            fail("broken-link", f"{f}: -> {page} does not exist")
            continue
        if frag and tgt in SRC:
            ids = set(re.findall(r'id="([^"]+)"', SRC[tgt]))
            if frag not in ids and "location.hash" not in SRC[tgt]:
                warn("fragment", f"{f}: -> {tgt}#{frag} has no such id (nor a hash handler)")

# 4 ── orphans
for t in PAGES:
    inbound = sum(1 for f, s in SRC.items() if f != t and f'href="{t}"' in s)
    if inbound == 0:
        fail("orphan", f"{t}: zero inbound links")
    elif inbound < 3:
        warn("orphan", f"{t}: only {inbound} inbound link(s)")

# 5 ── CSS integrity, per page and in the shared sheet
def css_check(label, css, used):
    if css.count("{") != css.count("}"):
        fail("css", f"{label}: unbalanced braces {css.count('{')}{{ {css.count('}')}}}")
    if re.search(r"\}\s*\n\s+[a-z-]+\s*:[^;{]*;", css):
        fail("css", f"{label}: declaration outside any rule (orphaned selector?)")
    if used is not None:
        sels = re.findall(r"(?:^|[,}\n])\s*([.#:a-zA-Z][^,{}\n]*)\{", css)
        names = set()
        for sel in sels:
            names.update(re.findall(r"\.([a-zA-Z][a-zA-Z0-9_-]*)", sel))
        dead = sorted(c for c in names if c not in used)
        if dead:
            warn("css", f"{label}: styled but unused -> {', '.join('.' + d for d in dead)}")


for f, s in SRC.items():
    for m in re.finditer(r"<style>(.*?)</style>", s, flags=re.S):
        used = set()
        for c in re.finditer(r'class="([^"]+)"', s):
            used.update(c.group(1).split())
        css_check(f, m.group(1), used)

sheet = io.open("style.css", encoding="utf-8").read()
allused = set()
for s in SRC.values():
    for c in re.finditer(r'class="([^"]+)"', s):
        allused.update(c.group(1).split())
css_check("style.css", sheet, allused)

# 6 ── scale tokens must not be re-declared after their breakpoints (the --mmpx bug)
def token_order(label, css, token):
    decls = []
    for m in re.finditer(r"@media[^{]*\(max-width:\s*(\d+)px\)[^{]*\{[^}]*" + re.escape(token) + r"\s*:", css):
        decls.append(int(m.group(1)))
    if decls != sorted(decls, reverse=True):
        fail("cascade", f"{label}: {token} breakpoints out of order {decls} - a later, wider one wins")
    return decls


token_order("style.css", sheet, "--mmpx")
for f, s in SRC.items():
    if "--gm" in s:
        token_order(f, s, "--gm")

# 7 ── printed dimensions must agree with the image attributes (the swapped-dims bug)
for f, s in SRC.items():
    for m in re.finditer(r'<img[^>]*width="(\d+)"[^>]*height="(\d+)"', s):
        w, h = int(m.group(1)), int(m.group(2))
        tail = s[m.end():m.end() + 700]
        for d in re.finditer(r"H([\d,]+)\s*×\s*W([\d,]+)", tail):
            ph, pw = (int(x.replace(",", "")) for x in d.groups())
            if (ph, pw) != (h, w):
                fail("dimensions", f"{f}: img is {w}x{h} but caption says H{ph} x W{pw}")
            break

# 8 ── the commission figures must agree site-wide
pcts = {}
for f, s in SRC.items():
    b = body_of(s)
    for m in re.finditer(r"(\d{2})%", b):
        pcts.setdefault(m.group(1), set()).add(f)
money = {p: sorted(v) for p, v in pcts.items()}
expected = {"15", "20", "25", "68", "85", "50"}
for p, where in money.items():
    if p not in expected:
        warn("money", f"{p}% appears in {', '.join(where)} - not one of the agreed figures")
if "75" in money:
    fail("money", f"75% (the old commission model) still in {', '.join(money['75'])}")

# 8b ── an image's true aspect must match the aspect the page declares, or .art img
#       (width/height 100%) silently stretches the work. Also catch a decode bomb.
import struct

SOF = (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF)


def jpeg_size(path):
    """Read the SOF dimensions, stopping at start-of-scan.

    Scanning past SOS (0xDA) walks into entropy-coded data, where byte pairs
    happily impersonate an SOF marker: that is how an earlier version of this
    function reported a 960x630 photo as 12530x16167.
    """
    d = io.open(path, "rb").read()
    if d[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 3 < len(d):
        if d[i] != 0xFF:          # not at a marker: resynchronise
            i += 1
            continue
        m = d[i + 1]
        if m == 0xFF:             # fill byte
            i += 1
            continue
        if m == 0xDA or m == 0xD9:   # start of scan / end of image: stop
            return None
        if m == 0x01 or 0xD0 <= m <= 0xD8:   # standalone markers, no payload
            i += 2
            continue
        seglen = struct.unpack(">H", d[i + 2:i + 4])[0]
        if seglen < 2:
            return None
        if m in SOF:
            h, w = struct.unpack(">HH", d[i + 5:i + 9])
            return w, h
        i += 2 + seglen
    return None


REAL = {}
for n in os.listdir("img"):
    if n.lower().endswith((".jpg", ".jpeg")):
        REAL["img/" + n] = jpeg_size("img/" + n)
        mp = REAL["img/" + n][0] * REAL["img/" + n][1] / 1e6
        if mp > 25:
            fail("images", f"img/{n} is {REAL['img/' + n][0]}x{REAL['img/' + n][1]} "
                           f"= {mp:.0f} megapixels - will stall a phone decoding it")

DECL = re.compile(r'(?:src|f)[=:]"?(img/w\d\.jpg)"?[^>}]{0,120}?'
                  r'w(?:idth)?[=:]"?(\d+)"?[^>}]{0,40}?h(?:eight)?[=:]"?(\d+)')
for f, s in SRC.items():
    for m in DECL.finditer(s):
        img, dw, dh = m.group(1), int(m.group(2)), int(m.group(3))
        if img not in REAL:
            continue
        rw, rh = REAL[img]
        off = abs(rw / rh - dw / dh) / (dw / dh) * 100
        if off >= 2:
            fail("dimensions", f"{f}: {img} is {rw}x{rh} but declared {dw}x{dh} "
                               f"- stretched {off:.0f}%")

# 9 ── images
refs = set()
for s in SRC.values():
    refs.update(re.findall(r'["\'](img/[^"\']+)["\']', s))
present = {"img/" + x for x in os.listdir("img")}
for miss in sorted(refs - present):
    fail("images", f"{miss} referenced but not present")
for unused in sorted(present - refs):
    warn("images", f"{unused} present but unreferenced")
for p in sorted(present):
    kb = os.path.getsize(p) / 1024
    if kb > 400:
        warn("images", f"{p} is {kb:.0f} KB - heavy for a hero")

# 10 ── placeholders still standing in live positions
for f, s in SRC.items():
    for pat, label in (("045-000-0000", "fake phone"), ("正式開業時", "unfilled company field"),
                       ("準備中", "coming-soon"), ("dashed", "empty placeholder box"),
                       ("coming soon", "coming-soon")):
        n = s.count(pat)
        if n:
            warn("placeholder", f"{f}: {label} x{n}")

# 11 ── the poison words the artist reviewer named
for f, s in SRC.items():
    b = body_of(s)
    for w in ("支援", "応援", "育つ", "露出", "クリエイター", "夢"):
        if w in b:
            fail("tone", f"{f}: contains {w}")

# ── report
print("=" * 62)
print(f"  {len(PAGES)} pages audited")
print("=" * 62)
groups = {}
for c, m in fails:
    groups.setdefault(c, []).append(m)
if fails:
    print(f"\n  FAIL ({len(fails)})")
    for c, ms in groups.items():
        print(f"   [{c}]")
        for m in ms:
            print(f"     - {m}")
else:
    print("\n  FAIL (0)   nothing broken")
wg = {}
for c, m in warns:
    wg.setdefault(c, []).append(m)
print(f"\n  WARN ({len(warns)})")
for c, ms in sorted(wg.items()):
    print(f"   [{c}]")
    for m in ms:
        print(f"     - {m}")
print()
sys.exit(1 if fails else 0)
