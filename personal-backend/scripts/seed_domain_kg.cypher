// 迷你心理领域知识图谱种子数据（阶段 2）
// 与论文"领域KG"对应：Disorder - HAS_SYMPTOM -> Symptom
//                        Disorder - HAS_TRIGGER  -> Trigger
//                        Disorder - RECOMMEND_COPING -> Coping
// 说明：Symptom/Trigger/Coping 节点与个人KG共享（同名同节点），
//       个人症状节点因此可直接连到障碍，实现双图谱推理。
// 可重复执行（幂等）。

CREATE CONSTRAINT disorder_name IF NOT EXISTS
FOR (d:Disorder) REQUIRE d.name IS UNIQUE;

// ---------- 实体 ----------

MERGE (:Disorder {name: '广泛性焦虑', description: '长期过度担忧，伴躯体紧张表现'});
MERGE (:Disorder {name: '抑郁发作（轻中度）', description: '持续情绪低落与兴趣减退'});
MERGE (:Disorder {name: '失眠障碍', description: '入睡困难或早醒并影响日间功能'});
MERGE (:Disorder {name: '学业压力反应', description: '重大考核情境下的短期应激反应'});
MERGE (:Disorder {name: '适应障碍（短期）', description: '生活变故后的短期情绪行为失调'});

MERGE (:Symptom {name: '焦虑'});
MERGE (:Symptom {name: '失眠'});
MERGE (:Symptom {name: '早醒'});
MERGE (:Symptom {name: '情绪低落'});
MERGE (:Symptom {name: '兴趣减退'});
MERGE (:Symptom {name: '无价值感'});
MERGE (:Symptom {name: '注意力不集中'});
MERGE (:Symptom {name: '疲惫'});
MERGE (:Symptom {name: '心慌'});
MERGE (:Symptom {name: '食欲下降'});
MERGE (:Symptom {name: '易怒'});
MERGE (:Symptom {name: '回避社交'});

MERGE (:Trigger {name: '考试'});
MERGE (:Trigger {name: '面试'});
MERGE (:Trigger {name: '学业压力'});
MERGE (:Trigger {name: '人际冲突'});
MERGE (:Trigger {name: '深夜'});
MERGE (:Trigger {name: '独处'});
MERGE (:Trigger {name: '分手'});
MERGE (:Trigger {name: '搬家'});

MERGE (:Coping {name: '音乐放松', category: '音乐', suggestion: '听熟悉且舒缓的歌单 20 分钟，可结合用户喜欢的歌手/曲风'});
MERGE (:Coping {name: '规律运动', category: '运动', suggestion: '每周 3 次 30 分钟中等强度运动，如慢跑、球类'});
MERGE (:Coping {name: '正念呼吸', category: '冥想', suggestion: '4-7-8 呼吸法或 5 分钟正念冥想，睡前进行'});
MERGE (:Coping {name: '社交倾诉', category: '社交', suggestion: '与信任的朋友或家人倾诉，表达具体感受'});
MERGE (:Coping {name: '睡眠卫生', category: '作息', suggestion: '固定作息，睡前 1 小时远离屏幕，避免咖啡因'});
MERGE (:Coping {name: '限时担忧', category: '认知', suggestion: '每天设定 15 分钟"担忧时间"，其余时间出现担忧先记录'});
MERGE (:Coping {name: '寻求专业咨询', category: '专业帮助', suggestion: '症状持续两周以上建议预约学校心理咨询或医院就诊'});

// ---------- 广泛性焦虑 ----------

MATCH (d:Disorder {name: '广泛性焦虑'})
MATCH (s:Symptom) WHERE s.name IN ['焦虑','失眠','注意力不集中','疲惫','心慌','易怒']
MERGE (d)-[:HAS_SYMPTOM]->(s);

MATCH (d:Disorder {name: '广泛性焦虑'})
MATCH (t:Trigger) WHERE t.name IN ['学业压力','面试','人际冲突','深夜']
MERGE (d)-[:HAS_TRIGGER]->(t);

MATCH (d:Disorder {name: '广泛性焦虑'})
MATCH (c:Coping) WHERE c.name IN ['正念呼吸','限时担忧','规律运动','音乐放松','寻求专业咨询']
MERGE (d)-[:RECOMMEND_COPING]->(c);

// ---------- 抑郁发作（轻中度） ----------

MATCH (d:Disorder {name: '抑郁发作（轻中度）'})
MATCH (s:Symptom) WHERE s.name IN ['情绪低落','兴趣减退','无价值感','失眠','早醒','食欲下降','疲惫']
MERGE (d)-[:HAS_SYMPTOM]->(s);

MATCH (d:Disorder {name: '抑郁发作（轻中度）'})
MATCH (t:Trigger) WHERE t.name IN ['独处','深夜','分手','人际冲突']
MERGE (d)-[:HAS_TRIGGER]->(t);

MATCH (d:Disorder {name: '抑郁发作（轻中度）'})
MATCH (c:Coping) WHERE c.name IN ['规律运动','社交倾诉','音乐放松','寻求专业咨询']
MERGE (d)-[:RECOMMEND_COPING]->(c);

// ---------- 失眠障碍 ----------

MATCH (d:Disorder {name: '失眠障碍'})
MATCH (s:Symptom) WHERE s.name IN ['失眠','早醒','疲惫','注意力不集中']
MERGE (d)-[:HAS_SYMPTOM]->(s);

MATCH (d:Disorder {name: '失眠障碍'})
MATCH (t:Trigger) WHERE t.name IN ['深夜','学业压力']
MERGE (d)-[:HAS_TRIGGER]->(t);

MATCH (d:Disorder {name: '失眠障碍'})
MATCH (c:Coping) WHERE c.name IN ['睡眠卫生','正念呼吸','音乐放松']
MERGE (d)-[:RECOMMEND_COPING]->(c);

// ---------- 学业压力反应 ----------

MATCH (d:Disorder {name: '学业压力反应'})
MATCH (s:Symptom) WHERE s.name IN ['焦虑','失眠','注意力不集中','易怒','食欲下降']
MERGE (d)-[:HAS_SYMPTOM]->(s);

MATCH (d:Disorder {name: '学业压力反应'})
MATCH (t:Trigger) WHERE t.name IN ['考试','学业压力','面试']
MERGE (d)-[:HAS_TRIGGER]->(t);

MATCH (d:Disorder {name: '学业压力反应'})
MATCH (c:Coping) WHERE c.name IN ['规律运动','正念呼吸','音乐放松','限时担忧']
MERGE (d)-[:RECOMMEND_COPING]->(c);

// ---------- 适应障碍（短期） ----------

MATCH (d:Disorder {name: '适应障碍（短期）'})
MATCH (s:Symptom) WHERE s.name IN ['情绪低落','焦虑','失眠','回避社交','易怒']
MERGE (d)-[:HAS_SYMPTOM]->(s);

MATCH (d:Disorder {name: '适应障碍（短期）'})
MATCH (t:Trigger) WHERE t.name IN ['搬家','分手','独处','人际冲突']
MERGE (d)-[:HAS_TRIGGER]->(t);

MATCH (d:Disorder {name: '适应障碍（短期）'})
MATCH (c:Coping) WHERE c.name IN ['社交倾诉','规律运动','音乐放松','寻求专业咨询']
MERGE (d)-[:RECOMMEND_COPING]->(c);
