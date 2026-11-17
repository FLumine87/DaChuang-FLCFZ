# offline/datasets

真实数据集与离线模型权重的存放目录。**本目录内容不入库**（见根 `.gitignore`），
各数据集需自行准备，本地构建语料库。

## 放什么（本项目当前使用的四个数据集）

跨模态检索的 `real_corpus.db` 由 `backend/scripts/build_real_corpus.py` 依据
以下**仓库外**真实数据集构建。把它们放到 `D:\DaChuang\` 下即可
（或任选其一，用 `--dataset {eatd,csemotions,fer,avdd,all}` 指定）：

```
D:\DaChuang\
├── EATD-Corpus\                     # 文本 + 语音（真实同源配对）+ SDS 标签
│   └── EATD-Corpus\
│       ├── t_1\   {positive,neutral,negative}.{wav,txt} + label.txt + new_label.txt
│       ├── v_2\   ...
│       └── ...    （162 名受试者：83× t_ + 79× v_）
├── CSEMOTIONS\                      # 文本 + 语音（真实同源配对）+ 7 类情绪
│   └── data\train-*.parquet    （4 列：audio(bytes) / text / emotion / speaker，8 分片共 4160 条）
├── archive\                         # FER2013 图像（Kaggle 解压包）
│   ├── train\{angry,disgust,fear,happy,neutral,sad,surprise}\*.jpg   （48×48 灰度）
│   └── test\{...}
└── dataset\dataset\AVDD-TCMI\       # AVDD-TCMI 音↔图真同源（单文件 14.5 GB）
    └── AVDD-TCMI-dataset\
        ├── HDS\{id}\{id}_acoustic.csv   （1024 维帧级声学特征）
        │              \{id}_visual.csv    （OpenFace 2.0：AU / 头姿 / 眼动）
        │              \{id}_tcm\{0,1,2\}\*.jpg （中医望诊区域图，7 个区域 × 3 组）
        ├── HDS_labels.csv      （282 行：id, 抑郁标签 0/1, 性别 f/m）
        ├── SDS\{id\}\...       （948 条，中学筛查子集，同结构）
        └── SDS_labels.csv
