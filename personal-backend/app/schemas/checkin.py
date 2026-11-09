from typing import Literal, Optional

from pydantic import BaseModel, Field

# pending   待回复
# replied   已回复
# declined  用户明确「不想回复」（2026-11-07）：今天不再打扰，也不再出现在待回复列表
# expired   旧的一天的 pending 被自动置为过期（避免积压）
CheckinStatus = Literal["pending", "replied", "declined", "expired"]


class DailyCheckinOut(BaseModel):
    """每日问询记录（落库后返回给前端）。"""

    id: int
    user_id: str
    message: str
    status: str
    reply: str
    source: str
    checkin_date: str
    created_at: str
    replied_at: str


class DailyCheckinEnsureResponse(BaseModel):
    """登录触发「今日问询」的返回。

    `created=False` 说明今天已经有了（复用既有那条），前端照常展示即可；
    这个字段也让"一天只问询一次"这件事在接口层可观测、可断言。

    注意：今天已有记录也可能是 `declined` / `replied` —— 前端**只应在
    `checkin.status == "pending"` 时弹窗**，否则用户点了「不想回复」还弹就是骚扰。
    """

    user_id: str
    created: bool = Field(description="本次是否新建（False=今天已有，直接复用）")
    checkin: Optional[DailyCheckinOut] = None
    message: str = ""
    expired: int = Field(default=0, description="顺带置为过期的往日 pending 条数")
    neo4j_connected: bool = False


class CheckinReplyRequest(BaseModel):
    """用户回复某条问询。"""

    user_id: str = Field(min_length=1, description="回复者，用于校验归属，避免回复他人问询")
    reply: str = Field(min_length=1, description="用户回复原文")


class CheckinDeclineRequest(BaseModel):
    """用户明确「不想回复」某条问询。

    只需要 user_id 做归属校验，不需要任何正文 —— "不想回复"本身就是一种
    完整的意思表示，不该逼用户填理由。
    """

    user_id: str = Field(min_length=1, description="操作者，用于校验归属，避免改动他人问询")


class CheckinReplyResponse(BaseModel):
    checkin: DailyCheckinOut
    # 恒为 0：本接口只做状态流转，三元组抽取统一由 /kg/extract 负责，
    # 避免同一条回复被抽取两次导致图谱 cnt 频次翻倍。保留字段以兼容调用方。
    extracted: int = Field(default=0, description="保留字段，恒为 0（抽取由 /kg/extract 负责）")
    neo4j_connected: bool = False
    mock: bool = False


class CheckinPendingResponse(BaseModel):
    user_id: str
    pending: list[DailyCheckinOut]
    count: int
    neo4j_connected: bool = False
