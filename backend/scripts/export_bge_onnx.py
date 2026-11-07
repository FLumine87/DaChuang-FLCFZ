"""把 bge-small-zh 导出成 ONNX 句向量模型。

BGE 的用法是取 [CLS] 位置的隐状态再做 L2 归一化。为了让推理端只需
onnxruntime 而不带 transformers，池化与归一化都固化在图里：输入
input_ids + attention_mask，输出已归一化的 512 维句向量。

分词仍由 Python 侧的 tokenizers 完成（项目 venv 已装 0.23.3）。

用法（需要 torch + transformers，走 3.13 环境）：
    python scripts/export_bge_onnx.py
"""
import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

SRC = os.path.join(BACKEND, "models", "bge-small-zh")
OUT = os.path.join(BACKEND, "models", "bge-small-zh.onnx")


def main():
    import torch
    import torch.nn as nn
    from transformers import AutoModel, AutoTokenizer

    if not os.path.isdir(SRC):
        raise SystemExit(f"未找到模型目录：{SRC}")

    tokenizer = AutoTokenizer.from_pretrained(SRC)
    model = AutoModel.from_pretrained(SRC).eval()

    class Enc(nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, input_ids, attention_mask):
            out = self.m(input_ids=input_ids, attention_mask=attention_mask)
            cls = out.last_hidden_state[:, 0]
            return cls / cls.norm(dim=-1, keepdim=True)

    enc = Enc(model).eval()
    batch = tokenizer(["最近总是失眠"], return_tensors="pt", padding=True)
    with torch.no_grad():
        torch.onnx.export(
            enc, (batch["input_ids"], batch["attention_mask"]), OUT,
            input_names=["input_ids", "attention_mask"],
            output_names=["embedding"],
            dynamic_axes={
                "input_ids": {0: "batch", 1: "seq"},
                "attention_mask": {0: "batch", 1: "seq"},
                "embedding": {0: "batch"},
            },
            opset_version=14, dynamo=False,
        )
    print(f"已导出 {OUT}  {os.path.getsize(OUT) / 1024 / 1024:.1f} MB")

    # 自检：ONNX 结果应与 PyTorch 一致
    import onnxruntime as ort
    ort.set_default_logger_severity(3)
    sess = ort.InferenceSession(OUT)
    with torch.no_grad():
        ref = enc(batch["input_ids"], batch["attention_mask"]).numpy()[0]
    got = sess.run(None, {
        "input_ids": batch["input_ids"].numpy(),
        "attention_mask": batch["attention_mask"].numpy(),
    })[0][0]
    diff = float(abs(ref - got).max())
    print(f"维数 {got.shape[0]}，与 PyTorch 最大偏差 {diff:.6f}")


if __name__ == "__main__":
    main()
