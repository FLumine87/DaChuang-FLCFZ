"""多源并行分段下载：不同镜像各下一段，最后拼接。

为什么
------
hf-mirror.com 对大文件限速（实测单 IP 总带宽约 2 MB/s，8 线程也提不上去）。
但 aifasthub.com 是**另一台服务器**，两者的 ETag 与文件长度完全一致
（c3c40fd4e7575f86f2d1 / 14529499485）→ 可以各下一段，最后按偏移拼接。

实测其余候选：
  huggingface.co → 直连被挡（502）
  hf-mirror.com/lf → 404
  魔搭 ModelScope → 没有这个数据集

用法
----
    python scripts/avdd_multisrc.py --segments 16
    python scripts/avdd_multisrc.py --status
"""
import argparse
import os
import threading
import time
import urllib.request

MIRRORS = ["https://hf-mirror.com", "https://aifasthub.com"]
REPO = "Mar-rill/AVDD-TCMI-dataset"
FILENAME = "AVDD-TCMI-dataset.zip"
DEST = r"D:/DaChuang/dataset/dataset/AVDD-TCMI"
PARTS = os.path.join(DEST, ".parts2")
CHUNK = 1024 * 1024

_lock = threading.Lock()
_done = {}


def log(msg):
    with _lock:
        print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def head(host):
    url = f"{host}/datasets/{REPO}/resolve/main/{FILENAME}"
    req = urllib.request.Request(url, method="HEAD",
                                 headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(r.headers.get("Content-Length") or 0), \
            (r.headers.get("ETag") or "").strip('"')


def part_path(start, end):
    return os.path.join(PARTS, f"p{start}_{end}")


def fetch(mirror, start, end, retries=8):
    url = f"{mirror}/datasets/{REPO}/resolve/main/{FILENAME}"
    p = part_path(start, end)
    os.makedirs(PARTS, exist_ok=True)
    need = end - start + 1
    for attempt in range(1, retries + 1):
        have = os.path.getsize(p) if os.path.exists(p) else 0
        if have >= need:
            return True
        pos = start + have
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "Mozilla/5.0",
                              "Range": f"bytes={pos}-{end}"})
            with urllib.request.urlopen(req, timeout=90) as resp:
                if resp.getcode() not in (200, 206):
                    raise IOError(f"HTTP {resp.getcode()}")
                with open(p, "ab") as f:
                    while True:
                        b = resp.read(CHUNK)
                        if not b:
                            break
                        f.write(b)
        except Exception as exc:
            log(f"  [{mirror.split('//')[1][:12]}] 段 {start//1048576}-"
                f"{(end+1)//1048576}MB 第{attempt}次失败："
                f"{type(exc).__name__} {str(exc)[:50]}")
            time.sleep(min(2 * attempt, 12))
            continue
        have = os.path.getsize(p) if os.path.exists(p) else 0
        if have >= need:
            return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--segments", type=int, default=16)
    ap.add_argument("--status", action="store_true")
    args = ap.parse_args()

    total, etag = head(MIRRORS[0])
    log(f"目标 {total / 1e9:.2f} GB  etag {etag[:20]}")
    out = os.path.join(DEST, FILENAME)
    have = os.path.getsize(out) if os.path.exists(out) else 0
    log(f"已有前缀 {have / 1e9:.2f} GB，剩余 {(total - have) / 1e9:.2f} GB")
    if args.status:
        if os.path.isdir(PARTS):
            for fn in sorted(os.listdir(PARTS)):
                log(f"  {fn}: {os.path.getsize(os.path.join(PARTS, fn)) / 1e6:.0f} MB")
        return
    if have >= total:
        log("已完整")
        return

    remain = total - have
    size = remain // args.segments
    segs = []
    cur = have
    for i in range(args.segments):
        end = (cur + size - 1) if i < args.segments - 1 else total - 1
        segs.append((cur, end))
        cur = end + 1

    log(f"{len(segs)} 段，分配给 {len(MIRRORS)} 个源轮流下")
    t0 = time.time()
    threads = []
    for i, (s, e) in enumerate(segs):
        mirror = MIRRORS[i % len(MIRRORS)]
        t = threading.Thread(target=fetch, args=(mirror, s, e), daemon=True)
        t.start()
        threads.append(t)

    while any(t.is_alive() for t in threads):
        time.sleep(15)
        got = sum(os.path.getsize(os.path.join(PARTS, f))
                  for f in os.listdir(PARTS)) if os.path.isdir(PARTS) else 0
        log(f"  本轮已下 {got / 1e9:.2f} GB / 需 {(total - have) / 1e9:.2f} GB"
            f"   速度 {got / 1e6 / max(time.time() - t0, 1):.2f} MB/s")
    for t in threads:
        t.join()

    missing = [s for s, e in segs
               if not os.path.exists(part_path(s, e))
               or os.path.getsize(part_path(s, e)) != e - s + 1]
    if missing:
        log(f"✗ {len(missing)} 段不完整，重跑本脚本可续")
        return

    log("拼接中…")
    with open(out, "ab") as o:
        for s, e in segs:
            with open(part_path(s, e), "rb") as f:
                while True:
                    b = f.read(CHUNK * 8)
                    if not b:
                        break
                    o.write(b)
    sz = os.path.getsize(out)
    log(f"完成 {sz / 1e9:.2f} GB / {total / 1e9:.2f} GB  "
        f"{'✓ 一致' if sz == total else '✗ 不一致'}")
    for s, e in segs:
        try:
            os.remove(part_path(s, e))
        except OSError:
            pass


if __name__ == "__main__":
    main()
