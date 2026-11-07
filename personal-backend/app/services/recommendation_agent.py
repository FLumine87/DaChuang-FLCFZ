"""缓解推荐 Agent（阶段 3，阶段 3.5 扩展兴趣类别；2026-10-15 升级为 LLM 生成）。

生成策略（LLM 优先，种子兜底）：
- LLM 可用时：把「风险等级 + 可解释因素 + 图谱参考方向 + 兴趣画像」交给
  LLM 生成 4~6 条个性化推荐（条目名、内容、推荐理由全部生成）。
  歌曲/作品/文章只给"名称 + 关键词"，链接由程序拼接搜索链接——
  零外部服务依赖，且链接恒可达、内容不虚构。
- LLM 不可用/失败/超时：回退到内置种子库 + 模板拼装（原逻辑完整保留）。
- 不做跨次记忆（2026-10-15 决策）：多样性靠提示词约束 + 温度 + 随机种子，
  每次刷新都重新生成全新内容。

数据源策略（可配置）：
- MUSIC_API_URL：自建 NetEaseCloudMusicApi 实例（可选，仅种子回退路径使用）
- ENABLE_LLM_CONTENT=False 时跳过 LLM 生成，直接走种子回退
- 种子库（SEED_*）保留为离线/失败兜底，不再作为主路径内容来源

轻中度（绿/黄/橙）风险时由推理链路自动附带推荐；红级跳过（走预警）。
"""

import json
import random
import re
import time
from urllib.parse import quote

import httpx

from ..config import settings
from ..core.neo4j import get_driver, neo4j_health
from ..schemas.inference import CopingRecommendation, RiskReport
from . import llm_client

# ---------- 内置种子内容（离线兜底，可扩充） ----------

SEED_TRACKS = [
    {"id": "s1", "title": "晴天", "artist": "周杰伦", "url": "https://music.163.com/song?id=186016"},
    {"id": "s2", "title": "稻香", "artist": "周杰伦", "url": "https://music.163.com/song?id=185809"},
    {"id": "s3", "title": "南山南", "artist": "马頔", "url": "https://music.163.com/song?id=308413"},
    {"id": "s4", "title": "成都", "artist": "赵雷", "url": "https://music.163.com/song?id=436514312"},
    {"id": "s5", "title": "消愁", "artist": "毛不易", "url": "https://music.163.com/song?id=569213220"},
    {"id": "s6", "title": "夜空中最亮的星", "artist": "逃跑计划", "url": "https://music.163.com/song?id=25706282"},
    {"id": "s7", "title": "平凡之路", "artist": "朴树", "url": "https://music.163.com/song?id=29764564"},
    {"id": "s8", "title": "理想", "artist": "赵雷", "url": "https://music.163.com/song?id=29592189"},
]

SEED_SPORTS = [
    {"title": "NBA 季前赛：勇士 vs 湖人 明日开战", "source": "NBA 中国官网", "url": "https://china.nba.com/"},
    {"title": "世界杯亚洲区预选赛：国足今晚 20:00 对阵日本队", "source": "FIFA 官网", "url": "https://www.fifa.com/"},
    {"title": "CBA 新赛季开幕，辽宁男篮力争卫冕", "source": "CBA 官网", "url": "https://www.cbaleague.com/"},
    {"title": "勇士队训练营：库里状态火热，新援磨合顺利", "source": "NBA 官网", "url": "https://www.nba.com/warriors"},
]

SEED_FILMS = [
    {"title": "《心灵奇旅》皮克斯动画，探索生命的意义", "source": "豆瓣电影", "url": "https://movie.douban.com/subject/24733428/"},
    {"title": "《海蒂和爷爷》治愈系阿尔卑斯山田园生活", "source": "豆瓣电影", "url": "https://movie.douban.com/subject/25902905/"},
    {"title": "《绿皮书》跨越种族的友谊与温暖", "source": "豆瓣电影", "url": "https://movie.douban.com/subject/27060077/"},
    {"title": "《菊次郎的夏天》北野武的温柔夏日物语", "source": "豆瓣电影", "url": "https://movie.douban.com/subject/1293359/"},
    {"title": "《千与千寻》宫崎骏经典，找回内心的勇气", "source": "豆瓣电影", "url": "https://movie.douban.com/subject/1291561/"},
]

