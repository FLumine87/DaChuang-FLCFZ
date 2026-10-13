// 个人心理知识图谱本体初始化
// 在 Neo4j Browser 中逐条执行，或运行 scripts/init_kg.py

// 唯一性约束（同时起到索引作用）
CREATE CONSTRAINT user_user_id IF NOT EXISTS
FOR (u:User) REQUIRE u.user_id IS UNIQUE;

CREATE CONSTRAINT interest_name IF NOT EXISTS
FOR (n:Interest) REQUIRE n.name IS UNIQUE;

CREATE CONSTRAINT emotion_name IF NOT EXISTS
FOR (n:Emotion) REQUIRE n.name IS UNIQUE;

CREATE CONSTRAINT symptom_name IF NOT EXISTS
FOR (n:Symptom) REQUIRE n.name IS UNIQUE;

CREATE CONSTRAINT lifeevent_name IF NOT EXISTS
FOR (n:LifeEvent) REQUIRE n.name IS UNIQUE;

CREATE CONSTRAINT trigger_name IF NOT EXISTS
FOR (n:Trigger) REQUIRE n.name IS UNIQUE;

CREATE CONSTRAINT coping_name IF NOT EXISTS
FOR (n:Coping) REQUIRE n.name IS UNIQUE;

// 查询索引
CREATE INDEX user_created IF NOT EXISTS
FOR (u:User) ON (u.created_at);
