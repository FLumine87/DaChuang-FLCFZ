"""路由注册表：(method, path_pattern, handler, auth_level)

auth_level: None=公开 / 'user'=需登录 / 'admin'=需管理员
"""
from app.handlers import (auth, screening, alerts, cases, retrieval, upload,
                          dashboard, personal, admin)

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
    ("GET", "/api/admin/cases", admin.get_admin_cases, "admin"),
    ("POST", "/api/admin/search", admin.admin_search, "admin"),
    ("GET", "/api/admin/data-collection", admin.get_admin_data_collection, "admin"),

    # ---- 筛查管理 ----
    ("GET", "/api/screening/questionnaires", screening.list_questionnaires, "user"),
    ("POST", "/api/screening/questionnaires", screening.create_questionnaire, "admin"),
    ("GET", "/api/screening", screening.list_screenings, "user"),
    ("POST", "/api/screening", screening.create_screening, "user"),
    ("GET", "/api/screening/{screening_id}", screening.get_screening, "user"),
    ("PUT", "/api/screening/{screening_id}", screening.update_screening, "user"),
    ("DELETE", "/api/screening/{screening_id}", screening.delete_screening, "admin"),
    ("POST", "/api/screening/{screening_id}/complete", screening.complete_screening, "user"),

    # ---- 预警管理 ----
    ("GET", "/api/alerts/rules", alerts.list_rules, "admin"),
    ("POST", "/api/alerts/rules", alerts.create_rule, "admin"),
    ("PUT", "/api/alerts/rules/{rule_id}", alerts.update_rule, "admin"),
    ("DELETE", "/api/alerts/rules/{rule_id}", alerts.delete_rule, "admin"),
    ("GET", "/api/alerts/stats", alerts.get_stats, "user"),
    ("GET", "/api/alerts", alerts.list_alerts, "user"),
    ("POST", "/api/alerts", alerts.create_alert, "user"),
    ("GET", "/api/alerts/{alert_id}", alerts.get_alert, "user"),
    ("PUT", "/api/alerts/{alert_id}", alerts.update_alert, "user"),
    ("POST", "/api/alerts/{alert_id}/resolve", alerts.resolve_alert, "user"),

    # ---- 案例管理 ----
    ("GET", "/api/cases/tags", cases.list_tags, "user"),
    ("POST", "/api/cases/tags", cases.create_tag, "admin"),
    ("GET", "/api/cases", cases.list_cases, "user"),
    ("POST", "/api/cases", cases.create_case, "user"),
    ("GET", "/api/cases/{case_id}", cases.get_case, "user"),
    ("PUT", "/api/cases/{case_id}", cases.update_case, "user"),
    ("DELETE", "/api/cases/{case_id}", cases.delete_case, "admin"),
    ("GET", "/api/cases/{case_id}/timeline", cases.get_timeline, "user"),
    ("POST", "/api/cases/{case_id}/timeline", cases.add_timeline_event, "user"),

    # ---- 检索分析 ----
    ("POST", "/api/retrieval/search", retrieval.search, "user"),
    ("POST", "/api/retrieval/analyze", retrieval.analyze, "user"),
    ("GET", "/api/retrieval/report/{screening_id}", retrieval.get_report, "user"),

    # ---- 文件上传 ----
    ("POST", "/api/upload", upload.upload_file, "user"),
    ("GET", "/api/upload/{file_id}", upload.get_file_info, "user"),
    ("DELETE", "/api/upload/{file_id}", upload.delete_file, "user"),

    # ---- 仪表盘 ----
    ("GET", "/api/dashboard/stats", dashboard.get_stats, "user"),
    ("GET", "/api/dashboard/recent-alerts", dashboard.get_recent_alerts, "user"),
    ("GET", "/api/dashboard/summary", dashboard.get_summary, "user"),
]