SEED_BOOKS = [
    {"title": "《被讨厌的勇气》岸见一郎，阿德勒心理学入门", "source": "豆瓣读书", "url": "https://book.douban.com/subject/26369699/"},
    {"title": "《蛤蟆先生去看心理医生》心理咨询入门故事", "source": "豆瓣读书", "url": "https://book.douban.com/subject/35143794/"},
    {"title": "《解忧杂货店》东野圭吾，温暖人心的奇幻故事", "source": "豆瓣读书", "url": "https://book.douban.com/subject/25862578/"},
    {"title": "《人类简史》尤瓦尔·赫拉利，宏观视角看人类文明", "source": "豆瓣读书", "url": "https://book.douban.com/subject/25985021/"},
    {"title": "《小王子》圣埃克苏佩里，关于爱与责任的寓言", "source": "豆瓣读书", "url": "https://book.douban.com/subject/1084336/"},
]

SEED_COMICS = [
    {"title": "《灌篮高手》井上雄彦，青春与篮球的热血记忆", "source": "豆瓣读书", "url": "https://book.douban.com/subject/25783522/"},
    {"title": "《夏目友人帐》绿川幸，温柔治愈的人与妖物语", "source": "豆瓣读书", "url": "https://book.douban.com/subject/25939949/"},
    {"title": "《海贼王》尾田荣一郎，追逐梦想的热血冒险", "source": "豆瓣读书", "url": "https://book.douban.com/subject/1085860/"},
    {"title": "《银魂》空知英秋，又燃又丧的武士喜剧", "source": "豆瓣读书", "url": "https://book.douban.com/subject/1766252/"},
    {"title": "《你的名字》新海诚，跨越时空的唯美羁绊", "source": "豆瓣读书", "url": "https://book.douban.com/subject/26848757/"},
]

SEED_FOOD = [
    {"title": "《深夜食堂》安倍夜郎，食物背后的温情故事", "source": "豆瓣读书", "url": "https://book.douban.com/subject/4011443/"},
    {"title": "《孤独的美食家》久住昌之，一个人也要好好吃饭", "source": "豆瓣读书", "url": "https://book.douban.com/subject/10570058/"},
    {"title": "《小森林》五十岚大介，田园料理的四季物语", "source": "豆瓣读书", "url": "https://book.douban.com/subject/6518608/"},
    {"title": "《舌尖上的中国》纪录片，中华美食的集体记忆", "source": "豆瓣", "url": "https://movie.douban.com/subject/6549907/"},
]

SEED_GENERAL = [
    {"title": "正念冥想入门：每天 5 分钟缓解焦虑", "source": "壹心理", "url": "https://www.xinli001.com/"},
    {"title": "科学运动如何改善情绪？研究证明有效", "source": "丁香医生", "url": "https://dxy.com/"},
    {"title": "睡眠卫生指南：睡个好觉的 10 个技巧", "source": "简单心理", "url": "https://www.jiandanxinli.com/"},
]

# 类别映射：兴趣 category -> 内容类型
CATEGORY_CONTENT_MAP = {
    "音乐": "music",
    "运动": "sports",
    "体育赛事": "sports",
    "影视": "film",
    "电影": "film",
    "剧集": "film",
    "书籍": "book",
    "小说": "book",
    "读书": "book",
    "漫画": "comic",
    "动漫": "comic",
    "美食": "food",
    "烹饪": "food",
    "旅行": "general",
    "游戏": "general",
    "社交": "general",
    "冥想": "general",
    "认知": "general",
    "专业帮助": "general",
}


# ---------- Mock 通路兜底（Neo4j 不可用 + ENABLE_MOCK_ENGINES=True） ----------

MOCK_REASON = "演示模式 · 仓库内置通用内容（非个性化推荐）"


def mock_fallback_feed(limit: int = 3) -> list[CopingRecommendation]:
    """没有图谱可查时的兜底内容：只用本文件已有的 SEED_GENERAL 条目。

    为什么需要它：个性化推送页（/personal/me/feed）与推理报告的 content_feed
    都依赖图谱里的兴趣画像；Neo4j 未启动时原来直接返回空列表，页面只能是一片空。
    演示/离线场景下给一条内置内容比给空更有用，但必须让人一眼看出这不是
    "按你的画像算出来的" —— 所以 reason 统一写明演示模式，返回体上另有 mock 标记。
    绝不新编文案：条目、来源、链接全部取自本文件顶部的种子库。
    """
    return [
        CopingRecommendation(
            name=item["title"],
            category="通用",
            suggestion=f"来源：{item['source']}（{item['url']}）",
            reason=MOCK_REASON,
        )
        for item in SEED_GENERAL[:limit]
    ]


