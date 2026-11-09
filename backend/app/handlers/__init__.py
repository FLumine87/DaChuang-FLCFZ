"""路由注册表：(method, path_pattern, handler, auth_level)

auth_level: None=公开 / 'user'=需登录 / 'admin'=需管理员
"""
from app.handlers import (auth, screening, alerts, cases, retrieval, upload,
                          dashboard, personal, admin, knowledge_graph, warning_agent,
                          agent_workspace, review)

ROUTES = [
    ("POST", "/api/personal/retrieval-screening", personal.personal_retrieval_screening, "user"),
    ("POST", "/api/agent-workspace/cases/{case_id}/runs", agent_workspace.run_case, "admin"),
    ("GET", "/api/agent-workspace", agent_workspace.overview, "admin"),
    ("POST", "/api/agent-workspace/runs", agent_workspace.run, "admin"),
    ("GET", "/api/agent-workspace/cases/{case_id}", agent_workspace.case_detail, "admin"),
    ("PUT", "/api/agent-workspace/tasks/{task_id}", agent_workspace.update_task, "admin"),
    # ---- 认证（公开）----
    ("POST", "/api/auth/login", auth.login, None),
    ("POST", "/api/auth/register", auth.register, None),
    ("POST", "/api/auth/logout", auth.logout, None),

    # ---- 个人端 ----
    ("GET", "/api/personal/screenings", personal.get_personal_screenings, "user"),
    ("POST", "/api/personal/screenings", personal.submit_personal_screening, "user"),
    # 「多模态采集」上传成功后把补充挂到记录上（前端 persistCollection 调用）
    ("POST", "/api/personal/screenings/{screening_id}/supplement",
     personal.save_screening_supplement, "user"),
    # 没有筛查记录时挂到用户名下；读取侧用 GET 列表合并展示
    ("POST", "/api/personal/supplements", personal.save_personal_supplement, "user"),
    ("GET", "/api/personal/supplements", personal.get_personal_supplements, "user"),
    ("GET", "/api/personal/dashboard", personal.get_personal_dashboard, "user"),
    ("GET", "/api/personal/warnings", personal.get_personal_warnings, "user"),
    # 个人端自助改自己预警的状态。走的是展示码（ALT-…）而不是主键，
    # 与管理端的 PUT /api/alerts/{int} 是两条不同的路：那条是 admin 角色、
    # 面向处置流转，个人端用不了。
    ("PUT", "/api/personal/warnings/{alert_id}", personal.update_personal_warning, "user"),
    ("GET", "/api/personal/profile", personal.get_personal_profile, "user"),
    ("POST", "/api/personal/search", personal.personal_search, "user"),
    ("POST", "/api/personal/retrieval-assessment", personal.personal_retrieval_assessment, "user"),
    # RAG 深度报告（大模型，20~30s）：与检索接口分离，前端先渲染检索结果、
    # 报告区显示"大模型思考中"，再异步请求本接口
    ("POST", "/api/personal/rag-report", personal.personal_rag_report, "user"),

    # 今日行动计划：待进行 / 归档两个分区由后端一并返回。
    # GET 时会顺带按规则补生成"该提醒的事"（如两周没做量表），因此是幂等的 GET。
    ("GET", "/api/personal/plans", personal.get_personal_plans, "user"),
    ("POST", "/api/personal/plans", personal.create_personal_plan, "user"),
    ("POST", "/api/personal/plans/{plan_id}/complete", personal.complete_personal_plan, "user"),
    # 归档里的「回归」：误标完成时把计划退回待进行
    ("POST", "/api/personal/plans/{plan_id}/restore", personal.restore_personal_plan, "user"),
    ("DELETE", "/api/personal/plans/{plan_id}", personal.delete_personal_plan, "user"),

    # 账号设置（顶栏头像菜单）：改个人信息 + 改密码。
    # auth 用 "user" 级别 = 任何已登录角色，管理端也能用同一套接口。
    ("GET", "/api/account", personal.get_my_account, "user"),
    ("PUT", "/api/account", personal.update_my_account, "user"),
    ("POST", "/api/account/password", personal.change_my_password, "user"),

    # 心理日记：每条记录的便签（写 / 改 / 清空）与删除记录本身
    ("PUT", "/api/personal/supplements/{supplement_id}/note", personal.save_supplement_note, "user"),
    ("DELETE", "/api/personal/supplements/{supplement_id}", personal.delete_personal_supplement, "user"),

    # ---- 管理端 ----
    ("GET", "/api/admin/test", admin.test_admin, "admin"),
    ("GET", "/api/admin/dashboard", admin.get_admin_dashboard, "admin"),
    ("GET", "/api/admin/work-queue", admin.get_admin_work_queue, "admin"),
    ("GET", "/api/admin/screenings", admin.get_admin_screenings, "admin"),
    ("GET", "/api/admin/supplements", admin.get_admin_supplements, "admin"),
    ("GET", "/api/admin/alerts", admin.get_admin_alerts, "admin"),
    ("GET", "/api/admin/alerts/{alert_id}", admin.get_admin_alert_detail, "admin"),
    ("PUT", "/api/admin/alerts/{alert_id}", admin.update_admin_alert, "admin"),
    ("GET", "/api/admin/assignees", admin.get_admin_assignees, "admin"),
    ("GET", "/api/admin/cases", admin.get_admin_cases, "admin"),
    ("GET", "/api/admin/cases/{case_id}", admin.get_admin_case_detail, "admin"),
    ("PUT", "/api/admin/cases/{case_id}", admin.update_admin_case, "admin"),
    ("POST", "/api/admin/cases/{case_id}/timeline", admin.add_admin_case_event, "admin"),
    ("POST", "/api/admin/search", admin.admin_search, "admin"),
    ("GET", "/api/admin/data-collection", admin.get_admin_data_collection, "admin"),
    # ---- 数据审核（新数据进公共池 / 训练池的闸门）----
    ("GET", "/api/admin/review/pending", review.pending, "admin"),
    ("GET", "/api/admin/review/stats", review.stats, "admin"),
    ("POST", "/api/admin/review/batch", review.batch, "admin"),
    ("GET", "/api/admin/review/labels", review.labels, "admin"),
    ("POST", "/api/admin/review/tags", review.set_tags, "admin"),
    ("POST", "/api/admin/review/suggest-tags", review.suggest_tags, "admin"),
    ("POST", "/api/admin/hashing/retrain", review.retrain, "admin"),
    ("GET", "/api/admin/hashing/status", review.retrain_status, "admin"),
    ("GET", "/api/admin/hashing/drift", review.drift, "admin"),
    ("POST", "/api/personal/scope", review.set_scope, "user"),

    # ---- 筛查管理 ----
    ("GET", "/api/screening/questionnaires", screening.list_questionnaires, "user"),
    ("POST", "/api/screening/questionnaires", screening.create_questionnaire, "admin"),
    ("GET", "/api/screening", screening.list_screenings, "admin"),
    ("POST", "/api/screening", screening.create_screening, "admin"),
    ("GET", "/api/screening/{screening_id}", screening.get_screening, "admin"),
    ("PUT", "/api/screening/{screening_id}", screening.update_screening, "admin"),
    ("DELETE", "/api/screening/{screening_id}", screening.delete_screening, "admin"),
    ("POST", "/api/screening/{screening_id}/complete", screening.complete_screening, "admin"),

    # ---- 预警管理 ----
    ("GET", "/api/alerts/rules", alerts.list_rules, "admin"),
    ("POST", "/api/alerts/rules", alerts.create_rule, "admin"),
    ("PUT", "/api/alerts/rules/{rule_id}", alerts.update_rule, "admin"),
    ("DELETE", "/api/alerts/rules/{rule_id}", alerts.delete_rule, "admin"),
    ("GET", "/api/alerts/stats", alerts.get_stats, "admin"),
    ("GET", "/api/alerts", alerts.list_alerts, "admin"),
    ("POST", "/api/alerts", alerts.create_alert, "admin"),
    ("GET", "/api/alerts/{alert_id}", alerts.get_alert, "admin"),
    ("PUT", "/api/alerts/{alert_id}", alerts.update_alert, "admin"),
    ("POST", "/api/alerts/{alert_id}/resolve", alerts.resolve_alert, "admin"),

    # ---- 案例管理 ----
    ("GET", "/api/cases/tags", cases.list_tags, "admin"),
    ("POST", "/api/cases/tags", cases.create_tag, "admin"),
    ("GET", "/api/cases", cases.list_cases, "admin"),
    ("POST", "/api/cases", cases.create_case, "admin"),
    ("GET", "/api/cases/{case_id}", cases.get_case, "admin"),
    ("PUT", "/api/cases/{case_id}", cases.update_case, "admin"),
    ("DELETE", "/api/cases/{case_id}", cases.delete_case, "admin"),
    ("GET", "/api/cases/{case_id}/timeline", cases.get_timeline, "admin"),
    ("POST", "/api/cases/{case_id}/timeline", cases.add_timeline_event, "admin"),

    # ---- 检索分析 ----
    ("POST", "/api/retrieval/search", retrieval.search, "admin"),
    ("GET", "/api/retrieval/index-stats", retrieval.index_stats, "user"),
    ("GET", "/api/retrieval/media/{unit_id}", retrieval.get_media, "user"),
    ("POST", "/api/retrieval/analyze", retrieval.analyze, "admin"),
    ("GET", "/api/retrieval/report/{screening_id}", retrieval.get_report, "admin"),

    # ---- 预警知识图谱（仅返回匿名证据链与人工复核规则）----
    ("GET", "/api/knowledge-graph/overview", knowledge_graph.get_overview, "user"),
    ("GET", "/api/knowledge-graph/screenings/{screening_id}/evidence",
     knowledge_graph.get_screening_evidence, "admin"),
    ("POST", "/api/agents/warning-assessment", warning_agent.assess, "admin"),

    # ---- 文件上传 ----
    ("POST", "/api/upload", upload.upload_file, "user"),
    ("GET", "/api/upload/{file_id}", upload.get_file_info, "user"),
    ("DELETE", "/api/upload/{file_id}", upload.delete_file, "user"),

    # ---- 仪表盘 ----
    ("GET", "/api/dashboard/stats", dashboard.get_stats, "admin"),
    ("GET", "/api/dashboard/recent-alerts", dashboard.get_recent_alerts, "admin"),
    ("GET", "/api/dashboard/summary", dashboard.get_summary, "admin"),
]
