"""在 FER2013 上微调 MobileNetV2，导出 1280 维表情特征模型。

为什么必须微调：ImageNet 预训练特征对表情没有区分力（实测 top-10 同类率
0.207，随机 0.143）。冻结特征接线性头只能重新加权，无法创造"嘴角弧度"这类
新特征；微调会改写卷积核本身，这是唯一有效路径。

产出：
  models/fer_mobilenet.pth    训练权重
  models/mobilenetv2-fer.onnx 去掉分类头的特征模型（输出 1280 维）

用法：
    python scripts/finetune_fer.py --epochs 5
    python scripts/finetune_fer.py --epochs 1 --limit 2000   # 冒烟
"""
import argparse
import os
import sqlite3
import sys
import time

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

LABELS = ["angry", "disgust", "fear", "happy", "neutral", "sad", "surprise"]
CORPUS = os.path.join(BACKEND, "data", "hashing", "image_corpus.db")


def build_datasets(limit=0, size=160):
    import torch
    from PIL import Image
    from torch.utils.data import Dataset

    class FerDataset(Dataset):
        def __init__(self, rows, train):
            self.rows = rows
            self.train = train

        def __len__(self):
            return len(self.rows)

        def __getitem__(self, idx):
            path, label = self.rows[idx]
            im = Image.open(path).convert("RGB")
            if self.train:
                im = im.resize((size + 16, size + 16), Image.BILINEAR)
                # 随机裁剪 + 水平翻转：FER 是野外抓取，姿态差异大
                import random
                x = random.randint(0, 16)
                y = random.randint(0, 16)
                im = im.crop((x, y, x + size, y + size))
                if random.random() < 0.5:
                    im = im.transpose(Image.FLIP_LEFT_RIGHT)
            else:
                im = im.resize((size, size), Image.BILINEAR)
            import numpy as np
            arr = np.asarray(im, dtype=np.float32) / 255.0
            # 必须用 float32 常量做归一化，否则 numpy 提升成 float64，
            # 送进卷积层会报 expected Double but found Float
            mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
            std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
            arr = (arr - mean) / std
            return torch.from_numpy(arr.transpose(2, 0, 1)), torch.tensor(
                LABELS.index(label), dtype=torch.long)

    conn = sqlite3.connect(CORPUS)
    if limit:
        # 限流时按类别分层取：直接切前 N 条会全落在 angry 上，
        # 训练集与验证集同类别，准确率会虚高到 1.0
        per_train = max(1, limit // len(LABELS))
        per_test = max(20, per_train // 6)
        train_rows, test_rows = [], []
        for lab in LABELS:
            train_rows += conn.execute(
                "SELECT path, label FROM images WHERE split='train' AND label=? "
                "ORDER BY RANDOM() LIMIT ?", (lab, per_train)).fetchall()
            test_rows += conn.execute(
                "SELECT path, label FROM images WHERE split='test' AND label=? "
                "ORDER BY RANDOM() LIMIT ?", (lab, min(per_test, 200))).fetchall()
    else:
        train_rows = conn.execute("SELECT path, label FROM images WHERE split='train'").fetchall()
        test_rows = conn.execute("SELECT path, label FROM images WHERE split='test'").fetchall()
    conn.close()
    return FerDataset(train_rows, True), FerDataset(test_rows, False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=5)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--threads", type=int, default=8)
    # FER 原图只有 48×48，放大到 224 是插值浪费；160 在精度与速度间更划算
    ap.add_argument("--size", type=int, default=160)
    args = ap.parse_args()

    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader
    from torchvision import models

    torch.set_num_threads(max(1, args.threads))
    device = torch.device("cpu")

    train_ds, test_ds = build_datasets(args.limit, args.size)
    print(f"训练 {len(train_ds)} 张，验证 {len(test_ds)} 张", flush=True)
    train_dl = DataLoader(train_ds, batch_size=args.batch, shuffle=True, num_workers=0)
    test_dl = DataLoader(test_ds, batch_size=args.batch, shuffle=False)

    model = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.IMAGENET1K_V1)
    model.classifier[-1] = nn.Linear(model.last_channel, len(LABELS))
    model.to(device)

    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)
    lossf = nn.CrossEntropyLoss()

    best = 0.0
    for ep in range(args.epochs):
        model.train()
        t0 = time.time()
        total = 0
        correct = 0
        run_loss = 0.0
        for i, (x, y) in enumerate(train_dl, 1):
            x, y = x.to(device), y.to(device)
            opt.zero_grad()
            out = model(x)
            loss = lossf(out, y)
            loss.backward()
            opt.step()
            run_loss += loss.item()
            correct += (out.argmax(1) == y).sum().item()
            total += y.size(0)
            if i % 100 == 0:
                print(f"  ep{ep+1} {i}/{len(train_dl)} loss {run_loss/i:.3f} "
                      f"acc {correct/total:.3f} {time.time()-t0:.0f}s", flush=True)
        sched.step()

        model.eval()
        vc = vt = 0
        with torch.no_grad():
            for x, y in test_dl:
                out = model(x)
                vc += (out.argmax(1) == y).sum().item()
                vt += y.size(0)
        acc = vc / max(1, vt)
        print(f"[epoch {ep+1}] loss {run_loss/len(train_dl):.3f} "
              f"train_acc {correct/total:.3f} val_acc {acc:.3f} "
              f"{time.time()-t0:.0f}s", flush=True)
        if acc > best:
            best = acc
            os.makedirs(os.path.join(BACKEND, "models"), exist_ok=True)
            torch.save(model.state_dict(), os.path.join(BACKEND, "models", "fer_mobilenet.pth"))
            print(f"  保存权重（val_acc {acc:.3f}）", flush=True)

    print(f"最佳验证准确率 {best:.3f}")


if __name__ == "__main__":
    main()