def _fetch_music_recommendations(interest_names: list[str], limit: int = 3) -> list[dict]:
    """优先调用自建 NetEaseCloudMusicApi，失败/未配置则用种子数据。"""
    base = getattr(settings, "music_api_url", "") or ""
    tracks: list[dict] = []
    if base:
        try:
            with httpx.Client(timeout=8, verify=settings.llm_verify_ssl) as client:
                # 用第一个音乐类兴趣关键词搜索
                kw = interest_names[0] if interest_names else "民谣"
                resp = client.get(f"{base.rstrip('/')}/cloudsearch", params={"keywords": kw, "limit": limit, "type": 1})
                resp.raise_for_status()
                songs = resp.json().get("result", {}).get("songs", [])
                for s in songs[:limit]:
                    tracks.append({
                        "id": str(s.get("id", "")),
                        "title": s.get("name", ""),
                        "artist": " / ".join(a.get("name", "") for a in s.get("ar", [])),
                        "url": f"https://music.163.com/song?id={s.get('id', '')}",
                    })
        except Exception:
            tracks = []
    if not tracks:
        # 种子兜底：按兴趣关键词做简单匹配，无匹配则随机
        matched = [t for t in SEED_TRACKS if any(kw in t["artist"] or kw in t["title"] for kw in interest_names)]
        pool = matched if matched else SEED_TRACKS
        tracks = random.sample(pool, min(limit, len(pool)))
    return tracks


def _fetch_sports_news(interest_names: list[str], limit: int = 3) -> list[dict]:
    """体育赛事资讯：目前用种子库，可按需接入 RSS/API。"""
    matched = [n for n in SEED_SPORTS if any(kw in n["title"] for kw in interest_names)]
    pool = matched if matched else SEED_SPORTS
    return random.sample(pool, min(limit, len(pool)))


def _fetch_films(interest_names: list[str], limit: int = 2) -> list[dict]:
    matched = [n for n in SEED_FILMS if any(kw in n["title"] for kw in interest_names)]
    pool = matched if matched else SEED_FILMS
    return random.sample(pool, min(limit, len(pool)))


def _fetch_books(interest_names: list[str], limit: int = 2) -> list[dict]:
    matched = [n for n in SEED_BOOKS if any(kw in n["title"] for kw in interest_names)]
    pool = matched if matched else SEED_BOOKS
    return random.sample(pool, min(limit, len(pool)))


def _fetch_comics(interest_names: list[str], limit: int = 2) -> list[dict]:
    matched = [n for n in SEED_COMICS if any(kw in n["title"] for kw in interest_names)]
    pool = matched if matched else SEED_COMICS
    return random.sample(pool, min(limit, len(pool)))


def _fetch_food(interest_names: list[str], limit: int = 2) -> list[dict]:
    matched = [n for n in SEED_FOOD if any(kw in n["title"] for kw in interest_names)]
    pool = matched if matched else SEED_FOOD
    return random.sample(pool, min(limit, len(pool)))


def _fetch_general_content(limit: int = 3) -> list[dict]:
    return random.sample(SEED_GENERAL, min(limit, len(SEED_GENERAL)))


# ---------- LLM 生成通路（主路径，2026-10-15 起） ----------


def _load_interests_by_cat(user_id: str) -> dict[str, list[str]]:
    """查用户兴趣画像并按 category 分组。调用方需保证 Neo4j 可用。"""
    driver = get_driver()
    with driver.session() as session:
        rows = session.run(
            "MATCH (u:User {user_id:$uid})-[:LIKES|FOLLOWS]->(i:Interest) "
            "RETURN i.name AS name, i.category AS category",
            uid=user_id,
        ).data()
    interests_by_cat: dict[str, list[str]] = {}
    for r in rows:
        if r.get("category"):
            interests_by_cat.setdefault(r["category"], []).append(r["name"])
    return interests_by_cat


# category 白名单：与前端图标映射保持一致（映射外的归入"通用"）
_ALLOWED_CATEGORIES = {
    "音乐", "运动", "影视", "书籍", "漫画", "美食",
    "冥想", "认知", "社交", "专业帮助", "通用",
}

