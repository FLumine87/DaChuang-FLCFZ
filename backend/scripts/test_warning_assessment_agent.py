"""预警研判 Agent 的无数据库单元检查。"""
from app.services.warning_assessment_agent import build_assessment


def main() -> None:
    pack = {
        "subject_ref": "S-TEST",
        "screening": {
            "questionnaire": "PHQ-9",
            "score": 18,
            "max_score": 27,
            "alert_level": "red",
        },
        "trend": {"score_delta_from_previous": 5},
        "controls": {"requires_human_review": True},
    }
    rules = [
        {
            "rule_key": "agent.high-risk-human-review",
            "requires_human_review": True,
            "recommended_actions": ["action.counselor_review"],
        },
        {
            "rule_key": "agent.red-crisis-review",
            "requires_human_review": True,
            "recommended_actions": ["action.crisis_review"],
        },
    ]
    result = build_assessment(pack, [{"path_id": "demo"}], rules)
    assert result["requires_human_review"] is True
    assert result["diagnosis_allowed"] is False
    assert result["automatic_intervention_allowed"] is False
    assert {task["task_key"] for task in result["proposed_tasks"]} == {
        "counselor-review", "crisis-review"
    }
    print("warning assessment agent checks passed")


if __name__ == "__main__":
    main()
