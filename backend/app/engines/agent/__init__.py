"""Agent 基础能力。

本包当前只提供证据包构建与安全边界。预警研判、随访任务编排将在后续阶段
建立在这一稳定的数据契约之上。
"""

from app.engines.agent.evidence import build_evidence_pack

__all__ = ["build_evidence_pack"]