_GENERATE_SYSTEM = """你是心理健康内容推荐助手，为「个人心理状态管理」系统生成「为你推荐」内容。
输入 JSON 里给出：用户风险等级、可解释因素（近期被记录到的状态）、参考方向（知识图谱给出的建议维度）、兴趣画像。

生成规则：
1. 生成 {count} 条推荐，每条围绕一个具体方向——可以是缓解建议（睡眠/运动/呼吸练习等），也可以是贴合兴趣的内容（歌单/影视/读物）。
2. name 自拟，15 字以内；参考方向只作方向池，不要照抄原名。
3. category 必须是以下之一：音乐、运动、影视、书籍、漫画、美食、冥想、认知、社交、专业帮助、通用。
4. 内容必须真实存在，禁止虚构：
   - 音乐：真实存在的歌曲，给出"歌名+歌手"，贴合兴趣画像，避开被推荐到烂大街的少数几首
   - 影视/书籍/漫画：真实作品名
   - 文章/科普：真实存在的知名来源（丁香医生/壹心理/简单心理/豆瓣等）
   - 做法类：给具体、可执行、低门槛的做法
5. reason 一句话（第二人称），说明为什么推荐给这位用户，引用他的兴趣或状态。
6. 风险等级为黄/橙时：优先调节方法类内容，且必须包含一条「专业帮助」方向（措辞温和，如持续无改善建议寻求学校心理咨询中心）；参考方向里若有专业支持类，绿级也保留一条。
7. 不要医疗建议、不要诊断；语气温暖支持；提醒适度、注意休息。
8. {count} 条内容要多样，不要全部同类；避免总是给出最热门/最常见的推荐。
9. links 给可跳转内容：label 为显示文本（如「《南山南》- 马頔」），q 为搜索关键词（如「南山南 马頔」）；纯做法类给空数组 []；音乐类必须给 links。

只输出 JSON 数组，不要输出任何其他文字：
[{{"name": "...", "category": "...", "content": "...", "links": [{{"label": "...", "q": "..."}}], "reason": "..."}}]"""


def _music_search_url(q: str) -> str:
    """网易云音乐搜索页链接（不依赖任何 API，链接恒可达）。"""
    return "https://music.163.com/#/search/m/?s=" + quote(q)


def _web_search_url(q: str) -> str:
    """通用内容用必应搜索链接（标题+来源做关键词）。"""
    return "https://cn.bing.com/search?q=" + quote(q)


def _llm_generate_feed(
    *,
    risk_level: str,
    risk_label: str,
    factors: list[str],
    directions: list[str],
    interests_by_cat: dict[str, list[str]],
    limit: int,
) -> list[CopingRecommendation] | None:
    """用 LLM 生成推荐条目。返回 None 表示生成失败（调用方回退种子库）。"""
    if llm_client.mock_mode() or not getattr(settings, "enable_llm_content", True):
        return None
    interests_flat = [f"{name}（{cat}）" for cat, names in interests_by_cat.items() for name in names]
    payload = {
        "风险等级": f"{risk_label}（{risk_level}）",
        "可解释因素": factors[:6],
        "参考方向": directions[:8],
        "兴趣画像": interests_flat or ["（暂无）"],
        "条数": limit,
        "随机种子": random.randint(1, 10 ** 6),  # 让每次生成结果有差异
    }
    prompt = _GENERATE_SYSTEM.format(count=limit)
    text = llm_client.chat(prompt, json.dumps(payload, ensure_ascii=False), temperature=0.9)
    if not text.strip():
        return None
    return _parse_generated_items(text, limit)


def _parse_generated_items(text: str, limit: int) -> list[CopingRecommendation] | None:
    """解析 LLM 输出的 JSON 数组；任一步失败返回 None（回退种子库）。

    链接只信任 LLM 给的"关键词"，URL 一律由程序拼接——防止编造出死链。
    """
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, list):
        return None

    items: list[CopingRecommendation] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        content = str(row.get("content") or "").strip()
        if not name or not content:
            continue
        category = str(row.get("category") or "").strip()
        if category not in _ALLOWED_CATEGORIES:
            category = "通用"

        parts = [content]
        link_texts: list[str] = []
        links = row.get("links")
        if isinstance(links, list):
            for link in links[:5]:
                if not isinstance(link, dict):
                    continue
                label = str(link.get("label") or "").strip()
                q = str(link.get("q") or "").strip()
                if not label or not q:
                    continue
                url = _music_search_url(q) if category == "音乐" else _web_search_url(q)
                link_texts.append(f"{label}（{url}）")
        if link_texts:
            parts.append("；".join(link_texts))

        items.append(CopingRecommendation(
            name=name,
            category=category,
            suggestion="\n".join(parts),
            reason=str(row.get("reason") or "").strip() or "为你个性化生成",
        ))
        if len(items) >= limit:
            break
    return items or None


