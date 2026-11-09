"""清理 5/6 项验证产生的测试用户，并对既有用户做回归检查。"""

import sys

sys.path.insert(0, ".")

from neo4j import GraphDatabase

from app.core import neo4j as n

n.reset_driver()

d = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "password"))
with d.session() as s:
    for uid in ["cat_probe", "cat_test_a", "cat_test_b", "checkin_test_user", "e2e_freq_user", "test_freq_user"]:
        s.run("MATCH (u:User {user_id: $uid}) DETACH DELETE u", uid=uid)
    print("测试用户已清理")

    rows = s.run(
        """
        MATCH (u:User)-[r:LIKES|FOLLOWS]->(i:Interest)
        RETURN u.user_id AS uid, i.name AS name, coalesce(r.category, i.category) AS cat
        ORDER BY uid, name LIMIT 8
        """
    ).data()
    print()
    print("=== 既有用户兴趣画像回归 ===")
    for x in rows:
        print("  %-10s %-14s %s" % (x["uid"], x["name"], x["cat"]))

    total = s.run("MATCH (n) RETURN count(n) AS c").single()["c"]
    users = s.run("MATCH (u:User) RETURN collect(DISTINCT u.user_id) AS us").single()["us"]
    print()
    print("库中总节点=%d，用户=%s" % (total, users))

    # 旧的 alerts 表（个人端 SQLite）与新的 daily_checkins 表状态
    print()
    print("=== 个人端 SQLite 表 ===")
d.close()

import sqlite3

c = sqlite3.connect("mental_screening.db")
tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print("  表:", tables)
for t in ("alerts", "daily_checkins"):
    if t in tables:
        cnt = c.execute("SELECT count(*) FROM %s" % t).fetchone()[0]
        print("  %s 条数: %d" % (t, cnt))
c.close()
