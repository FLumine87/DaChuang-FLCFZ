"""获取 bge 文本编码模型（下载 PyTorch 权重并导出 ONNX）。

模型 91MB，不随仓库分发。clone 后首次使用前跑一次即可：

    python scripts/fetch_bge_model.py

流程分两步：从 ModelScope 拉取 BAAI/bge-small-zh-v1.5 的权重与分词器
（约 92MB），再调 export_bge_onnx.py 导出成推理用的 ONNX。

导出需要 torch + transformers，项目 venv 是 Python 3.14 装不了这些，
所以脚本会自动寻找 WorkBuddy 的 3.13 环境；找不到时提示用 --export-python
指定一个带 torch 的解释器，或者在有 torch 的环境里手工跑 export_bge_onnx.py。

已存在 ONNX 时默认跳过，加 --force 重新下载导出。
"""
import argparse
import os
import subprocess
import sys
import urllib.request

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR = os.path.join(BACKEND, "models", "bge-small-zh")
ONNX_PATH = os.path.join(BACKEND, "models", "bge-small-zh.onnx")

REPO = "AI-ModelScope/bge-small-zh-v1.5"
BASE = f"https://modelscope.cn/api/v1/models/{REPO}/repo?Revision=master&FilePath="
FILES = [
    "config.json", "pytorch_model.bin", "tokenizer.json",
    "vocab.txt", "tokenizer_config.json", "special_tokens_map.json",
]
CANDIDATE_PYTHONS = [
    r"C:\Users\26357\.workbuddy\binaries\python\envs\default\Scripts\python.exe",
]


def download(force=False):
    os.makedirs(MODEL_DIR, exist_ok=True)
    for name in FILES:
        dst = os.path.join(MODEL_DIR, name)
        if os.path.exists(dst) and os.path.getsize(dst) > 0 and not force:
            print(f"  跳过 {name}（已存在 {os.path.getsize(dst) / 1e6:.1f}MB）")
            continue
        url = BASE + name
        print(f"  下载 {name} ...", flush=True)
        tmp = dst + ".part"
        with urllib.request.urlopen(url, timeout=600) as resp, open(tmp, "wb") as f:
            while True:
                chunk = resp.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
        os.replace(tmp, dst)
        print(f"    {os.path.getsize(dst) / 1e6:.1f}MB")


def find_python(explicit=""):
    if explicit:
        return explicit
    for cand in CANDIDATE_PYTHONS:
        if os.path.exists(cand):
            try:
                out = subprocess.run(
                    [cand, "-c", "import torch, transformers; print('ok')"],
                    capture_output=True, text=True, timeout=120)
                if "ok" in out.stdout:
                    return cand
            except Exception:
                continue
    return sys.executable


def export(python):
    script = os.path.join(BACKEND, "scripts", "export_bge_onnx.py")
    print(f"导出 ONNX（使用 {python}）...")
    res = subprocess.run([python, script], capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stdout[-800:])
        print(res.stderr[-800:])
        raise SystemExit(
            "导出失败。请在有 torch 与 transformers 的环境里执行 "
            f"`{python} scripts/export_bge_onnx.py`，或用 --export-python 指定解释器。")


def main():
    ap = argparse.ArgumentParser(description="下载并导出 bge 文本编码模型")
    ap.add_argument("--force", action="store_true", help="重新下载并覆盖已有文件")
    ap.add_argument("--export-python", default="", help="带 torch 的 Python 解释器路径")
    ap.add_argument("--download-only", action="store_true", help="只下载权重，不导出")
    args = ap.parse_args()

    if os.path.exists(ONNX_PATH) and not args.force:
        size = os.path.getsize(ONNX_PATH) / 1e6
        print(f"ONNX 已存在（{size:.1f}MB）：{ONNX_PATH}")
        print("需要重建请加 --force")
        return

    print("第 1 步：下载权重")
    download(force=args.force)
    if args.download_only:
        print("已下载，未导出。")
        return

    print("第 2 步：导出 ONNX")
    export(find_python(args.export_python))
    if os.path.exists(ONNX_PATH):
        print(f"完成：{ONNX_PATH}  {os.path.getsize(ONNX_PATH) / 1e6:.1f}MB")
    else:
        raise SystemExit("导出后仍未找到 ONNX 文件，请检查上方日志。")


if __name__ == "__main__":
    main()