def build_recommendation_feed(report: RiskReport, limit: int = 6) -> list[CopingRecommendation]:
    """状态推荐：LLM 生成优先，种子库兜底（2026-10-15 升级）。

    LLM 可用时基于「风险等级 + 可解释因素 + 图谱参考方向 + 兴趣画像」生成
    全新条目；生成失败/超时/解析失败时回退种子库拼装，页面永不空白。
    """
    if report.crisis or report.risk_level == "red":
        # 红级不推荐娱乐内容，走预警链路
        return []

    if not neo4j_health():
        # Mock 模式：没有兴趣画像可查，退化为一组内置通用内容（带演示标记），
        # 而不是返回空列表让页面空着；真实模式仍然如实返回空。
        return mock_fallback_feed(limit) if llm_client.mock_mode() else []

    interests_by_cat = _load_interests_by_cat(report.user_id)

    generated = _llm_generate_feed(
        risk_level=report.risk_level,
        risk_label=report.risk_label,
        factors=report.factors,
        directions=[r.name for r in report.recommendations],
        interests_by_cat=interests_by_cat,
        limit=limit,
    )
    if generated:
        return generated

    # 回退：种子库拼装（不再二次调用 LLM——刚失败过，避免再次等待超时）
    return _seed_feed_from_report(report, interests_by_cat, limit)


def _seed_feed_from_report(
    report: RiskReport, interests_by_cat: dict[str, list[str]], limit: int
) -> list[CopingRecommendation]:
    """种子库回退路径（原逻辑保留，2026-10-15 起仅作 LLM 失败/离线兜底）。"""
    feed: list[CopingRecommendation] = []
    for rec in report.recommendations[:limit]:
        content_type = CATEGORY_CONTENT_MAP.get(rec.category or "", "general")
        interest_names = interests_by_cat.get(rec.category or "", [])

        if content_type == "music" and (rec.category in interests_by_cat):
            tracks = _fetch_music_recommendations(interest_names)
            detail = "；".join(f"《{t['title']}》- {t['artist']}（{t['url']}）" for t in tracks)
            suggestion = f"为你挑选了 {len(tracks)} 首与「{interest_names[0]}」相关的歌：{detail}"
            feed.append(CopingRecommendation(
                name=rec.name, category=rec.category,
                suggestion=suggestion, reason=rec.reason,
            ))
        elif content_type == "sports" and (rec.category in interests_by_cat):
            news = _fetch_sports_news(interest_names)
            detail = "；".join(f"{n['title']}（{n['source']}：{n['url']}）" for n in news)
            suggestion = f"你关注的赛事动态：{detail}"
            feed.append(CopingRecommendation(
                name=rec.name, category=rec.category,
                suggestion=suggestion, reason=rec.reason,
            ))
        elif content_type == "film" and (rec.category in interests_by_cat):
            films = _fetch_films(interest_names)
            detail = "；".join(f"{n['title']}（{n['source']}：{n['url']}）" for n in films)
            suggestion = f"为你挑选了这些影视作品：{detail}"
            feed.append(CopingRecommendation(
                name=rec.name, category=rec.category,
                suggestion=suggestion, reason=rec.reason,
            ))
        elif content_type == "book" and (rec.category in interests_by_cat):
            books = _fetch_books(interest_names)
            detail = "；".join(f"{n['title']}（{n['source']}：{n['url']}）" for n in books)
            suggestion = f"为你挑选了这些书籍：{detail}"
            feed.append(CopingRecommendation(
                name=rec.name, category=rec.category,
                suggestion=suggestion, reason=rec.reason,
            ))
        elif content_type == "comic" and (rec.category in interests_by_cat):
            comics = _fetch_comics(interest_names)
            detail = "；".join(f"{n['title']}（{n['source']}：{n['url']}）" for n in comics)
            suggestion = f"为你挑选了这些漫画/动漫：{detail}"
            feed.append(CopingRecommendation(
                name=rec.name, category=rec.category,
                suggestion=suggestion, reason=rec.reason,
            ))
        elif content_type == "food" and (rec.category in interests_by_cat):
            foods = _fetch_food(interest_names)
            detail = "；".join(f"{n['title']}（{n['source']}：{n['url']}）" for n in foods)
            suggestion = f"为你挑选了这些美食内容：{detail}"
            feed.append(CopingRecommendation(
                name=rec.name, category=rec.category,
                suggestion=suggestion, reason=rec.reason,
            ))
        else:
            # 通用内容：每类别只推一次
            if not any(f.category == rec.category and "心理" in (f.suggestion or "") for f in feed):
                articles = _fetch_general_content(1)
                if articles:
                    a = articles[0]
                    feed.append(CopingRecommendation(
                        name=rec.name, category=rec.category,
                        suggestion=f"延伸阅读：《{a['title']}》（{a['source']}：{a['url']}）",
                        reason=rec.reason,
                    ))

    return feed[:limit]


