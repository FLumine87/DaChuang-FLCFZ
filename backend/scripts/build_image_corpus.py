"""构建独立图像库：FER2013 全量特征抽取。

与主跨模态索引分开：主索引里的图像是按情绪弱配对挂到文本语音记录上的
1686 张，用于验证跨模态链路；这里是全量 35887 张，只服务"图像搜图像"。

特征沿用 `real_features.image_feature`（192 维手工描述子），与主索引一致。
写成 SQLite BLOB 而不是 JSON：35887 × 192 维用 JSON 约 55MB，二进制 27MB。

用法：
    python scripts/build_image_corpus.py              # 全量
    python scripts/build_image_corpus.py --limit 5000 # 冒烟
"""
import argparse
import array
import os
import sqlite3
import sys
import time

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.engines.hashing import real_features as RF  # noqa: E402
from app.engines.hashing.fer_encoder import get_encoder  # noqa: E402

DEFAULT_ROOT = r"D:\DaChuang\FER2013"
DEFAULT_OUT = os.path.join(BACKEND, "data", "hashing", "image_corpus.db")
SPLITS = ("train", "test")

SCHEMA = """
CREATE TABLE IF NOT EXISTS images (
    image_id TEXT PRIMARY KEY,
    path     TEXT NOT NULL,
    label    TEXT NOT NULL,
    split    TEXT NOT NULL,
    feature  BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_images_label ON images(label);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""


def _pack(vec):
    return array.array("f", [float(x) for x in vec]).tobytes()


def iter_images(root):
    for split in SPLITS:
        base = os.path.join(root, split)
        if not os.path.isdir(base):
            continue
        for label in sorted(os.listdir(base)):
            d = os.path.join(base, label)
            if not os.path.isdir(d):
                continue
            for fn in sorted(os.listdir(d)):
                if fn.lower().endswith(".jpg"):
                    yield split, label, os.path.join(d, fn), f"{split}-{label}-{fn[:-4]}"


def main():
    ap = argparse.ArgumentParser(description="构建全量图像特征库")
    ap.add_argument("--root", default=DEFAULT_ROOT)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--limit", type=int, default=0, help="最多处理多少张，0 表示全量")
    ap.add_argument("--resume", action="store_true", help="跳过已入库的图片")
    ap.add_argument("--feature", choices=("handcrafted", "cnn"), default="handcrafted",
                    help="handcrafted=192 维手工描述子；cnn=微调 MobileNet 的 1280 维")
    args = ap.parse_args()

    items = list(iter_images(args.root))
    if args.limit:
        items = items[: args.limit]
    print(f"待处理 {len(items)} 张")

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    conn = sqlite3.connect(args.out)
    conn.executescript(SCHEMA)
    done = set()
    if args.resume:
        done = {r[0] for r in conn.execute("SELECT image_id FROM images")}
        print(f"已存在 {len(done)} 条，将跳过")

    encoder = None
    if args.feature == "cnn":
        encoder = get_encoder()
        if encoder is None:
            raise SystemExit("CNN 特征不可用：请先导出 models/mobilenetv2-fer.onnx")
        print(f"使用 CNN 特征（{encoder.size}×{encoder.size} 输入）")

    t0 = time.time()
    batch, ok, fail = [], 0, 0
    for idx, (split, label, path, image_id) in enumerate(items, 1):
        if image_id in done:
            continue
        feat = encoder.feature(path) if encoder is not None else RF.image_feature(path)
        if not feat:
            fail += 1
            continue
        batch.append((image_id, path, label, split, _pack(feat)))
        ok += 1
        if len(batch) >= 500:
            conn.executemany(
                "INSERT OR REPLACE INTO images(image_id, path, label, split, feature) "
                "VALUES(?,?,?,?,?)", batch)
            conn.commit()
            batch.clear()
            rate = ok / max(1e-6, time.time() - t0)
            print(f"  {idx}/{len(items)}  {ok} 张  {rate:.0f} 张/秒", flush=True)
    if batch:
        conn.executemany(
            "INSERT OR REPLACE INTO images(image_id, path, label, split, feature) "
            "VALUES(?,?,?,?,?)", batch)
        conn.commit()

    conn.executemany("INSERT OR REPLACE INTO meta(key, value) VALUES(?,?)", [
        ("root", args.root), ("feature", args.feature),
        ("dim", str(len(get_encoder().feature(items[0][2]) or [])) if encoder is not None else "192"),
        ("count", str(conn.execute("SELECT COUNT(*) FROM images").fetchone()[0])),
        ("built_at", time.strftime("%Y-%m-%dT%H:%M:%S")),
    ])
    conn.commit()
    total = conn.execute("SELECT COUNT(*) FROM images").fetchone()[0]
    print(f"完成：入库 {total} 张，失败 {fail}，耗时 {time.time() - t0:.1f}s")
    print(f"文件 {args.out}  {os.path.getsize(args.out) / 1024 / 1024:.1f} MB")
    conn.close()


if __name__ == "__main__":
    main()
