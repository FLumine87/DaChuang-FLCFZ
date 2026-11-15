"""AVDD-TCMI 断点续传（绕开 huggingface_hub 的缓存哈希漂移）。

问题
----
huggingface_hub 用「URL + 参数」的哈希给缓存文件命名。改一次下载脚本
（哪怕只改一个无关参数）哈希就变 → 之前下的几个 GB 成了孤儿缓存，
下次从头开始。本机已经因此损失过 3.55 GB + 1.6 GB。

对策
----
原生模式下的 `<hash>.incomplete` 是**顺序追加**的，所以它就是目标文件的
有效前缀。用 HTTP Range 请求从该偏移继续，直接追加到最终文件，
与 huggingface_hub 的缓存机制解耦。

用法
----
    python scripts/avdd_resume.py                 # 自动找最大的 .incomplete 续传
    python scripts/avdd_resume.py --offset 3553585698
"""
import argparse
import hashlib
import os
import sys
import time
import urllib.request

MIRROR = os.environ.get("HF_ENDPOINT", "https://hf-mirror.com")
REPO = "Mar-rill/AVDD-TCMI-dataset"
FILENAME = "AVDD-TCMI-dataset.zip"
URL = f"{MIRROR}/datasets/{REPO}/resolve/main/{FILENAME}"
DEST = r"D:\DaChuang\dataset\dataset\AVDD-TCMI"
CACHE = os.path.join(DEST, ".cache", "huggingface", "download")
CHUNK = 4 * 1024 * 1024


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def head_info():
    """问服务器要文件总长与 etag。"""
    req = urllib.request.Request(URL, method="HEAD",
                                 headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(r.headers.get("Content-Length") or 0), \
            (r.headers.get("ETag") or "").strip('"')


def largest_incomplete():
    """最大的 .incomplete（原生模式的是顺序追加的有效前缀）。"""
    if not os.path.isdir(CACHE):
        return None, 0
    best, best_sz = None, 0
    for fn in os.listdir(CACHE):
        if not fn.endswith(".incomplete"):
            continue
        p = os.path.join(CACHE, fn)
        try:
            sz = os.path.getsize(p)
        except OSError:
            continue
        if sz > best_sz:
            best, best_sz = p, sz
    return best, best_sz


def resume(offset):
    total, etag = head_info()
    log(f"目标大小 {total / 1e9:.2f} GB   etag {etag[:16]}")
    if total and offset >= total:
        log("已完成，无需续传")
        return True

    out = os.path.join(DEST, FILENAME)
    os.makedirs(DEST, exist_ok=True)
    # 先把已有的 incomplete 内容搬到最终文件
    if offset and os.path.exists(out):
        log("最终文件已存在且有内容，从它的长度继续")
        offset = os.path.getsize(out)
    elif offset:
        src, _ = largest_incomplete()
        if src and os.path.getsize(src) == offset:
            log(f"复用缓存分片 {os.path.basename(src)[:40]} → {offset / 1e9:.2f} GB")
            with open(src, "rb") as f, open(out, "wb") as g:
                while True:
                    b = f.read(CHUNK)
                    if not b:
                        break
                    g.write(b)
        elif os.path.exists(out):
            offset = os.path.getsize(out)
        else:
            offset = 0

    headers = {"User-Agent": "Mozilla/5.0"}
    if offset:
        headers["Range"] = f"bytes={offset}-"
    req = urllib.request.Request(URL, headers=headers)
    t0 = time.time()
    got = offset
    with urllib.request.urlopen(req, timeout=120) as resp:
        mode = "ab" if offset else "wb"
        code = resp.getcode()
        log(f"HTTP {code}，{'追加' if offset else '新建'}写入 {out}")
        if offset and code != 206:
            log(f"服务器不支持 Range（HTTP {code}），从头重下")
            got = 0
            mode = "wb"
        with open(out, mode) as f:
            while True:
                b = resp.read(CHUNK)
                if not b:
                    break
                f.write(b)
                got += len(b)
                if got % (256 * 1024 * 1024) < CHUNK:
                    sp = (got - offset) / max(time.time() - t0, 1)
                    pct = got * 100 / total if total else 0
                    log(f"  {got / 1e9:.2f} GB ({pct:.1f}%)  {sp / 1e6:.2f} MB/s")
    log(f"完成：{got / 1e9:.2f} GB，用时 {time.time() - t0:.0f}s")
    return True


def verify(path):
    """校验大小；可选算 md5（14.5GB 会慢）。"""
    total, etag = head_info()
    sz = os.path.getsize(path)
    log(f"本地 {sz / 1e9:.2f} GB / 远端 {total / 1e9:.2f} GB")
    if total and sz != total:
        log("大小不一致 ✗")
        return False
    log("大小一致 ✓")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--rounds", type=int, default=40,
                    help="最多续传多少轮（每轮读满 4GB 或遇到错误即止）")
    args = ap.parse_args()
    offset = args.offset
    if not offset:
        src, sz = largest_incomplete()
        if src:
            log(f"最大缓存分片：{os.path.basename(src)[:40]}  {sz / 1e9:.2f} GB")
            offset = sz
    out = os.path.join(DEST, FILENAME)
    if os.path.exists(out):
        sz = os.path.getsize(out)
        if sz > offset:
            offset = sz
    for rnd in range(args.rounds):
        try:
            resume(offset)
        except Exception as exc:
            log(f"第 {rnd + 1} 轮失败：{type(exc).__name__} {exc}")
            time.sleep(5)
            continue
        out_sz = os.path.getsize(out) if os.path.exists(out) else 0
        total_now, _ = head_info()
        if total_now and out_sz >= total_now:
            log(f"全部完成：{out_sz / 1e9:.2f} GB")
            break
        if out_sz <= offset:
            log("本轮没有进展，停止")
            break
        offset = out_sz
        log(f"第 {rnd + 1} 轮结束，已 {offset / 1e9:.2f} GB，继续")
    if os.path.exists(out):
        verify(out)


if __name__ == "__main__":
    main()
