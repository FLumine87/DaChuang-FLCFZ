"""路由注册表：(method, path_pattern, handler, auth_level)

auth_level: None=公开 / 'user'=需登录 / 'admin'=需管理员
"""
from app.handlers import (auth, screening, alerts, cases, retrieval, upload,
                          dashboard, personal, admin, knowledge_graph, warning_agent)

ROUTES = [
    # ---- 认证（公开）----
    ("POST", "/api/auth/login", auth.login, None),
    ("POST", "/api/auth/register", auth.register, None),
    ("POST", "/api/auth/logout", auth.logout, None),

    # ---- 个人端 ----
    ("GET", "/api/personal/screenings", personal.get_personal_screenings, "user"),
    ("POST", "/api/personal/screenings", personal.submit_personal_screening, "user"),
    ("GET", "/api/personal/dashboard", personal.get_personal_dashboard, "user"),
    ("GET", "/api/personal/warnings", personal.get_personal_warnings, "user"),
    ("GET", "/api/personal/profile", personal.get_personal_profile, "user"),
    ("POST", "/api/personal/search", personal.personal_search, "user"),

    # ---- 管理端 ----
    ("GET", "/api/admin/test", admin.test_admin, "admin"),
    ("GET", "/api/admin/dashboard", admin.get_admin_dashboard, "admin"),
    ("GET", "/api/admin/screenings", admin.get_admin_screenings, "admin"),
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
