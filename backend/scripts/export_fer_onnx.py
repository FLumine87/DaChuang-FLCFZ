"""把微调后的 MobileNetV2 导出成 1280 维特征 ONNX。

训练脚本保存的是带 7 类分类头的权重；检索只需要特征，所以导出时用
features + avgpool，丢掉 classifier。输出与 build_image_corpus 里的
抽取函数一致，换模型即可，其他代码不动。

用法：
    python scripts/export_fer_onnx.py
"""
import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)


def main():
    import torch
    import torch.nn as nn
    from torchvision import models

    weights = os.path.join(BACKEND, "models", "fer_mobilenet.pth")
    out = os.path.join(BACKEND, "models", "mobilenetv2-fer.onnx")
    if not os.path.exists(weights):
        raise SystemExit(f"未找到权重：{weights}，请先运行 scripts/finetune_fer.py")

    model = models.mobilenet_v2(weights=None)
    model.classifier[-1] = nn.Linear(model.last_channel, 7)
    state = torch.load(weights, map_location="cpu")
    model.load_state_dict(state)
    model.eval()

    class FeatNet(nn.Module):
        # torchvision 0.29 的 MobileNetV2 没有 avgpool 属性（forward 内联），
        # 所以自建一个 AdaptiveAvgPool2d，行为与原模型一致
        def __init__(self, m):
            super().__init__()
            self.features = m.features
            self.pool = nn.AdaptiveAvgPool2d(1)

        def forward(self, x):
            return torch.flatten(self.pool(self.features(x)), 1)

    net = FeatNet(model).eval()
    dummy = torch.randn(1, 3, 224, 224)
    torch.onnx.export(
        net, dummy, out,
        input_names=["data"], output_names=["feature"],
        dynamic_axes={"data": {0: "batch"}, "feature": {0: "batch"}},
        opset_version=13, dynamo=False,  # 2.14 默认 dynamo 导出需要 onnxscript，走旧路径
    )
    print(f"已导出 {out}  {os.path.getsize(out) / 1024 / 1024:.1f} MB")

    import onnxruntime as ort
    ort.set_default_logger_severity(3)
    sess = ort.InferenceSession(out)
    shape = [o.shape for o in sess.get_outputs()]
    print("输出形状", shape)


if __name__ == "__main__":
    main()
