#!/usr/bin/env python3
"""生成 App 图标与启动图源图（resources/icon.png、resources/splash.png）。

图形：绿色渐变底 + 白色爱心 + 心电脉冲线（纯几何，无字体依赖）。
"""
import math
import os

from PIL import Image, ImageChops, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'resources')
os.makedirs(OUT, exist_ok=True)

SS = 3  # 超采样倍数

TOP = (16, 185, 129)     # emerald-500
BOTTOM = (4, 120, 87)    # emerald-700
WHITE = (255, 255, 255, 255)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient_bg(size, radius_ratio=0.0):
    img = Image.new('RGB', (size, size), TOP)
    px = img.load()
    for y in range(size):
        c = lerp(TOP, BOTTOM, y / max(1, size - 1))
        row = [c] * size
        for x in range(size):
            px[x, y] = row[x]
    if radius_ratio > 0:
        mask = Image.new('L', (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255
        )
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        return out
    return img.convert('RGBA')


def heart_points(cx, cy, size, steps=2400):
    pts = []
    for i in range(steps + 1):
        t = i / steps * 2 * math.pi
        x = 16 * math.sin(t) ** 3
        y = (13 * math.cos(t) - 5 * math.cos(2 * t)
             - 2 * math.cos(3 * t) - math.cos(4 * t))
        pts.append((cx + x * size / 32.0, cy - y * size / 32.0))
    return pts


def pulse_points(cx, cy, width, amp):
    return [
        (cx - width / 2, cy),
        (cx - width * 0.22, cy),
        (cx - width * 0.14, cy - amp * 0.55),
        (cx - width * 0.06, cy + amp),
        (cx + width * 0.02, cy - amp * 1.25),
        (cx + width * 0.11, cy + amp * 0.35),
        (cx + width * 0.20, cy),
        (cx + width / 2, cy),
    ]


def compose(S, heart_size, heart_cy, pulse_cy, pulse_w, pulse_amp, pulse_lw, bg):
    """白心 + 用底色"刻"出脉冲线，并与底色合成"""
    heart = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(heart).polygon(heart_points(S / 2, heart_cy, heart_size), fill=WHITE)

    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).line(
        pulse_points(S / 2, pulse_cy, pulse_w, pulse_amp), fill=255, width=pulse_lw, joint='curve'
    )
    # 只在爱心的范围内刻线，避免脉冲线溢出到爱心之外
    mask = ImageChops.multiply(mask, heart.split()[3])

    carved = Image.composite(bg, heart, mask)
    return Image.alpha_composite(bg, carved)


def make_icon(size=1024):
    S = size * SS
    bg = gradient_bg(S, radius_ratio=0.22)
    out = compose(S, S * 0.66, S * 0.47, S * 0.455, S * 0.52, S * 0.075, int(S * 0.030), bg)
    return out.resize((size, size), Image.LANCZOS)


def make_splash(size=2732):
    S = size
    bg = gradient_bg(S)
    mark = S * 0.30
    out = compose(S, mark, S * 0.5, S * 0.494, mark * 0.80, mark * 0.115, max(3, int(S * 0.006)), bg)
    return out.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    make_icon(1024).save(os.path.join(OUT, 'icon.png'))
    splash = make_splash(2732)
    splash.save(os.path.join(OUT, 'splash.png'))
    splash.save(os.path.join(OUT, 'splash-dark.png'))
    print('生成完成:', sorted(os.listdir(OUT)))
