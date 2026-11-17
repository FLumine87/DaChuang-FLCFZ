"""AVDD-TCMI 并行分段下载器。

为什么不用普通方式
------------------
AVDD-TCMI 是**单个 14.5 GB 的 zip**（不是几千个小文件）。
单连接长连接会被 CDN 掐断，而且「读完 4 GB 就重开一次 Range」的策略
每次重连都可能失败 —— 今天反复出现「卡住不动」就是这个原因。

策略
----
把剩余区间切成 N 段，每段一个线程、一个独立临时文件：
  · 单段失败只重试那一段，不影响其他段
  · 多连接同时跑，能把带宽跑满（单连接时服务端限速明显）
最后按偏移顺序拼接成一个文件。

用法
----
    python scripts/avdd_parallel.py                 # 自动算剩余段
    python scripts/avdd_parallel.py --segments 12
    python scripts/avdd_parallel.py --status        # 只看进度
"""
import argparse
import os
import sys
import threading
import time
import urllib.request

MIRROR = os.environ.get("HF_ENDPOINT", "https://hf-mirror.com")
REPO = "Mar-rill/AVDD-TCMI-dataset"
FILENAME = "AVDD-TCMI-dataset.zip"
URL = f"{MIRROR}/datasets/{REPO}/resolve/main/{FILENAME}"
DEST = r"D:\DaChuang\dataset\dataset\AVDD-TCMI"
FINAL = os.path.join(DEST, FILENAME)
PARTS = os.path.join(DEST, ".parts")
CHUNK = 1024 * 1024

_print_lock = threading.Lock()


def log(msg):
    with _print_lock:
        print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def head_info():
    req = urllib.request.Request(URL, method="HEAD",
                                 headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(r.headers.get("Content-Length") or 0), \
            (r.headers.get("ETag") or "").strip('"')


def part_path(start, end):
    return os.path.join(PARTS, f"p_{start}_{end}")


def fetch_part(start, end, retries=6):
    """下载 [start, end] 区间到临时文件，支持断点续传（按已有字节续）。"""
    p = part_path(start, end)
    os.makedirs(PARTS, exist_ok=True)
    for attempt in range(1, retries + 1):
        have = os.path.getsize(p) if os.path.exists(p) else 0
        need = end - start + 1
        if have >= need:
            return True
        pos = start + have
        headers = {"User-Agent": "Mozilla/5.0", "Range": f"bytes={pos}-{end}"}
        try:
            req = urllib.request.Request(URL, headers=headers)
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
            log(f"  段 [{start//1048576}MB-{(end+1)//1048576}MB] 第 {attempt} 次失败："
                f"{type(exc).__name__} {str(exc)[:60]}")
            time.sleep(min(3 * attempt, 15))
            continue
        have = os.path.getsize(p) if os.path.exists(p) else 0
        if have >= need:
            return True
    return False


def plan(total, start_at, segments):
    """把 [start_at, total-1] 切成 segments 段。"""
    remain = total - start_at
    if remain <= 0:
        return []
    size = remain // segments
    segs = []
    cur = start_at
    for i in range(segments):
        end = (cur + size - 1) if i < segments - 1 else total - 1
        segs.append((cur, end))
        cur = end + 1
    return segs


def status(total, start_at):
    have = os.path.getsize(FINAL) if os.path.exists(FINAL) else 0
    log(f"主文件 {have / 1e9:.2f} GB / {total / 1e9:.2f} GB "
        f"({have * 100 / total:.1f}%)")
    if os.path.isdir(PARTS):
        for fn in sorted(os.listdir(PARTS)):
            p = os.path.join(PARTS, fn)
            log(f"  分段 {fn}: {os.path.getsize(p) / 1e9:.3f} GB")
    return have


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--segments", type=int, default=10)
    ap.add_argument("--status", action="store_true")
    args = ap.parse_args()

    total, etag = head_info()
    log(f"远端 {total / 1e9:.2f} GB   etag {etag[:16]}")

    have = os.path.getsize(FINAL) if os.path.exists(FINAL) else 0
    if args.status:
        status(total, have)
        return
    if have >= total:
        log("已完整")
        return

    segs = plan(total, have, args.segments)
    log(f"已有前缀 {have / 1e9:.2f} GB，剩余 {total - have} 分 {len(segs)} 段并行")
    t0 = time.time()
    threads = []
    for s, e in segs:
        t = threading.Thread(target=fetch_part, args=(s, e), daemon=True)
        t.start()
        threads.append(t)

    last = have
    while any(t.is_alive() for t in threads):
        time.sleep(10)
        cur = os.path.getsize(FINAL) if os.path.exists(FINAL) else have
        cur += sum(os.path.getsize(os.path.join(PARTS, f))
                   for f in os.listdir(PARTS)
                   if os.path.exists(os.path.join(PARTS, f))) \
            if os.path.isdir(PARTS) else 0
        sp = (cur - last) / max(time.time() - t0, 1) if False else None
        log(f"  已下 {(cur) / 1e9:.2f} GB / {total / 1e9:.2f} GB "
            f"({cur * 100 / total:.1f}%)")
        last = cur

    for t in threads:
        t.join()

    # 校验每段是否完整
    missing = [s for s, e in segs
               if not os.path.exists(part_path(s, e))
               or os.path.getsize(part_path(s, e)) != e - s + 1]
    if missing:
        log(f"✗ 有 {len(missing)} 段不完整，需重跑")
        return

    # 拼接
    log("拼接中…")
    with open(FINAL, "ab") as out:
        for s, e in segs:
            with open(part_path(s, e), "rb") as f:
                while True:
                    b = f.read(CHUNK * 8)
                    if not b:
                        break
                    out.write(b)
    final_size = os.path.getsize(FINAL)
    log(f"完成：{final_size / 1e9:.2f} GB / {total / 1e9:.2f} GB  "
        f"{'✓ 一致' if final_size == total else '✗ 不一致'}")
    for s, e in segs:
        try:
            os.remove(part_path(s, e))
        except OSError:
            pass


if __name__ == "__main__":
    main()
