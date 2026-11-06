"""Local acceptance fixture. Uses a temporary database, never the demo/production DB.

Run from backend: python scripts/run_admin_acceptance.py
Then frontend VITE_DEV_PROXY_TARGET=http://127.0.0.1:8016, VITE_USE_MOCK=false,
VITE_ADMIN_DEMO_USERNAME=admin, VITE_ADMIN_DEMO_PASSWORD=admin123, Vite port 5178.
"""
import asyncio
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.config import settings
from app.core.security import get_password_hash
from app.db import database as db
from app.services import agent_individual
from app.server import run_server


def main():
    with tempfile.TemporaryDirectory(prefix="admin-acceptance-") as folder:
        settings.DATABASE_URL = "sqlite:///" + os.path.join(folder, "test.db")
        settings.HASHING_USE_MOCK = True
        settings.ENABLE_MOCK_ENGINES = True
        db.init_db_sync()
        admin = db.query_one("SELECT id FROM users WHERE username='admin'")
        if not admin:
            db.execute("INSERT INTO users(username,password_hash,name,role) VALUES('admin',?,'验收管理员','admin')",
                       (get_password_hash("admin123"),))
        uid = db.execute("INSERT INTO users(username,password_hash,name,role) VALUES('flow-user',?,'验收成员','user')",
                         (get_password_hash("test123"),))
        q = db.execute("INSERT INTO questionnaires(code,name,max_score) VALUES('FLOW','验收量表',27)")
        db.execute("INSERT OR IGNORE INTO questionnaires(code,name,max_score) VALUES('PHQ-9','PHQ-9',27)")
        db.execute("INSERT INTO cases(case_id,user_id,name) VALUES('CASE-FLOW',?,'验收成员')", (uid,))
        db.execute("INSERT INTO screenings(screening_id,user_id,name,questionnaire_id,score,max_score,status,alert_level,screening_date) "
                   "VALUES('SCR-FLOW',?,'验收成员',?,18,27,'completed','orange',CURRENT_TIMESTAMP)", (uid, q))
        db.execute("INSERT INTO alerts(alert_id,user_id,name,level) VALUES('ALT-FLOW',?,'验收成员','orange')", (uid,))
        asyncio.run(agent_individual.run("live", "CASE-FLOW", "验收管理员"))
        yesterday = (datetime.now(timezone(timedelta(hours=8))) - timedelta(days=1)).date().isoformat()
        db.execute("UPDATE agent_workspace_tasks SET due_at=? WHERE scope='live'", (yesterday,))
        try:
            run_server(host="127.0.0.1", port=8016)
        finally:
            if db._local_conn:
                db._local_conn.close()
                db._local_conn = None


if __name__ == "__main__":
    main()
