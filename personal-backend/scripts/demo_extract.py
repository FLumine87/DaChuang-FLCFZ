"""兴趣采集 Agent 离线演示：Mock 抽取 + 可选写入 Neo4j。

用法（在 backend/ 目录下）：
    python scripts/demo_extract.py            # 只演示抽取，不写库
    python scripts/demo_extract.py --write    # 抽取后写入 Neo4j（需先配置 .env 并启动 Neo4j）
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.llm_client import extract_triples
from app.services.kg_service import write_triples
from app.schemas.kg import coerce_triples

SAMPLES = [
    "最近复习压力大，晚上总是失眠，听歌能稍微缓解一下",
    "我很喜欢听民谣，特别关注 NBA，是勇士队的球迷",
    "明天要期末考试了，有点焦虑，烦躁，去跑步也没用",
    "刚看完演唱会，很开心，最近还在追世界杯",
]


def main() -> None:
    do_write = "--write" in sys.argv
    total = 0
    for text in SAMPLES:
        raw = extract_triples(text)
        triples = coerce_triples(raw)
        print(f"\n输入：{text}")
        for t in triples:
            extra = f" (value={t.value})" if t.value else ""
            cat = f" [{t.category}]" if t.category else ""
            print(f"  -> ({t.relation}) {t.object}{extra}{cat}")
        if do_write and triples:
            total += write_triples("demo_user", triples)
    if do_write:
        print(f"\n共写入 {total} 条三元组（用户 demo_user）")


if __name__ == "__main__":
    main()
