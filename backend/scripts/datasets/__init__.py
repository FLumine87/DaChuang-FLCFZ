"""数据集适配器包：把仓库外数据集解析成统一的多模态语料结构。

每个适配器实现:
    build(root, records_per_class, sample_max, rng) -> BuildResult

其中 BuildResult 是一个 dict:
    {
        "records": [...],   # 记录级（record_id/label/themes/severity/alert_level/created_at/window/context/entry）
        "units": [...],     # 单元级（unit_id/record_id/modality/content/themes/.../media_path/media_kind/feature/dataset/meta）
        "queries": [...],   # 评测查询
        "meta": {key: value}  # 写入 meta 表的额外信息
        "root": "数据集根目录",
    }

统一约定（与 generate_retrieval_corpus.py 的 schema 兼容，见 build_real_corpus.py）:
  * 1 条记录 = 1 个可检索样本，其多模态单元（text/audio/image）共享 record_id；
  * 音频特征预先离线抽取（RF.audio_feature，64 维）写入 units.feature，
    引擎启动时直接读取，避免每次重建索引都重复解码媒体；
  * text 单元不落 feature（由 content 现场重算，保证词表更新后语义一致）。
"""
