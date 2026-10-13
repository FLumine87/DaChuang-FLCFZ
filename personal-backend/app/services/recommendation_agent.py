"""缓解推荐 Agent（阶段 3，阶段 3.5 扩展兴趣类别）。

从推理报告的兴趣画像出发，将"应对方式"映射为具体的个性化缓解内容：
- 音乐类兴趣 → 真实歌单 / 歌曲推荐（NetEaseCloudMusicApi + 内置种子兜底）
- 体育赛事类兴趣 → 关注的球队/赛事动态（聚合种子）
- 影视类兴趣 → 热门剧集/电影推荐（种子库）
- 书籍/小说类兴趣 → 书单推荐（种子库）
- 漫画/动漫类兴趣 → 热门漫画推荐（种子库）
- 美食类兴趣 → 美食推荐（种子库）
- 其他类 → 通用心理科普/活动推荐

数据源策略（可配置）：
- MUSIC_API_URL：自建 NetEaseCloudMusicApi 实例（可选，不配则用内置种子）
- ENABLE_LLM_CONTENT=True 时由 LLM 生成摘要文案，失败回退模板

轻中度（绿/黄/橙）风险时由推理链路自动附带推荐；红级跳过（走预警）。
"""

import json
import random
import time

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


def _llm_content_brief(items: list[dict], interest_hint: str, risk_label: str) -> str:
    if not getattr(settings, "enable_llm_content", True):
        return ""
    prompt = (
        "你是心理健康内容推荐助手。用户当前风险等级为【{risk}】，兴趣方向：{interest}。"
        "基于以下条目写一段 80 字以内的推荐语，语气温暖支持性，提醒适度使用、注意休息，不要医疗建议。"
        "条目：{items}"
    ).format(risk=risk_label, interest=interest_hint, items=json.dumps(items, ensure_ascii=False))
    return llm_client.chat(prompt, "")


def build_recommendation_feed(report: RiskReport, limit: int = 6) -> list[CopingRecommendation]:
    """将推理报告的 recommendations 展开为带具体内容的缓解推送列表。

    返回的 CopingRecommendation.suggestion 中填充具体内容（歌曲/资讯标题 + 链接）。
    """
    if report.crisis or report.risk_level == "red":
        # 红级不推荐娱乐内容，走预警链路
        return []

    if not neo4j_health():
        # Mock 模式：没有兴趣画像可查，退化为一组内置通用内容（带演示标记），
        # 而不是返回空列表让页面空着；真实模式仍然如实返回空。
        return mock_fallback_feed(limit) if llm_client.mock_mode() else []

    # 拉用户兴趣画像（按 category 分组）
    driver = get_driver()
    with driver.session() as session:
        rows = session.run(
            "MATCH (u:User {user_id:$uid})-[:LIKES|FOLLOWS]->(i:Interest) "
            "RETURN i.name AS name, i.category AS category",
            uid=report.user_id,
        ).data()
    interests_by_cat: dict[str, list[str]] = {}
    for r in rows:
        if r.get("category"):
            interests_by_cat.setdefault(r["category"], []).append(r["name"])

    feed: list[CopingRecommendation] = []
    for rec in report.recommendations[:limit]:
        content_type = CATEGORY_CONTENT_MAP.get(rec.category or "", "general")
        interest_names = interests_by_cat.get(rec.category or "", [])

        if content_type == "music" and (rec.category in interests_by_cat):
            tracks = _fetch_music_recommendations(interest_names)
            detail = "；".join(f"《{t['title']}》- {t['artist']}（{t['url']}）" for t in tracks)
            suggestion = f"为你挑选了 {len(tracks)} 首与「{interest_names[0]}」相关的歌：{detail}"
            brief = _llm_content_brief(tracks, rec.category or "音乐", report.risk_label)
            if brief:
                suggestion = f"{brief}\n{suggestion}"
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
            brief = _llm_content_brief(films, rec.category or "影视", report.risk_label)
            if brief:
                suggestion = f"{brief}\n{suggestion}"
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
    """纯兴趣驱动的内容推荐（绿级或日常问询后使用）。

    不依赖推理报告，直接从用户兴趣画像生成内容推送。
    """
    if not neo4j_health():
        # 同上：Mock 模式给内置通用内容，真实模式如实返回空
        return mock_fallback_feed(limit) if llm_client.mock_mode() else []

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
