"""定时日常问询 Agent（阶段 3.5）。

每天定时（可配置时间）向用户发送个性化日常询问，
如"今天有没有吃到什么好吃的？""有看到什么好看的风景吗？"等。

设计思路：
1. 查询 Neo4j 中所有有图谱数据的用户
2. 按用户兴趣画像生成个性化问询（LLM，失败则用模板）
3. 问询内容作为系统消息推送给前端（存为待回复状态，前端轮询获取）
4. 用户回复后正常走 extract 链路，写回图谱

启动方式：
- 服务启动时自动启动调度器（enable_daily_checkin=True）
- 时间默认 20:00，可通过 DAILY_CHECKIN_HOUR / DAILY_CHECKIN_MINUTE 配置
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
    """获取用户兴趣画像（含 category）。"""
    if not neo4j_health():
        return []
    driver = get_driver()
    with driver.session() as session:
        rows = session.run(
            "MATCH (u:User {user_id: $uid})-[:LIKES|FOLLOWS]->(i:Interest) "
            "RETURN i.name AS name, i.category AS category",
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
    """对所有用户执行一次日常问询（通常由调度器定时触发）。

    返回 {user_id: message} 字典，供 API 层推送给前端。
    """
    users = get_all_users()
    result = {}
    for uid in users:
        interests = get_user_interests(uid)
        msg = generate_checkin_message(uid, interests)
        result[uid] = msg
    return result
