#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_og.py — рисует og-картинку 1200×630 для превью в телеге
из тех же данных (assets/js/data.js) и тех же шрифтов (assets/fonts).

    python tools/make_og.py
    python tools/make_og.py --data assets/js/data.js --out assets/img/og.png

Зависимости (только для перегенерации, сама og.png лежит в репо):
    pip install pillow fonttools brotli
"""
import argparse
import io
import json
import os
import re
import sys

try:
    from fontTools.ttLib import TTFont
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Нужны pillow, fonttools и brotli:\n    pip install pillow fonttools brotli")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------- палитра (та же, что в style.css) ----------
BG    = (7, 11, 19)
INK   = (234, 241, 250)
DIM   = (156, 168, 187)
FAINT = (102, 116, 139)
C1    = (38, 208, 255)     # электрик-циан
C2    = (138, 123, 255)    # индиго
C3    = (0, 224, 198)      # бирюза
C4    = (79, 159, 255)     # синий
C5    = (192, 232, 255)    # ледяной

W, H, M = 1200, 630, 72

# ---------------------------------------------------------------- шрифты

FONT_BYTES = {}
FCACHE = {}


def load_display():
    """Unbounded из woff2, развёрнутый в память ttf. Латынь + кириллица."""
    for subset in ("latin", "cyrillic"):
        path = os.path.join(ROOT, "assets", "fonts", "unbounded-%s-wght-normal.woff2" % subset)
        tt = TTFont(path)
        tt.flavor = None                                   # отваливаем woff2
        buf = io.BytesIO()
        tt.save(buf)
        FONT_BYTES[subset] = buf.getvalue()


def get_font(subset, size, weight=900):
    key = (subset, size)
    if key not in FCACHE:
        f = ImageFont.truetype(io.BytesIO(FONT_BYTES[subset]), size)
        try:
            f.set_variation_by_axes([weight])              # variable wght → 900
        except Exception:
            pass
        FCACHE[key] = f
    return FCACHE[key]


CYR = re.compile(r"[\u0301\u0400-\u04FF\u2116]")


def pick_font(ch, size):
    return get_font("cyrillic", size) if CYR.match(ch) else get_font("latin", size)


def text_size(s, size):
    """Ширина строки с переключением шрифтов по алфавиту (латиница/кириллица)."""
    w = 0
    for ch in s:
        w += pick_font(ch, size).getlength(ch)
    return w


def draw_text(x, y, s, size, draw, fill, letter=0):
    """Рисует строку посегментно, возвращает фактическую ширину."""
    cx = x
    for ch in s:
        if ch == " ":
            cx += pick_font("a", size).getlength(" ") + letter
            continue
        f = pick_font(ch, size)
        draw.text((cx, y), ch, font=f, fill=fill)
        cx += f.getlength(ch) + letter
    return cx - x - (letter if s else 0)


def measure(s, size, letter=0):
    """Ширина строки без рисования."""
    w = 0
    for ch in s:
        w += pick_font(ch, size).getlength(ch) + letter
    return w - (letter if s else 0)


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient_text(x, y, s, size, colors):
    """Строка с горизонтальным градиентом: маска + заливка."""
    w = int(text_size(s, size)) + 8
    h = int(size * 1.35) + 8
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    draw_text(0, 0, s, size, d, 255)
    grad = Image.new("RGB", (w, h))
    gd = ImageDraw.Draw(grad)
    for i in range(w):
        t = i / max(1, w - 1)
        if t < 0.42:
            c = mix(colors[0], colors[1], t / 0.42)
        elif t < 0.78:
            c = mix(colors[1], colors[2], (t - 0.42) / 0.36)
        else:
            c = mix(colors[2], colors[3], (t - 0.78) / 0.22)
        gd.line([(i, 0), (i, h)], fill=c)
    return grad, mask, (int(x), int(y))


def fmt(n):
    return "{:,}".format(int(n)).replace(",", " ")


def plural(n, forms):
    n = abs(int(n)) % 100
    n1 = n % 10
    if 10 < n < 20:
        return forms[2]
    if 1 < n1 < 5:
        return forms[1]
    if n1 == 1:
        return forms[0]
    return forms[2]


# ---------------------------------------------------------------- данные

def load_data(path):
    s = io.open(path, encoding="utf-8").read()
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    return json.loads(s[s.index("{"):s.rindex("}") + 1])


# ---------------------------------------------------------------- рендер

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join(ROOT, "assets", "js", "data.js"))
    ap.add_argument("--out", default=os.path.join(ROOT, "assets", "img", "og.png"))
    a = ap.parse_args()

    D = load_data(a.data)
    load_display()

    img = Image.new("RGB", (W, H), BG)

    # цветные пятна на фоне
    blobs = [(0.08, -0.05, 0.75, C1, 72), (1.02, 0.10, 0.62, C2, 60),
             (0.55, 1.05, 0.55, C3, 42), (-0.02, 0.95, 0.60, C5, 46)]
    for fx, fy, fr, color, alpha in blobs:
        r = int(W * fr)
        grad = Image.radial_gradient("L").resize((r * 2, r * 2))
        grad = grad.point(lambda v: max(0, alpha - v * alpha // 210))
        tint = Image.new("RGB", grad.size, color)
        img.paste(tint, (int(W * fx - r), int(H * fy - r)), grad)

    d = ImageDraw.Draw(img)

    def hline(y):
        d.line([(M, y), (W - M, y)], fill=(48, 60, 80), width=1)

    # шапка
    draw_text(M, 48, "STEAM WRAPPED", 21, d, C4, letter=8)
    year = (D["meta"].get("generatedAt") or "")[:4]
    w = measure(year, 21, letter=6)
    draw_text(W - M - w, 48, year, 21, d, DIM, letter=6)
    hline(96)

    # ник + градиентная строка
    persona = D["meta"].get("persona") or "profile"
    draw_text(M, 122, persona, 84, d, INK, letter=1)
    grad, mask, pos = gradient_text(M, 234, "в цифрах", 84, [C1, C4, C2, C5])
    img.paste(grad, pos, mask)
    d = ImageDraw.Draw(img)
    hline(372)

    # три числа
    t = D["totals"]
    cols = [
        (fmt(t["gamesOwned"]),    plural(t["gamesOwned"], ["игра", "игры", "игр"]) + " в библиотеке", C1),
        (fmt(t["hoursTotal"]),    plural(t["hoursTotal"], ["час", "часа", "часов"]) + " всего", C4),
        (fmt(t["hoursTwoWeeks"]), "за две недели", C3),
    ]
    colw = (W - M * 2) / 3
    for i, (value, label, color) in enumerate(cols):
        cx = int(M + colw * i)
        d.rectangle([cx, 396, cx + 44, 401], fill=color)
        draw_text(cx, 418, value, 62, d, color)
        draw_text(cx, 502, label, 19, d, DIM)
    hline(538)

    # низ: топ-2 игры (колоссы) + стаж
    games = sorted(D["games"], key=lambda g: -g["hours"])
    x = M
    for g, color in zip(games[:2], [C1, C2]):
        d.rectangle([x, 558, x + 12, 570], fill=color)
        x += 24
        x += draw_text(x, 554, "%s · %s ч" % (g["name"], fmt(g["hours"])), 20, d, INK) + 28

    since = D["meta"].get("memberSince")
    if since:
        s = "в Steam с " + since[:4]
        w = measure(s, 19)
        draw_text(W - M - w, 555, s, 19, d, FAINT)

    # лёгкое зерно, чтобы градиенты не полосили.
    # маска = насколько виден сам рисунок: почти везде 255, и лишь
    # редкие точки чуть притемняются. Раньше здесь было наоборот
    # (10 вместо 245), из-за чего вся картинка уходила в чёрное.
    noise = Image.effect_noise((W, H), 22).convert("L")
    noise = noise.point(lambda v: 235 if v > 140 else 255)
    img = Image.composite(img, Image.new("RGB", (W, H), (3, 5, 9)), noise)

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    img.save(a.out, "PNG", optimize=True)
    print("✓ og-картинка: %s (%d×%d)" % (os.path.relpath(a.out, ROOT), W, H))


if __name__ == "__main__":
    main()
