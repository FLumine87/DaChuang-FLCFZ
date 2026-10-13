"""推理 + 缓解推荐 Agent 演示：对指定用户执行双图谱推理，并生成个性化内容推送。

用法（在 backend/ 目录下）：
    python scripts/demo_inference.py [user_id]   # 默认 demo_user
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import recommendation_agent
from app.services.inference_agent import run_inference

user_id = sys.argv[1] if len(sys.argv) > 1 else "demo_user"
report = run_inference(user_id)
feed = recommendation_agent.build_recommendation_feed(report)

output = {
    "report": report.model_dump(),
    "content_feed": [f.model_dump() for f in feed],
}
print(json.dumps(output, ensure_ascii=False, indent=2))
