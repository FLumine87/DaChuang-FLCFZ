"""从不完整的 zip 里提取「数据已完整到达」的条目。

背景
----
AVDD-TCMI 是单个 14.5 GB 的 zip，下载要很久（hf-mirror 对大文件限速，
单 IP 总带宽约 2 MB/s）。但 zip 是**顺序存储**的 —— 文件在压缩包里按顺序
排列，已经下载的那一段里，**排在前面且数据完整的文件是可以提取的**。

zip 的结构：
    [Local File Header][文件数据][可选的数据描述符] ... [中央目录][EOCD]
中央目录在文件末尾，所以标准 zipfile 打不开不完整的包。
但 Local File Header 在每个文件数据**前面**，扫一遍就能定位所有条目。

本脚本
------
扫描所有 Local File Header，对「压缩数据范围完全落在已下载字节内」的条目
做解压提取；不完整的跳过。最后报告提取了多少、缺什么。

用法
----
    python scripts/extract_partial_zip.py --zip <path> --out <dir>
"""
import argparse
import os
import struct
import sys
import time
import zlib

SIG_LFH = b"PK\x03\x04"
CHUNK = 8 * 1024 * 1024


def scan_entries(path):
    """扫描所有本地文件头，返回 (offset, name, method, comp_size, uncomp_size,
    crc, data_start, has_descriptor)。"""
    size = os.path.getsize(path)
    entries = []
    with open(path, "rb") as f:
        pos = 0
        tail = b""
        while pos < size:
            f.seek(pos)
            buf = f.read(CHUNK)
            if not buf:
                break
            data = tail + buf
            base = pos - len(tail)
            i = 0
            while True:
                j = data.find(SIG_LFH, i)
                if j < 0:
                    break
                if j + 30 > len(data):
                    break
                try:
                    (_ver, _flag, method, _mt, _md, crc, csize, usize,
                     nlen, elen) = struct.unpack("<HHHHHIIIHH", data[j + 4:j + 30])
                    if 0 < nlen < 512 and j + 30 + nlen <= len(data):
                        name = data[j + 30:j + 30 + nlen].decode("utf-8", "replace")
                        entries.append({
                            "offset": base + j,
                            "name": name,
                            "method": method,
                            "csize": csize,
                            "usize": usize,
                            "crc": crc,
                            "data_start": base + j + 30 + nlen + elen,
                            "has_descriptor": bool(_flag & 0x08),
                            "flag": _flag,
                        })
                except Exception:
                    pass
                i = j + 4
            tail = data[-1024:]
            pos += CHUNK
    return entries, size


def extract_one(f, entry, out_root, downloaded):
    """提取单个条目；数据不完整返回 False。"""
    ds = entry["data_start"]
    csize = entry["csize"]
    if entry["has_descriptor"] or csize == 0xFFFFFFFF:
        # 数据描述符在数据之后，压缩大小未知 → 无法确认完整性，跳过
        return False, "descriptor"
    if ds + csize > downloaded:
        return False, "incomplete"
    name = entry["name"]
    if name.endswith("/"):
        return False, "dir"
    out_path = os.path.join(out_root, name.replace("/", os.sep))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    try:
        f.seek(ds)
        remaining = csize
        method = entry["method"]
        if method == 0:
            with open(out_path, "wb") as o:
                while remaining > 0:
                    b = f.read(min(CHUNK, remaining))
                    if not b:
                        break
                    o.write(b)
                    remaining -= len(b)
        elif method == 8:
            d = zlib.decompressobj(-15)
            with open(out_path, "wb") as o:
                while remaining > 0:
                    b = f.read(min(CHUNK, remaining))
                    if not b:
                        break
                    o.write(d.decompress(b))
                    remaining -= len(b)
                o.write(d.flush())
        else:
            return False, f"method{method}"
        return True, "ok"
    except Exception as exc:
        try:
            os.remove(out_path)
        except OSError:
            pass
        return False, type(exc).__name__


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0,
                    help="只提取前 N 个（调试用）")
    args = ap.parse_args()

    t0 = time.time()
    print("扫描本地文件头…", flush=True)
    entries, size = scan_entries(args.zip)
    print(f"  条目 {len(entries)} 个，扫描用时 {time.time() - t0:.0f}s")

    ok = skip_incomplete = skip_other = 0
    subs = {}
    with open(args.zip, "rb") as f:
        for n, e in enumerate(entries, 1):
            if args.limit and ok >= args.limit:
                break
            good, why = extract_one(f, e, args.out, size)
            if good:
                ok += 1
                key = "/".join(e["name"].split("/")[:2])
                subs[key] = subs.get(key, 0) + 1
            elif why == "incomplete":
                skip_incomplete += 1
            else:
                skip_other += 1
            if n % 5000 == 0:
                print(f"  处理 {n}/{len(entries)}  已提取 {ok}", flush=True)

    print()
    print(f"提取成功 {ok}   数据不完整跳过 {skip_incomplete}   其他跳过 {skip_other}")
    print("按目录:")
    for k, v in sorted(subs.items(), key=lambda x: -x[1]):
        print(f"  {k:<34} {v} 个文件")
    print(f"用时 {time.time() - t0:.0f}s → {args.out}")


if __name__ == "__main__":
    main()