```

- **EATD-Corpus**（ICASSP 2022 中文抑郁语料）：每条 = 语音 `*.wav` + 同名中文转写
  `*.txt` + SDS 自评量表分（`new_label.txt = 标准化分，≥53 记为抑郁`，30:132 真实类不平衡）。
- **CSEMOTIONS**（HF 中文情绪语音，Apache-2.0）：每条 = 标准 WAV + 中文文本 + 7 类情绪。
  读取 parquet 需在 venv 安装 `pyarrow pandas`。
- **FER2013**（人脸表情，7 类）：纯图像集，**没有与之同源的文本/语音**。
- **AVDD-TCMI**（华西医院面诊 + 中学筛查，非商业许可 cc-by-nc-4.0）：
  **音 ↔ 图真同源**（同一受试者的面诊语音与人脸望诊信息），
  HDS 子集为临床确诊（282 条），SDS 子集为筛查（948 条）。
  下载与镜像加速见 `backend/scripts/download_datasets.py`：

  ```bash
  # 国内直连镜像（约 14.5 GB 单文件；hf-mirror + aifasthub 双源并行）
  python scripts/download_datasets.py --dataset avdd
  # 解压后把 AVDD-TCMI-dataset 放到 D:\DaChuang\dataset\dataset\AVDD-TCMI\ 下
  ```

### 三模态是怎么组装的（重要）

`--dataset all`（默认）会：
1. 用 EATD + CSEMOTIONS 建立**真实的「文本↔语音」同源配对**记录；
2. 把 FER2013 图像**按情绪语义对齐**挂到这些记录上，使每条记录都具备
   `text + audio + image` 三视图。

> ⚠️ **图像视图是「情绪对齐」的弱配对**（例如 sad 的语音记录配一张 FER 的 sad 人脸），
> 不是同一被试的真实同源数据。`meta` 表里的 `fer.attach_mode` 已如实标注，
> 论文/答辩中必须写明这一点。跨数据集不存在真实的图像同源配对，这是数据层面的客观限制。

之所以要这样挂接而不是把图像单独成记录：引擎的配对训练要求**同组记录的模态集合一致**
（见 `engine._train`），纯图像记录与「文本+语音」记录混合会让模态交集为空、
图像/语音编码器根本训练不到。

> ★ 该限制已由**特征通道化**解除：不同模态集合的记录现在可以共存于同一个监督矩阵
> （缺该模态的记录按「缺失视图」处理），因此 AVDD-TCMI 能以 `text + audio + image`
> 之外的 `{audio, image}` 模态集合直接参与训练，不需要挂接、也不需要独立引擎。

### AVDD-TCMI 怎么接入（`--with-avdd`）

```bash
cd backend
python scripts/build_real_corpus.py --dataset all --with-avdd --queries 280
```

AVDD-TCMI 走**与其他数据集完全相同的标准适配器**（`backend/scripts/datasets/avdd_tcmi.py`），
进入同一份语料、同一次训练、同一个索引：

| 通道 | 特征 | 覆盖行数 |
|---|---|---|
| `audio@2048` | `acoustic.csv` 1024 维帧级特征池化（均值 + 标准差） | 1230 |
| `image@98` | `visual.csv` 的 OpenFace 特征（35 AU + 6 pose + 8 gaze，各均值+标准差） | 1230 |

同源关系由 `records.pairing_type = same_source_audio_image` 声明，
引擎据此把音↔图对在监督矩阵里提到强约束。实测 AVDD 音↔图同记录汉明距离
**20.53**（随机配对 30.17），对齐强度 **+9.63 位**。

构建时会把 CSEMOTIONS 的音频字节解出成 `CSEMOTIONS\_audio\*.wav` 缓存（不入库）。

## 位置与别名

不想放 `D:\DaChuang\` 也可以，用环境变量 `DACHUANG_ASSETS_ROOT` 或
`build_real_corpus.py --dataset-root <根目录>` 指定（适配器会在
`<根目录>/EATD-Corpus`、`<根目录>/CSEMOTIONS` 下查找）。

## 构建语料库

```bash
cd backend
python scripts/build_real_corpus.py                 # 默认：EATD+CSEMOTIONS（真配对）+ FER2013 图像视图
python scripts/build_real_corpus.py --dataset eatd  # 只用 EATD-Corpus（文本+语音）
python scripts/build_real_corpus.py --dataset csemotions  # 只用 CSEMOTIONS
python scripts/build_real_corpus.py --dataset fer   # 只用 FER2013（纯图像，用于自测适配器）
python scripts/build_real_corpus.py --dataset avdd  # 只用 AVDD-TCMI（音↔图真同源）
python scripts/build_real_corpus.py --dataset all --with-avdd   # 额外接入 AVDD-TCMI
# 可选：--sample-max 1200 控制样本数；--queries 120；--csemotions-max-files 4；--out <路径>
```

产出：`backend/data/hashing/real_corpus.db`（records / units / queries / meta 四表，
schema 与合成语料 `generate_retrieval_corpus.py` 兼容，上层哈希引擎与评测脚本无需改动）。

重启后端即自动生效（引擎优先读 `real_corpus.db`，缺失则回退合成语料 `corpus.db`）：
`GET /api/retrieval/index-stats` 的 `source` 应显示 `corpus-real`。

> ⚠️ **通道化后重建索引需要重训一次**：投影矩阵的键从 `text/audio/image` 变为
> `modality@dim`（如 `text@531`、`audio@2048`），旧的 `hashing_state.json` 与
> `index.db` 不兼容。删除二者后重启后端即可重训。

## 为什么这些文件不在仓库里

- **体积**：EATD 数百 MB、CSEMOTIONS 约 3 GB、FER2013 约 60 MB、**AVDD-TCMI 约 35 GB
  （解压后）**，不适合入库。
- **许可**：各数据集带使用条款，转手再分发不合规（AVDD-TCMI 为 cc-by-nc-4.0 非商业）。
- **路径失效**：`real_corpus.db` 里的 `media_path` 是构建机器的绝对路径，
  必须本地重建，不要跨机器直接复制复用。
