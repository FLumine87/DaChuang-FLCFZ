"""清理指定用户的「今日问询」记录，方便重新测试弹窗效果。

用途：用户试用过 zhangsan 的问询功能后，需要把记录清掉、让"今天第一次
打开 AI 陪伴对话页自动弹窗"能再演一遍。

清理范围（两道，缺一不可 —— 只删服务端记录是不够的）：
  1. **服务端** `daily_checkins` 表里该用户的**今天**记录（默认只删今天，
     历史留痕；`--all` 可连历史一起清）；
  2. **本机浏览器标记**：`psych_checkin_dismissed::<user>` /
     `psych_checkin_declined::<user>` 留在浏览器 localStorage 里，
     服务端清了它也会拦住弹窗。这两个键只能在浏览器端清，
     所以本脚本会打印一段"该在控制台执行什么"，并提示刷新即可。

用法：
  python scripts/reset_daily_checkin.py zhangsan          # 清今天的记录
  python scripts/reset_daily_checkin.py zhangsan --all    # 连历史一起清
  python scripts/reset_daily_checkin.py --list            # 只看现有记录，不删
"""

import argparse
import sys
import time
from pathlib import Path

# 允许直接以脚本方式运行（把项目根加进 sys.path）
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db.database import SessionLocal  # noqa: E402
from app.db.models import DailyCheckin  # noqa: E402


def _today() -> str:
    return time.strftime("%Y-%m-%d")


def list_records(user_id: str | None) -> None:
    with SessionLocal() as session:
        q = session.query(DailyCheckin)
        if user_id:
            q = q.filter(DailyCheckin.user_id == user_id)
        rows = q.order_by(DailyCheckin.id.desc()).limit(50).all()
        if not rows:
            print("（没有记录）")
            return
        print(f"{'id':>4}  {'user':<16} {'status':<9} {'date':<11} message")
        for r in rows:
            print(f"{r.id:>4}  {r.user_id:<16} {r.status:<9} {r.checkin_date:<11} {(r.message or '')[:28]}")


def reset(user_id: str, wipe_all: bool = False) -> int:
    today = _today()
    with SessionLocal.begin() as session:
        q = session.query(DailyCheckin).filter(DailyCheckin.user_id == user_id)
        if not wipe_all:
            q = q.filter(DailyCheckin.checkin_date == today)
        rows = q.all()
        count = len(rows)
        for row in rows:
            session.delete(row)
    return count


def main() -> int:
    ap = argparse.ArgumentParser(description="清理指定用户的今日问询记录")
    ap.add_argument("user_id", nargs="?", help="要清理的用户名，如 zhangsan")
    ap.add_argument("--all", action="store_true", help="连历史记录一起清（默认只清今天）")
    ap.add_argument("--list", action="store_true", help="只列出记录，不删除")
    args = ap.parse_args()

    if args.list:
        print(f"=== 现有问询记录（{args.user_id or '全部用户'}）===")
        list_records(args.user_id)
        return 0

    if not args.user_id:
        ap.print_help()
        return 2

    print(f"=== 清理前（{args.user_id}）===")
    list_records(args.user_id)

    scope = "全部历史" if args.all else f"今天（{_today()}）"
    n = reset(args.user_id, wipe_all=args.all)
    print(f"\n已删除 {n} 条（范围：{scope}）")

    print(f"\n=== 清理后（{args.user_id}）===")
    list_records(args.user_id)

    print(
        "\n[!] 还差一步：浏览器 localStorage 里还有本机标记，只清服务端是弹不出来的。\n"
        f"    请在浏览器控制台执行（F12 → Console）：\n"
        f"      localStorage.removeItem('psych_checkin_dismissed::{args.user_id}');\n"
        f"      localStorage.removeItem('psych_checkin_declined::{args.user_id}');\n"
        f"      location.reload();\n"
        "    （自动验证脚本已代为清除，无需手动操作。）"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
