-- 004_demo_accounts.sql
-- 登录页宣传的两个演示账号（见 frontend/src/pages/LoginPage.tsx 的 fillDemo）：
--   管理端 · 咨询师：adminer / admin  → role=admin
--   个人端演示账号：xiaoyu / 123456   → role=user
--
-- 背景（2026-10-14 修复）：此前后端没有任何种子账号——
--   · xiaoyu 在库里不存在，真实后端模式下「演示账号」登录必失败；
--   · adminer 是经公开注册接口创建的，注册接口按防提权要求固定 role='user'，
--     于是用管理端账号能登录、落地的却是个人端。
-- 本地 sqlite 由 app.db.database.init_db_sync 在每次启动时幂等补齐；
-- 本文件供已部署的 D1 手动执行一次（wrangler d1 execute）。
--
-- 哈希由 app.core.security.get_password_hash 生成（pbkdf2-sha256，29000 轮）。

-- 管理端演示账号：不存在则插入，已存在则纠正角色与密码
INSERT INTO users (username, password_hash, name, role, is_active)
SELECT 'adminer', '$pbkdf2-sha256$29000$G6_yOX0q-MTlAyCpXL2G7Q$T-C-PyZrV5kOWxQuBdyBh41VUE4otZJU0x2642jXSME', 'adminer', 'admin', 1
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'adminer');

UPDATE users SET role = 'admin', password_hash = '$pbkdf2-sha256$29000$G6_yOX0q-MTlAyCpXL2G7Q$T-C-PyZrV5kOWxQuBdyBh41VUE4otZJU0x2642jXSME'
WHERE username = 'adminer';

-- 个人端演示账号：不存在则插入，已存在则纠正角色与密码
INSERT INTO users (username, password_hash, name, role, is_active)
SELECT 'xiaoyu', '$pbkdf2-sha256$29000$BCVzFTpGs1NgiGO6DMZriw$chZRO9aooJzqOCo_7dvouKLduPTeaUZ7pa5RiJhbpd0', 'xiaoyu', 'user', 1
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'xiaoyu');

UPDATE users SET role = 'user', password_hash = '$pbkdf2-sha256$29000$BCVzFTpGs1NgiGO6DMZriw$chZRO9aooJzqOCo_7dvouKLduPTeaUZ7pa5RiJhbpd0'
WHERE username = 'xiaoyu';
