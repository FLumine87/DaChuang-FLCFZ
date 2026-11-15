"""数据集下载器：统一走 HuggingFace 镜像，支持断点续传与校验。

为什么用镜像
------------
本机直连 huggingface.co 与 hf-mirror.com 的实测结果（2026-11-15）：

    git 直连 huggingface.co   → Could not connect to server（超时 32s）
    git 直连 hf-mirror.com    → 成功返回 HEAD

所以下载一律走 HF_ENDPOINT=https://hf-mirror.com。

清单
----
  avdd     AVDD-TCMI（华西医院面诊，中文，医生诊断标签，音+图）
           https://huggingface.co/datasets/Mar-rill/AVDD-TCMI-dataset
           14.5 GB，单个 zip
  edaic    E-DAIC（AVEC 2017，音+视频+转录，PHQ-8）
           https://huggingface.co/datasets/saeedzou/e-daic-ai-controlled
  daic     DAIC-WOZ（AVEC 2016，音+视频+转录，PHQ-8）
           https://huggingface.co/datasets/saeedzou/DAIC-WOZ

用法
----
    python scripts/download_datasets.py --dataset avdd
    python scripts/download_datasets.py --dataset avdd --limit 500   # 只下前 N 个文件
    python scripts/download_datasets.py --list
"""
import argparse
import json
import os
import sys
import time

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

MIRROR = os.environ.get("HF_ENDPOINT", "https://hf-mirror.com")

# 数据集根目录（与 DATASET_DIRS 的约定一致）
DATA_ROOT = r"D:\DaChuang\dataset\dataset"

DATASETS = {
    "avdd": {
        "repo_id": "Mar-rill/AVDD-TCMI-dataset",
        "local_dir": os.path.join(DATA_ROOT, "AVDD-TCMI"),
        "note": "华西医院面诊：音（1024维声学特征）+ TCM 面诊区域图 + 医生诊断标签",
        "priority": 1,
    },
    "edaic": {
        "repo_id": "saeedzou/e-daic-ai-controlled",
        "local_dir": os.path.join(DATA_ROOT, "E-DAIC"),
        "note": "AVEC 2017：访谈音频 mp3 + 转录文本 + OpenFace 视觉特征 + PHQ-8",
        "priority": 2,
    },
    "daic": {
        "repo_id": "saeedzou/DAIC-WOZ",
        "local_dir": os.path.join(DATA_ROOT, "DAIC-WOZ"),
        "note": "AVEC 2016：访谈音频 + 转录文本 + PHQ-8",
        "priority": 3,
    },
}


def _log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def list_remote(repo_id):
    """列出仓库文件（走镜像 API）。"""
    import urllib.request
    url = f"{MIRROR}/api/datasets/{repo_id}/tree/main?recursive=1"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    out = []
    for e in data:
        if e.get("type") != "file":
            continue
        sz = e.get("size") or (e.get("lfs") or {}).get("size") or 0
        out.append((e.get("path"), sz))
    return out


def download(repo_id, local_dir, limit=0, workers=4):
    """下载数据集（支持断点续传）。

    优先用 hf_transfer（Rust 多线程分片下载器）—— 14.5 GB 的 AVDD 用
    单连接只有 ~0.5 MB/s，实测 hf_transfer 能快数倍。装不上则退回原生实现。
    """
    from huggingface_hub import snapshot_download

    os.makedirs(local_dir, exist_ok=True)
    _log(f"仓库 {repo_id} → {local_dir}")
    _log(f"镜像 {MIRROR}")
    fast = False
    try:
        import hf_transfer  # noqa: F401
        os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "1")
        fast = True
        _log("使用 hf_transfer 多线程分片下载")
    except ImportError:
        _log("未装 hf_transfer，用原生下载（单连接，慢）")
    t0 = time.time()
    path = snapshot_download(
        repo_id=repo_id,
        repo_type="dataset",
        local_dir=local_dir,
        endpoint=MIRROR,
        max_workers=workers,
    )
    _log(f"完成，用时 {time.time() - t0:.0f}s（{'加速' if fast else '普通'}）→ {path}")
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default="avdd",
                    help="avdd / edaic / daic，或 all")
    ap.add_argument("--list", action="store_true", help="只列远程文件，不下载")
    ap.add_argument("--limit", type=int, default=0,
                    help="配合 --list：只看前 N 个文件")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    names = list(DATASETS) if args.dataset == "all" else [args.dataset]
    for name in names:
        if name not in DATASETS:
            print(f"未知数据集 {name}；可选：{list(DATASETS)}")
            sys.exit(1)
        cfg = DATASETS[name]
        print("=" * 68)
        print(f"[{name}] {cfg['repo_id']}")
        print(f"  {cfg['note']}")
        print(f"  目标目录 {cfg['local_dir']}")
        print("=" * 68)
        try:
            files = list_remote(cfg["repo_id"])
        except Exception as exc:
            _log(f"列文件失败：{type(exc).__name__} {exc}")
            continue
        total = sum(sz for _, sz in files)
        _log(f"远程 {len(files)} 个文件，合计 {total / 1e9:.2f} GB")
        shown = files[:args.limit] if args.limit else files[:20]
        for path, sz in shown:
            _log(f"    {path}  {sz / 1e6:.1f} MB")
        if args.list:
            if not args.limit and len(files) > 20:
                _log(f"    ... 还有 {len(files) - 20} 个")
            continue
        try:
            download(cfg["repo_id"], cfg["local_dir"], args.limit, args.workers)
        except Exception as exc:
            _log(f"下载失败：{type(exc).__name__} {exc}")


if __name__ == "__main__":
    main()
