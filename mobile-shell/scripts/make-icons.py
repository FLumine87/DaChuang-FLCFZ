#!/usr/bin/env python3
"""用品牌标志生成安卓启动图标（PNG 栅格，覆盖各密度）。

品牌标志取自 frontend/public/favicon.svg —— 顶栏左上角那个：
    圆角方块 #465FFF + 白色心电波（viewBox 40×40）

为什么要 PNG 而不只写矢量：
  · 自适应图标（mipmap-anydpi-v26，API 26+）用矢量就够；
  · 但 minSdk 23~25 的设备读不到 anydpi-v26，需要 mipmap-*dpi 下的位图兜底；
  · 而且位图能同时产出圆形版本（ic_launcher_round）与各密度，
    观感在任何机型上都一致。

输出：
    mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png        48/72/96/144/192
    mipmap-{...}/ic_launcher_round.png                             同上，圆形裁切
"""
from pathlib import Path

from PIL import Image, ImageDraw

BRAND = (0x46, 0x5F, 0xFF)          # --color-primary-500，与 favicon.svg 一致
DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

# favicon.svg 里的心电波：M8 21h7l4-11 5 21 3-10h5（viewBox 40×40）
PULSE = [(8, 21), (15, 21), (19, 10), (24, 31), (27, 21), (32, 21)]

RES = Path(__file__).resolve().parents[1] / "android/app/src/main/res"


def draw_icon(size: int, round_icon: bool) -> Image.Image:
    """按目标尺寸绘制图标。用 4 倍超采样再缩小，边缘才不毛糙。"""
    ss = 4
    s = size * ss

    if round_icon:
        base = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        ImageDraw.Draw(base).ellipse((0, 0, s - 1, s - 1), fill=BRAND + (255,))
    else:
        base = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        # 圆角比例与 favicon 一致：rx 11 / 40 ≈ 27.5%
        ImageDraw.Draw(base).rounded_rectangle(
            (0, 0, s - 1, s - 1), radius=int(s * 11 / 40), fill=BRAND + (255,)
        )

    # 心电波：按 viewBox 40×40 等比映射到画布
    k = s / 40
    d = ImageDraw.Draw(base)
    pts = [(x * k, y * k) for x, y in PULSE]
    d.line(pts, fill=(255, 255, 255, 255), width=max(1, int(round(2.6 * k))), joint="curve")
    # 线端补圆点，模拟 stroke-linecap: round
    r = max(1, int(round(2.6 * k / 2)))
    for p in (pts[0], pts[-1]):
        d.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=(255, 255, 255, 255))

    return base.resize((size, size), Image.LANCZOS)


def main() -> None:
    made = []
    for name, size in DENSITIES.items():
        out_dir = RES / f"mipmap-{name}"
        out_dir.mkdir(parents=True, exist_ok=True)
        for fname, is_round in (("ic_launcher.png", False), ("ic_launcher_round.png", True)):
            draw_icon(size, is_round).save(out_dir / fname)
            made.append(f"mipmap-{name}/{fname} ({size}px)")
    print(f"已生成 {len(made)} 个图标文件：")
    for m in made:
        print("  ", m)


if __name__ == "__main__":
    main()
