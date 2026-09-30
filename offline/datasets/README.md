# offline/datasets

真实数据集与离线模型权重的存放目录。**本目录内容不入库**（见根 `.gitignore`），
需要各自在本地准备。

## 放什么

跨模态检索要复现真实数据，需要把数据集解压到本目录下，目录名必须为
`Context-Aware Multimodal Depression Dataset`：

```
offline/datasets/
└── Context-Aware Multimodal Depression Dataset/
    ├── depression_dataset.csv                    # 1000 条自述文本 + 情境 + 风险标签
    ├── Images/Images/{depressed1,depressed2,normal1,normal2}/   # 48×48 灰度面部图像
    └── Audio/dataset-depression/{depression1,depression2,normal1,normal2}/  # 16-bit PCM wav
```

数据集出处：Kaggle `colabsss/depression-dataset`
（https://www.kaggle.com/datasets/colabsss/depression-dataset），
需 Kaggle 账号，使用时请遵守其原始许可条款。

不想放这里也可以，用 `--dataset-root` 或环境变量 `DACHUANG_ASSETS_ROOT` 指定路径。

## 放好之后

```bash
cd backend
python scripts/build_real_corpus.py      # 生成 data/hashing/real_corpus.db
```

重启后端即自动生效（引擎优先读 `real_corpus.db`，缺失则回退随仓库发布的合成语料
`data/hashing/corpus.db`）。确认方式：`GET /api/retrieval/index-stats` 返回的
`source` 应为 `corpus-real`。

## 为什么这些文件不在仓库里

- **体积**：数据集约 100 MB，不适合入库。
- **许可**：数据集带使用条款，转手再分发不合规。
- **路径失效**：派生语料 `real_corpus.db` 里的 `media_path` 是构建机器上的绝对路径，
  换台机器图片/语音缩略图就会断链，所以必须本地重建而不是复用。