"""日期展示格式化。

为什么单独抽出来：这个函数原先在三个文件里各写了一份
（handlers/personal.py、handlers/admin.py、services/case_service.py），
实现都是同一个有 bug 的版本：

    return v.strftime(fmt) if hasattr(v, "strftime") and v else (v or "")

它只处理 datetime。而 sqlite 里存的是**字符串**
（'2026-10-14 13:53:29.910839'），字符串走不到 strftime 分支、
被原样返回，于是微秒级时间戳直接漏到界面上：
个人首页的"记录一下现在"、案例详情的"最近筛查"、
管理端概览与筛查列表都能看到 2026-10-14 13:53:29.910839 这种原始值。

修的时候只在 personal.py 改了一份，管理端还剩 7 处 —— 正是因为"三份拷贝"。
所以这里收敛成唯一实现，三处全部改为调用它，杜绝再次漏改。

行为约定：
  · None / 空串            → fallback（默认空串）
  · datetime / date        → strftime(fmt)
  · 可解析的日期字符串      → 解析后 strftime(fmt)
  · 其他字符串             → 截断到分钟（绝不原样透出微秒）
"""
from datetime import datetime

# 覆盖 sqlite 常见的几种落库写法
_PATTERNS = (
    "%Y-%m-%d %H:%M:%S.%f",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S.%f",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d",
)


def format_dt(value, fmt: str = "%Y-%m-%d", fallback: str = ""):
    """把日期值格式化成展示用字符串。"""
    if not value:
        return fallback
    if hasattr(value, "strftime"):
        return value.strftime(fmt)
    text = str(value).strip()
    for pattern in _PATTERNS:
        try:
            return datetime.strptime(text, pattern).strftime(fmt)
        except ValueError:
            continue
    # 解析不了：至少别把微秒和时区尾巴露出去
    return text[:16] if len(text) > 16 else text