def build_feed_from_interests(user_id: str, limit: int = 4) -> list[CopingRecommendation]:
    """纯兴趣驱动的内容推荐（绿级或日常问询后使用；LLM 生成优先，种子兜底）。

    不依赖推理报告，直接从用户兴趣画像生成内容推送。
    """
    if not neo4j_health():
        # 同上：Mock 模式给内置通用内容，真实模式如实返回空
        return mock_fallback_feed(limit) if llm_client.mock_mode() else []

    interests_by_cat = _load_interests_by_cat(user_id)

    if interests_by_cat:
        generated = _llm_generate_feed(
            risk_level="green",
            risk_label="绿（正常）",
            factors=[],
            directions=[],
            interests_by_cat=interests_by_cat,
            limit=limit,
        )
        if generated:
            return generated

    return _seed_feed_from_interests(interests_by_cat, limit)


def _seed_feed_from_interests(
    interests_by_cat: dict[str, list[str]], limit: int
) -> list[CopingRecommendation]:
    """种子库回退路径（原逻辑保留，2026-10-15 起仅作 LLM 失败/离线兜底）。"""
    feed: list[CopingRecommendation] = []
    for cat, names in interests_by_cat.items():
        content_type = CATEGORY_CONTENT_MAP.get(cat, "general")
        if content_type == "music":
            tracks = _fetch_music_recommendations(names)
            detail = "；".join(f"《{t['title']}》- {t['artist']}（{t['url']}）" for t in tracks)
            feed.append(CopingRecommendation(
                name=f"{cat}推荐", category=cat,
                suggestion=f"为你挑选了 {len(tracks)} 首与「{names[0]}」相关的歌：{detail}",
                reason=f"基于你的「{cat}」兴趣画像",
            ))
        elif content_type == "sports":
            news = _fetch_sports_news(names)
            detail = "；".join(f"{n['title']}（{n['source']}）" for n in news)
            feed.append(CopingRecommendation(
                name=f"{cat}动态", category=cat,
                suggestion=f"你关注的赛事：{detail}",
                reason=f"基于你的「{cat}」兴趣画像",
            ))
        elif content_type == "film":
            films = _fetch_films(names)
            detail = "；".join(f"{n['title']}" for n in films)
            feed.append(CopingRecommendation(
                name=f"{cat}推荐", category=cat,
                suggestion=f"为你挑选了这些影视作品：{detail}",
                reason=f"基于你的「{cat}」兴趣画像",
            ))
        elif content_type == "book":
            books = _fetch_books(names)
            detail = "；".join(f"{n['title']}" for n in books)
            feed.append(CopingRecommendation(
                name=f"{cat}推荐", category=cat,
                suggestion=f"为你挑选了这些书籍：{detail}",
                reason=f"基于你的「{cat}」兴趣画像",
            ))
        elif content_type == "comic":
            comics = _fetch_comics(names)
            detail = "；".join(f"{n['title']}" for n in comics)
            feed.append(CopingRecommendation(
                name=f"{cat}推荐", category=cat,
                suggestion=f"为你挑选了这些漫画/动漫：{detail}",
                reason=f"基于你的「{cat}」兴趣画像",
            ))
        elif content_type == "food":
            foods = _fetch_food(names)
            detail = "；".join(f"{n['title']}" for n in foods)
            feed.append(CopingRecommendation(
                name=f"{cat}推荐", category=cat,
                suggestion=f"为你挑选了这些美食内容：{detail}",
                reason=f"基于你的「{cat}」兴趣画像",
            ))
        if len(feed) >= limit:
            break

    return feed[:limit]
