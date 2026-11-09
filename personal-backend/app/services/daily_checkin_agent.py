"""每日问询 Agent（阶段 3.5）。

用户**当天第一次登录进系统时**触发一次，生成个性化日常询问，
如"今天有没有吃到什么好吃的？""有看到什么好看的风景吗？"等。
一天只问询一次（由 `checkin_service.ensure_daily_checkin` 保证幂等）。

设计思路：
1. 查询 Neo4j 中该用户的兴趣画像（不是"所有用户"——登录触发的入口天然知道是谁）
2. 按兴趣画像生成个性化问询（LLM，失败则用模板）
3. 问询落库为待回复状态，前端在个人端工作台弹出提示
4. 用户回复后正常走 extract 链路，写回图谱

触发方式（2026-11-07 调整）：
- 前端进入个人端工作台时调 `POST /api/v1/checkin/ensure`（幂等，一天一条）
- **不再**由 APScheduler 定时触发：到点跑出来的问询，用户不在线就只能躺在库里
"""

import time

from ..core.neo4j import get_driver, neo4j_health
from . import llm_client

# 各兴趣类别对应的日常问询模板（LLM 失败时的兜底）
CHECKIN_TEMPLATES = {
    "音乐": "今天有没有听到什么好听的歌？或者有没有想听的音乐？🎵",
    "体育赛事": "最近有没有关注什么比赛？支持的球队最近表现怎么样？🏀",
    "影视": "最近有没有看什么好看的电影或剧集？🎬",
    "书籍": "最近在读什么书？有没有哪本让你印象深刻？📚",
    "小说": "最近有没有读到什么精彩的小说情节？📖",
    "漫画": "最近有没有追什么漫画或动漫？有什么精彩的更新吗？📖",
    "动漫": "最近有没有追什么动漫？最喜欢哪个角色？✨",
    "美食": "今天有没有吃到什么好吃的美食？😋",
    "烹饪": "今天有没有做什么好吃的？或者想尝试做什么菜？👨‍🍳",
    "运动": "今天有没有做什么运动？感觉怎么样？🏃",
    "旅行": "最近有没有去哪里走走？或者有没有想去的地方？✈️",
    "游戏": "最近有没有玩什么游戏？有什么好玩的推荐吗？🎮",
    "社交": "今天有没有和朋友聚聚？或者有什么想分享的事？☕",
}

DEFAULT_CHECKINS = [
    "今天过得怎么样？有什么想聊的吗？😊",
    "今天有没有遇到让你开心的小事？✨",
    "今天心情怎么样？想分享一下吗？🌤️",
    "今天有没有看到什么好看的风景？📷",
    "今天学到了什么新东西吗？📚",
    "今天有什么想吐槽或者分享的事吗？💬",
]


def get_all_users() -> list[str]:
    """从 Neo4j 获取所有有图谱数据的用户 ID。"""
    if not neo4j_health():
        return []
    driver = get_driver()
    with driver.session() as session:
        rows = session.run(
            "MATCH (u:User) WHERE u.user_id IS NOT NULL RETURN DISTINCT u.user_id AS uid"
        ).data()
    return [r["uid"] for r in rows]


def get_user_interests(user_id: str) -> list[dict]:
    """获取用户兴趣画像（含 category）。

    category 优先取本用户的边属性，节点属性仅作改造前历史数据的兜底：
    节点是跨用户共享的，读节点属性会把别人的归类当成自己的。
    """
    if not neo4j_health():
        return []
    driver = get_driver()
    with driver.session() as session:
        rows = session.run(
            "MATCH (u:User {user_id: $uid})-[r:LIKES|FOLLOWS]->(i:Interest) "
            "RETURN i.name AS name, coalesce(r.category, i.category) AS category",
            uid=user_id,
        ).data()
    return rows


_CHECKIN_PROMPT = """你是日常关怀助手。用户 {user_id} 的兴趣画像：{interests}。
基于这些兴趣，生成一句温暖自然的日常问询（50字以内），
可以问关于美食、风景、心情、兴趣相关的事，语气像朋友一样轻松自然。
只输出问询内容，不要前缀或解释。"""


def generate_checkin_message(user_id: str, interests: list[dict]) -> str:
    """为用户生成个性化日常问询。优先 LLM，失败用模板。"""
    cats = list({i["category"] for i in interests if i.get("category")})

    # 先用 LLM 生成
    if cats:
        interest_str = "、".join(f"{i['name']}({i['category']})" for i in interests[:5])
        prompt = _CHECKIN_PROMPT.format(user_id=user_id, interests=interest_str)
        msg = llm_client.chat(prompt, "")
        if msg:
            return msg

    # LLM 失败，按兴趣类别用模板
    import random
    for cat in cats:
        if cat in CHECKIN_TEMPLATES:
            return CHECKIN_TEMPLATES[cat]

    # 无匹配兴趣，用通用模板
    return random.choice(DEFAULT_CHECKINS)


def run_daily_checkin() -> dict:
    """对所有用户执行一次日常问询（管理员手动全量触发用，见 /checkin/daily/all）。

    正常链路由登录触发走 `checkin_service.ensure_daily_checkin`（单用户、幂等）；
    这个全量版本保留给管理端调试，落库时同样按"一天一条"去重。
    """
    users = get_all_users()
    result = {}
    for uid in users:
        interests = get_user_interests(uid)
        msg = generate_checkin_message(uid, interests)
        result[uid] = msg
    return result
