"""定时调度器（阶段 3.5）。

基于 APScheduler 的 BackgroundScheduler（后台线程，不依赖 asyncio 循环，
避免与 uvicorn 的事件循环冲突导致进程静默崩溃）。

配置：
- ENABLE_DAILY_CHECKIN=True 启用（默认）
- DAILY_CHECKIN_HOUR / DAILY_CHECKIN_MINUTE 配置触发时间（默认 20:00）

依赖：apscheduler（需 pip install apscheduler）
"""

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from ..config import settings
from . import daily_checkin_agent

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def _checkin_job() -> None:
    """定时任务：对所有用户执行一次日常问询。"""
    try:
        result = daily_checkin_agent.run_daily_checkin()
        for uid, msg in result.items():
            logger.info(f"[daily-checkin] {uid}: {msg[:50]}...")
    except Exception as e:
        logger.error(f"[daily-checkin] 执行失败: {e}")


def start_scheduler() -> None:
    """启动调度器（幂等，重复调用不会创建多个）。"""
    global _scheduler
    if _scheduler is not None:
        logger.info("[scheduler] 已启动，跳过")
        return
    _scheduler = BackgroundScheduler()
    trigger = CronTrigger(
        hour=settings.daily_checkin_hour,
        minute=settings.daily_checkin_minute,
    )
    _scheduler.add_job(_checkin_job, trigger, id="daily_checkin", replace_existing=True)
    _scheduler.start()
    logger.info(
        f"[scheduler] 定时问询已启动，每天 {settings.daily_checkin_hour:02d}:{settings.daily_checkin_minute:02d} 执行"
    )


def stop_scheduler() -> None:
    """停止调度器。"""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("[scheduler] 已停止")
