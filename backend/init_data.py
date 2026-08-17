from app.db.session import SessionLocal, init_db
from app.db.models.user import User
from app.db.models.screening import Questionnaire, Screening
from app.db.models.alert import AlertRule, Alert
from app.db.models.case import CaseTagMaster, Case
from app.db.models.media import MediaFile
from app.core.security import get_password_hash
from datetime import datetime, timedelta


def init_sample_data():
    init_db()
    db = SessionLocal()
    
    try:
        if db.query(User).count() > 0:
            print("Database already has data, skipping initialization.")
            return
        
        print("Initializing sample data...")
        
        admin = User(
            username="admin",
            password_hash=get_password_hash("admin123"),
            name="管理员",
            role="admin",
            department="心理健康中心",
        )
        db.add(admin)
        
        counselor = User(
            username="li_teacher",
            password_hash=get_password_hash("123456"),
            name="李老师",
            role="counselor",
            department="心理健康中心",
            phone="13800138001",
        )
        db.add(counselor)
        
        questionnaires = [
            Questionnaire(
                code="PHQ-9",
                name="PHQ-9 抑郁筛查",
                description="评估过去两周抑郁症状程度",
                max_score=27,
            ),
            Questionnaire(
                code="GAD-7",
                name="GAD-7 焦虑筛查",
                description="评估焦虑水平与紧张程度",
                max_score=21,
            ),
            Questionnaire(
                code="ISI",
                name="ISI 失眠评估",
                description="评估入睡、维持睡眠和早醒问题",
                max_score=28,
            ),
            Questionnaire(
                code="PSS-10",
                name="PSS-10 压力量表",
                description="评估近期主观压力感知",
                max_score=40,
            ),
            Questionnaire(
                code="SCL-90",
                name="症状自评量表",
                description="90项症状自评量表，评估多种心理症状",
                max_score=450,
            ),
        ]
        db.add_all(questionnaires)
        
        alert_rules = [
            AlertRule(
                name="PHQ-9重度抑郁",
                questionnaire_id=1,
                min_score=15,
                max_score=27,
                alert_level="red",
                description="PHQ-9得分≥15，提示重度抑郁",
                priority=10,
            ),
            AlertRule(
                name="PHQ-9中度抑郁",
                questionnaire_id=1,
                min_score=10,
                max_score=14,
                alert_level="orange",
                description="PHQ-9得分10-14，提示中度抑郁",
                priority=9,
            ),
            AlertRule(
                name="PHQ-9轻度抑郁",
                questionnaire_id=1,
                min_score=5,
                max_score=9,
                alert_level="yellow",
                description="PHQ-9得分5-9，提示轻度抑郁",
                priority=8,
            ),
            AlertRule(
                name="GAD-7重度焦虑",
                questionnaire_id=2,
                min_score=15,
                max_score=21,
                alert_level="red",
                description="GAD-7得分≥15，提示重度焦虑",
                priority=10,
            ),
            AlertRule(
                name="GAD-7中度焦虑",
                questionnaire_id=2,
                min_score=10,
                max_score=14,
                alert_level="orange",
                description="GAD-7得分10-14，提示中度焦虑",
                priority=9,
            ),
        ]
        db.add_all(alert_rules)
        
        tags = [
            CaseTagMaster(name="抑郁", color="#ef4444"),
            CaseTagMaster(name="焦虑", color="#f97316"),
            CaseTagMaster(name="压力", color="#f59e0b"),
            CaseTagMaster(name="睡眠问题", color="#84cc16"),
            CaseTagMaster(name="人际关系", color="#22c55e"),
            CaseTagMaster(name="学业问题", color="#14b8a6"),
            CaseTagMaster(name="家庭问题", color="#06b6d4"),
            CaseTagMaster(name="情感问题", color="#3b82f6"),
            CaseTagMaster(name="自伤风险", color="#dc2626"),
            CaseTagMaster(name="躯体化", color="#8b5cf6"),
        ]
        db.add_all(tags)
        
        # 提交以获取ID
        db.commit()
        
        # 重新获取用户ID
        admin = db.query(User).filter(User.username == "admin").first()
        counselor = db.query(User).filter(User.username == "li_teacher").first()
        
        # 获取问卷ID
        phq9 = db.query(Questionnaire).filter(Questionnaire.code == "PHQ-9").first()
        gad7 = db.query(Questionnaire).filter(Questionnaire.code == "GAD-7").first()
        scl90 = db.query(Questionnaire).filter(Questionnaire.code == "SCL-90").first()
        
        # 添加筛查记录
        screenings = [
            Screening(
                screening_id="SCR-001",
                name="张三",
                age=20,
                gender="男",
                department="计算机学院",
                questionnaire_id=phq9.id,
                score=18,
                max_score=phq9.max_score,
                status="completed",
                alert_level="red",
                counselor_id=counselor.id,
                screening_date=datetime.now() - timedelta(days=2),
            ),
            Screening(
                screening_id="SCR-002",
                name="李四",
                age=22,
                gender="女",
                department="文学院",
                questionnaire_id=gad7.id,
                score=12,
                max_score=gad7.max_score,
                status="completed",
                alert_level="orange",
                counselor_id=counselor.id,
                screening_date=datetime.now() - timedelta(days=3),
            ),
            Screening(
                screening_id="SCR-003",
                name="王五",
                age=19,
                gender="男",
                department="理学院",
                questionnaire_id=scl90.id,
                score=180,
                max_score=scl90.max_score,
                status="completed",
                alert_level="yellow",
                counselor_id=counselor.id,
                screening_date=datetime.now() - timedelta(days=3),
            ),
            Screening(
                screening_id="SCR-004",
                name="赵六",
                age=21,
                gender="女",
                department="艺术学院",
                questionnaire_id=phq9.id,
                score=4,
                max_score=phq9.max_score,
                status="completed",
                alert_level="green",
                counselor_id=counselor.id,
                screening_date=datetime.now() - timedelta(days=4),
            ),
            Screening(
                screening_id="SCR-005",
                name="孙七",
                age=23,
                gender="男",
                department="工学院",
                questionnaire_id=gad7.id,
                score=15,
                max_score=gad7.max_score,
                status="completed",
                alert_level="red",
                counselor_id=counselor.id,
                screening_date=datetime.now() - timedelta(days=4),
            ),
            Screening(
                screening_id="SCR-006",
                name="周八",
                age=20,
                gender="女",
                department="经管学院",
                questionnaire_id=phq9.id,
                score=8,
                max_score=phq9.max_score,
                status="in_progress",
                alert_level="yellow",
                counselor_id=counselor.id,
                screening_date=datetime.now() - timedelta(days=5),
            ),
            Screening(
                screening_id="SCR-007",
                name="吴九",
                age=21,
                gender="男",
                department="农学院",
                questionnaire_id=scl90.id,
                score=120,
                max_score=scl90.max_score,
                status="completed",
                alert_level="green",
                counselor_id=counselor.id,
                screening_date=datetime.now() - timedelta(days=5),
            ),
            Screening(
                screening_id="SCR-008",
                name="郑十",
                age=22,
                gender="女",
                department="医学院",
                questionnaire_id=gad7.id,
                score=10,
                max_score=gad7.max_score,
                status="pending",
                alert_level="orange",
                counselor_id=counselor.id,
                screening_date=datetime.now() - timedelta(days=6),
            ),
        ]
        db.add_all(screenings)
        
        # 提交以获取筛查ID
        db.commit()
        
        # 添加预警记录
        alerts = [
            Alert(
                alert_id="ALT-001",
                screening_id=screenings[0].id,
                name="张三",
                level="red",
                trigger="PHQ-9 得分 18 (≥15)",
                description="重度抑郁倾向，存在自伤风险条目阳性",
                status="processing",
                assignee_id=counselor.id,
                created_at=datetime.now() - timedelta(days=2, hours=1),
            ),
            Alert(
                alert_id="ALT-002",
                screening_id=screenings[4].id,
                name="孙七",
                level="red",
                trigger="GAD-7 得分 15 (≥15)",
                description="重度焦虑，伴有躯体化症状",
                status="pending",
                assignee_id=counselor.id,
                created_at=datetime.now() - timedelta(days=4, hours=2),
            ),
            Alert(
                alert_id="ALT-003",
                screening_id=screenings[1].id,
                name="李四",
                level="orange",
                trigger="GAD-7 得分 12 (≥10)",
                description="中度焦虑，建议进一步评估",
                status="processing",
                assignee_id=counselor.id,
                created_at=datetime.now() - timedelta(days=3, hours=3),
            ),
            Alert(
                alert_id="ALT-004",
                screening_id=screenings[2].id,
                name="王五",
                level="yellow",
                trigger="SCL-90 总分 180 (≥160)",
                description="轻度心理问题，建议关注",
                status="resolved",
                assignee_id=counselor.id,
                created_at=datetime.now() - timedelta(days=3, hours=4),
                resolved_at=datetime.now() - timedelta(days=2),
            ),
            Alert(
                alert_id="ALT-005",
                screening_id=screenings[7].id,
                name="郑十",
                level="orange",
                trigger="GAD-7 得分 10 (≥10)",
                description="中度焦虑倾向",
                status="pending",
                assignee_id=counselor.id,
                created_at=datetime.now() - timedelta(days=6, hours=5),
            ),
        ]
        db.add_all(alerts)
        
        # 添加案例记录
        cases = [
            Case(
                case_id="CASE-001",
                name="张三",
                age=20,
                gender="男",
                department="计算机学院",
                status="active",
                alert_level="red",
                screening_count=3,
                last_screening_date=datetime.now() - timedelta(days=2),
                created_at=datetime.now() - timedelta(days=30),
            ),
            Case(
                case_id="CASE-002",
                name="李四",
                age=22,
                gender="女",
                department="文学院",
                status="active",
                alert_level="orange",
                screening_count=2,
                last_screening_date=datetime.now() - timedelta(days=3),
                created_at=datetime.now() - timedelta(days=20),
            ),
            Case(
                case_id="CASE-003",
                name="王五",
                age=19,
                gender="男",
                department="理学院",
                status="monitoring",
                alert_level="yellow",
                screening_count=4,
                last_screening_date=datetime.now() - timedelta(days=3),
                created_at=datetime.now() - timedelta(days=45),
            ),
            Case(
                case_id="CASE-004",
                name="赵六",
                age=21,
                gender="女",
                department="艺术学院",
                status="closed",
                alert_level="green",
                screening_count=1,
                last_screening_date=datetime.now() - timedelta(days=4),
                created_at=datetime.now() - timedelta(days=15),
            ),
            Case(
                case_id="CASE-005",
                name="孙七",
                age=23,
                gender="男",
                department="工学院",
                status="active",
                alert_level="red",
                screening_count=2,
                last_screening_date=datetime.now() - timedelta(days=4),
                created_at=datetime.now() - timedelta(days=25),
            ),
            Case(
                case_id="CASE-006",
                name="周八",
                age=20,
                gender="女",
                department="经管学院",
                status="monitoring",
                alert_level="yellow",
                screening_count=1,
                last_screening_date=datetime.now() - timedelta(days=5),
                created_at=datetime.now() - timedelta(days=10),
            ),
        ]
        db.add_all(cases)
        
        db.commit()
        print("Sample data initialized successfully!")
        
    except Exception as e:
        print(f"Error initializing data: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    init_sample_data()
