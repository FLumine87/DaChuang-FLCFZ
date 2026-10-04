"""Agent 第 0 步的轻量回归测试，无需第三方依赖。"""
from app.engines.agent import build_evidence_pack


def main() -> None:
    raw_screening = {
        "id": 7,
        "case_id": 3,
        "name": "不应出现在证据包中的姓名",
        "phone": "13800000000",
        "answers": "不应出现在证据包中的原始作答",
        "notes": "不应出现在证据包中的自由文本",
        "questionnaire_name": "PHQ-9",
        "score": 12,
        "max_score": 27,
        "alert_level": "yellow",
        "consent_status": "unknown",
        "screening_date": "2026-09-29 10:00:00",
    }
    history = [{
        "id": 6, "score": 8, "max_score": 27, "alert_level": "green",
        "screening_date": "2026-09-15 10:00:00",
    }]
    retrieval = {
        "results": [{
            "record_id": "private-case-42",
            "summary": "不应泄露的相似案例摘要",
            "modality": "text",
            "alert_level": "orange",
            "tags": ["睡眠困难"],
            "explain": {"shared_themes": ["压力"]},
        }],
    }
    pack = build_evidence_pack(raw_screening, history, retrieval)
    serialized = repr(pack)
    for forbidden in (
        raw_screening["name"], raw_screening["phone"], raw_screening["answers"],
        raw_screening["notes"], retrieval["results"][0]["record_id"],
        retrieval["results"][0]["summary"],
    ):
        assert forbidden not in serialized, forbidden
    assert pack["trend"]["score_delta_from_previous"] == 4
    assert pack["controls"]["external_llm_allowed"] is False
    assert pack["controls"]["diagnosis_allowed"] is False
    print("agent foundation checks passed")


if __name__ == "__main__":
    main()
