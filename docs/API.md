# 心理筛查预警系统 API 接口文档

## 基础信息

| 项目 | 说明 |
|------|------|
| 基础URL | `http://localhost:8000/api/v1` |
| API版本 | v1.0.0 |
| 数据格式 | JSON |
| 字符编码 | UTF-8 |
| 在线文档 | `http://localhost:8000/docs` (Swagger UI) |

## 通用说明

### 统一响应格式

所有接口均返回统一的 JSON 格式：

```json
{
  "code": 0,
  "message": "success",
  "data": { ... }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| code | int | 状态码，0 表示成功，非 0 表示失败 |
| message | string | 响应消息 |
| data | object/array/null | 响应数据 |

### 分页响应格式

列表接口返回分页数据：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [ ... ],
    "total": 100,
    "page": 1,
    "page_size": 10,
    "total_pages": 10
  }
}
```

### 错误响应格式

```json
{
  "detail": "错误描述信息"
}
```

### HTTP 状态码说明

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 400 | 请求参数错误 |
| 404 | 资源不存在 |
| 422 | 请求体验证失败 |
| 500 | 服务器内部错误 |

---

## 1. 筛查管理模块

### 1.1 获取量表列表

**请求**
```
GET /screening/questionnaires
```

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1,
      "code": "PHQ-9",
      "name": "患者健康问卷抑郁量表",
      "description": "用于抑郁症筛查的标准化量表",
      "max_score": 27,
      "is_active": 1,
      "created_at": "2024-01-01T00:00:00"
    }
  ]
}
```

### 1.2 创建量表

**请求**
```
POST /screening/questionnaires
```

**请求体**
```json
{
  "code": "GAD-7",
  "name": "广泛性焦虑量表",
  "description": "用于焦虑症筛查的标准化量表",
  "max_score": 21,
  "questions": "问卷题目JSON字符串",
  "scoring_rules": "评分规则JSON字符串"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| code | string | 是 | 量表编码，唯一标识 |
| name | string | 是 | 量表名称 |
| description | string | 否 | 量表描述 |
| max_score | int | 是 | 最高分值 |
| questions | string | 否 | 问卷题目(JSON格式) |
| scoring_rules | string | 否 | 评分规则(JSON格式) |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 2,
    "code": "GAD-7",
    "name": "广泛性焦虑量表",
    "description": "用于焦虑症筛查的标准化量表",
    "max_score": 21,
    "is_active": 1,
    "created_at": "2024-01-01T00:00:00"
  }
}
```

### 1.3 获取筛查记录列表

**请求**
```
GET /screening?page=1&page_size=10&status=&alert_level=&questionnaire_id=&keyword=
```

**查询参数**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| page | int | 否 | 1 | 页码，最小值 1 |
| page_size | int | 否 | 10 | 每页数量，范围 1-100 |
| status | string | 否 | - | 筛查状态：pending/completed/cancelled |
| alert_level | string | 否 | - | 预警等级：green/yellow/orange/red |
| questionnaire_id | int | 否 | - | 量表ID |
| keyword | string | 否 | - | 搜索关键词(姓名) |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [
      {
        "id": 1,
        "screening_id": "SCR-20240101-0001",
        "name": "张三",
        "age": 20,
        "gender": "male",
        "questionnaire_name": "PHQ-9",
        "score": 15,
        "max_score": 27,
        "status": "completed",
        "alert_level": "orange",
        "screening_date": "2024-01-01T10:00:00",
        "created_at": "2024-01-01T09:00:00"
      }
    ],
    "total": 100,
    "page": 1,
    "page_size": 10,
    "total_pages": 10
  }
}
```

### 1.4 创建筛查记录

**请求**
```
POST /screening
```

**请求体**
```json
{
  "name": "张三",
  "age": 20,
  "gender": "male",
  "department": "计算机学院",
  "phone": "13800138000",
  "questionnaire_id": 1,
  "answers": "{\"q1\":1,\"q2\":2,\"q3\":3}",
  "notes": "备注信息"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 受测者姓名 |
| age | int | 否 | 年龄 |
| gender | string | 否 | 性别：male/female |
| department | string | 否 | 院系/部门 |
| phone | string | 否 | 联系电话 |
| questionnaire_id | int | 是 | 量表ID |
| answers | string | 否 | 答案(JSON格式) |
| notes | string | 否 | 备注 |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "screening_id": "SCR-20240101-0001",
    "name": "张三",
    "age": 20,
    "gender": "male",
    "department": "计算机学院",
    "phone": "13800138000",
    "questionnaire_id": 1,
    "questionnaire_name": "PHQ-9",
    "score": 0,
    "max_score": 27,
    "status": "pending",
    "alert_level": "green",
    "counselor_id": null,
    "counselor_name": null,
    "notes": "备注信息",
    "screening_date": null,
    "created_at": "2024-01-01T09:00:00",
    "updated_at": "2024-01-01T09:00:00"
  }
}
```

### 1.5 获取筛查记录详情

**请求**
```
GET /screening/{screening_id}
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| screening_id | int | 筛查记录ID |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "screening_id": "SCR-20240101-0001",
    "name": "张三",
    "age": 20,
    "gender": "male",
    "department": "计算机学院",
    "phone": "13800138000",
    "questionnaire_id": 1,
    "questionnaire_name": "PHQ-9",
    "score": 15,
    "max_score": 27,
    "status": "completed",
    "alert_level": "orange",
    "counselor_id": 1,
    "counselor_name": "李老师",
    "notes": "备注信息",
    "answers": "{\"q1\":1,\"q2\":2,\"q3\":3}",
    "media_files": [],
    "screening_date": "2024-01-01T10:00:00",
    "created_at": "2024-01-01T09:00:00",
    "updated_at": "2024-01-01T10:00:00"
  }
}
```

### 1.6 更新筛查记录

**请求**
```
PUT /screening/{screening_id}
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| screening_id | int | 筛查记录ID |

**请求体**
```json
{
  "name": "张三",
  "age": 21,
  "gender": "male",
  "department": "计算机学院",
  "phone": "13800138001",
  "answers": "{\"q1\":1,\"q2\":2,\"q3\":3}",
  "score": 15,
  "status": "completed",
  "notes": "更新备注"
}
```

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "screening_id": "SCR-20240101-0001",
    "name": "张三",
    "age": 21,
    "gender": "male",
    "department": "计算机学院",
    "phone": "13800138001",
    "questionnaire_id": 1,
    "questionnaire_name": "PHQ-9",
    "score": 15,
    "max_score": 27,
    "status": "completed",
    "alert_level": "orange",
    "counselor_id": 1,
    "counselor_name": "李老师",
    "notes": "更新备注",
    "screening_date": "2024-01-01T10:00:00",
    "created_at": "2024-01-01T09:00:00",
    "updated_at": "2024-01-01T11:00:00"
  }
}
```

### 1.7 删除筛查记录

**请求**
```
DELETE /screening/{screening_id}
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| screening_id | int | 筛查记录ID |

**响应**
```json
{
  "code": 0,
  "message": "删除成功",
  "data": null
}
```

### 1.8 完成筛查

**请求**
```
POST /screening/{screening_id}/complete?score=15
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| screening_id | int | 筛查记录ID |

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| score | int | 是 | 筛查得分 |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "screening_id": "SCR-20240101-0001",
    "name": "张三",
    "score": 15,
    "max_score": 27,
    "status": "completed",
    "alert_level": "orange",
    "created_at": "2024-01-01T09:00:00",
    "updated_at": "2024-01-01T10:00:00"
  }
}
```

---

## 2. 预警管理模块

### 2.1 获取预警规则列表

**请求**
```
GET /alerts/rules
```

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1,
      "name": "PHQ-9高风险规则",
      "questionnaire_id": 1,
      "min_score": 15,
      "max_score": 27,
      "alert_level": "red",
      "description": "得分15分以上触发红色预警",
      "is_active": 1,
      "priority": 0,
      "created_at": "2024-01-01T00:00:00"
    }
  ]
}
```

### 2.2 创建预警规则

**请求**
```
POST /alerts/rules
```

**请求体**
```json
{
  "name": "PHQ-9中风险规则",
  "questionnaire_id": 1,
  "min_score": 10,
  "max_score": 14,
  "alert_level": "orange",
  "description": "得分10-14分触发橙色预警",
  "priority": 1
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 规则名称 |
| questionnaire_id | int | 否 | 关联量表ID |
| min_score | int | 否 | 最低分数阈值 |
| max_score | int | 否 | 最高分数阈值 |
| alert_level | string | 是 | 预警等级：green/yellow/orange/red |
| description | string | 否 | 规则描述 |
| priority | int | 否 | 优先级，默认 0 |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 2,
    "name": "PHQ-9中风险规则",
    "questionnaire_id": 1,
    "min_score": 10,
    "max_score": 14,
    "alert_level": "orange",
    "description": "得分10-14分触发橙色预警",
    "is_active": 1,
    "priority": 1,
    "created_at": "2024-01-01T00:00:00"
  }
}
```

### 2.3 更新预警规则

**请求**
```
PUT /alerts/rules/{rule_id}
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| rule_id | int | 规则ID |

**请求体**
```json
{
  "name": "更新后的规则名称",
  "min_score": 12,
  "max_score": 16,
  "alert_level": "orange",
  "description": "更新后的描述",
  "is_active": 1,
  "priority": 2
}
```

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "name": "更新后的规则名称",
    "questionnaire_id": 1,
    "min_score": 12,
    "max_score": 16,
    "alert_level": "orange",
    "description": "更新后的描述",
    "is_active": 1,
    "priority": 2,
    "created_at": "2024-01-01T00:00:00"
  }
}
```

### 2.4 删除预警规则

**请求**
```
DELETE /alerts/rules/{rule_id}
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| rule_id | int | 规则ID |

**响应**
```json
{
  "code": 0,
  "message": "删除成功",
  "data": null
}
```

### 2.5 获取预警统计

**请求**
```
GET /alerts/stats
```

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 50,
    "pending": 10,
    "processing": 5,
    "resolved": 30,
    "closed": 5,
    "by_level": {
      "green": 10,
      "yellow": 15,
      "orange": 15,
      "red": 10
    }
  }
}
```

### 2.6 获取预警记录列表

**请求**
```
GET /alerts?page=1&page_size=10&level=&status=
```

**查询参数**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| page | int | 否 | 1 | 页码 |
| page_size | int | 否 | 10 | 每页数量 |
| level | string | 否 | - | 预警等级：green/yellow/orange/red |
| status | string | 否 | - | 状态：pending/processing/resolved/closed |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [
      {
        "id": 1,
        "alert_id": "ALT-20240101-0001",
        "screening_id": 1,
        "name": "张三",
        "level": "orange",
        "trigger": "PHQ-9得分15分",
        "status": "pending",
        "assignee_name": "李老师",
        "created_at": "2024-01-01T10:00:00"
      }
    ],
    "total": 50,
    "page": 1,
    "page_size": 10,
    "total_pages": 5
  }
}
```

### 2.7 创建预警记录

**请求**
```
POST /alerts
```

**请求体**
```json
{
  "name": "张三",
  "screening_id": 1,
  "level": "orange",
  "trigger": "PHQ-9得分15分",
  "description": "筛查结果显示中度抑郁风险"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 受测者姓名 |
| screening_id | int | 是 | 关联的筛查记录ID |
| level | string | 否 | 预警等级，默认 green |
| trigger | string | 否 | 触发原因 |
| description | string | 否 | 详细描述 |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "alert_id": "ALT-20240101-0001",
    "name": "张三",
    "screening_id": 1,
    "level": "orange",
    "trigger": "PHQ-9得分15分",
    "description": "筛查结果显示中度抑郁风险",
    "status": "pending",
    "assignee_id": null,
    "assignee_name": null,
    "follow_up_notes": null,
    "resolved_at": null,
    "created_at": "2024-01-01T10:00:00",
    "updated_at": "2024-01-01T10:00:00"
  }
}
```

### 2.8 获取预警记录详情

**请求**
```
GET /alerts/{alert_id}
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| alert_id | int | 预警记录ID |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "alert_id": "ALT-20240101-0001",
    "name": "张三",
    "screening_id": 1,
    "level": "orange",
    "trigger": "PHQ-9得分15分",
    "description": "筛查结果显示中度抑郁风险",
    "status": "pending",
    "assignee_id": 1,
    "assignee_name": "李老师",
    "follow_up_notes": null,
    "resolved_at": null,
    "created_at": "2024-01-01T10:00:00",
    "updated_at": "2024-01-01T10:00:00"
  }
}
```

### 2.9 更新预警记录

**请求**
```
PUT /alerts/{alert_id}
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| alert_id | int | 预警记录ID |

**请求体**
```json
{
  "level": "red",
  "status": "processing",
  "assignee_id": 2,
  "follow_up_notes": "已安排心理咨询"
}
```

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "alert_id": "ALT-20240101-0001",
    "name": "张三",
    "screening_id": 1,
    "level": "red",
    "trigger": "PHQ-9得分15分",
    "description": "筛查结果显示中度抑郁风险",
    "status": "processing",
    "assignee_id": 2,
    "assignee_name": "王老师",
    "follow_up_notes": "已安排心理咨询",
    "resolved_at": null,
    "created_at": "2024-01-01T10:00:00",
    "updated_at": "2024-01-01T11:00:00"
  }
}
```

### 2.10 处理预警

**请求**
```
POST /alerts/{alert_id}/resolve?notes=
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| alert_id | int | 预警记录ID |

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| notes | string | 否 | 处理备注 |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "alert_id": "ALT-20240101-0001",
    "status": "resolved",
    "resolved_at": "2024-01-01T15:00:00",
    "created_at": "2024-01-01T10:00:00",
    "updated_at": "2024-01-01T15:00:00"
  }
}
```

---

## 3. 案例管理模块

### 3.1 获取案例标签列表

**请求**
```
GET /cases/tags
```

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1,
      "name": "重点关注",
      "color": "#ef4444",
      "description": "需要持续关注的案例",
      "created_at": "2024-01-01T00:00:00"
    }
  ]
}
```

### 3.2 创建案例标签

**请求**
```
POST /cases/tags
```

**请求体**
```json
{
  "name": "重点关注",
  "color": "#ef4444",
  "description": "需要持续关注的案例"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 标签名称 |
| color | string | 否 | 标签颜色，默认 #3b82f6 |
| description | string | 否 | 标签描述 |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "name": "重点关注",
    "color": "#ef4444",
    "description": "需要持续关注的案例",
    "created_at": "2024-01-01T00:00:00"
  }
}
```

### 3.3 获取案例列表

**请求**
```
GET /cases?page=1&page_size=10&alert_level=&status=&keyword=
```

**查询参数**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| page | int | 否 | 1 | 页码 |
| page_size | int | 否 | 10 | 每页数量 |
| alert_level | string | 否 | - | 预警等级 |
| status | string | 否 | - | 案例状态：active/monitoring/closed |
| keyword | string | 否 | - | 搜索关键词 |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [
      {
        "id": 1,
        "case_id": "CASE-20240101-0001",
        "name": "张三",
        "age": 20,
        "gender": "male",
        "department": "计算机学院",
        "alert_level": "orange",
        "status": "active",
        "screening_count": 3,
        "last_screening_date": "2024-01-15T10:00:00",
        "tags": ["重点关注", "已干预"]
      }
    ],
    "total": 20,
    "page": 1,
    "page_size": 10,
    "total_pages": 2
  }
}
```

### 3.4 创建案例

**请求**
```
POST /cases
```

**请求体**
```json
{
  "name": "张三",
  "age": 20,
  "gender": "male",
  "department": "计算机学院",
  "phone": "13800138000",
  "id_number": "110101200001011234",
  "tags": ["重点关注"],
  "notes": "初始备注"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 姓名 |
| age | int | 否 | 年龄 |
| gender | string | 否 | 性别 |
| department | string | 否 | 院系/部门 |
| phone | string | 否 | 联系电话 |
| id_number | string | 否 | 身份证号 |
| tags | array | 否 | 标签列表 |
| notes | string | 否 | 备注 |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "case_id": "CASE-20240101-0001",
    "name": "张三",
    "age": 20,
    "gender": "male",
    "department": "计算机学院",
    "phone": "13800138000",
    "id_number": "110101200001011234",
    "alert_level": "green",
    "status": "active",
    "counselor_id": null,
    "counselor_name": null,
    "notes": "初始备注",
    "screening_count": 0,
    "last_screening_date": null,
    "tags": ["重点关注"],
    "created_at": "2024-01-01T00:00:00",
    "updated_at": "2024-01-01T00:00:00"
  }
}
```

### 3.5 获取案例详情

**请求**
```
GET /cases/{case_id}
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| case_id | int | 案例ID |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "case_id": "CASE-20240101-0001",
    "name": "张三",
    "age": 20,
    "gender": "male",
    "department": "计算机学院",
    "phone": "13800138000",
    "id_number": "110101200001011234",
    "alert_level": "orange",
    "status": "active",
    "counselor_id": 1,
    "counselor_name": "李老师",
    "notes": "案例备注",
    "screening_count": 3,
    "last_screening_date": "2024-01-15T10:00:00",
    "tags": ["重点关注"],
    "timeline": [
      {
        "id": 1,
        "case_id": 1,
        "event_type": "screening",
        "title": "完成PHQ-9筛查",
        "description": "得分15分，橙色预警",
        "event_date": "2024-01-15T10:00:00",
        "created_at": "2024-01-15T10:00:00"
      }
    ],
    "screenings": [],
    "alerts": [],
    "created_at": "2024-01-01T00:00:00",
    "updated_at": "2024-01-15T10:00:00"
  }
}
```

### 3.6 更新案例

**请求**
```
PUT /cases/{case_id}
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| case_id | int | 案例ID |

**请求体**
```json
{
  "name": "张三",
  "age": 21,
  "alert_level": "red",
  "status": "monitoring",
  "tags": ["重点关注", "已干预"],
  "notes": "更新备注"
}
```

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "case_id": "CASE-20240101-0001",
    "name": "张三",
    "age": 21,
    "alert_level": "red",
    "status": "monitoring",
    "tags": ["重点关注", "已干预"],
    "notes": "更新备注",
    "created_at": "2024-01-01T00:00:00",
    "updated_at": "2024-01-20T10:00:00"
  }
}
```

### 3.7 删除案例

**请求**
```
DELETE /cases/{case_id}
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| case_id | int | 案例ID |

**响应**
```json
{
  "code": 0,
  "message": "删除成功",
  "data": null
}
```

### 3.8 获取案例时间线

**请求**
```
GET /cases/{case_id}/timeline
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| case_id | int | 案例ID |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1,
      "case_id": 1,
      "event_type": "screening",
      "title": "完成PHQ-9筛查",
      "description": "得分15分，橙色预警",
      "event_date": "2024-01-15T10:00:00",
      "created_at": "2024-01-15T10:00:00"
    }
  ]
}
```

### 3.9 添加时间线事件

**请求**
```
POST /cases/{case_id}/timeline
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| case_id | int | 案例ID |

**请求体**
```json
{
  "event_type": "counseling",
  "title": "心理咨询",
  "description": "完成第一次心理咨询",
  "event_date": "2024-01-20T14:00:00"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| event_type | string | 是 | 事件类型 |
| title | string | 是 | 事件标题 |
| description | string | 否 | 事件描述 |
| event_date | datetime | 否 | 事件日期 |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 2,
    "case_id": 1,
    "event_type": "counseling",
    "title": "心理咨询",
    "description": "完成第一次心理咨询",
    "event_date": "2024-01-20T14:00:00",
    "created_at": "2024-01-20T14:00:00"
  }
}
```

---

## 4. 检索分析模块

### 4.1 相似案例检索

**请求**
```
POST /retrieval/search
```

**请求体**
```json
{
  "query": "抑郁症状 大学生",
  "modality": "text",
  "top_k": 5
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| query | string | 是 | - | 检索查询文本 |
| modality | string | 否 | text | 检索模态：text/audio/image |
| top_k | int | 否 | 5 | 返回结果数量 |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "query": "抑郁症状 大学生",
    "results": [
      {
        "id": "CASE-20240101-0001",
        "similarity": 0.95,
        "modality": "text",
        "summary": "PHQ-9得分18分，红色预警",
        "tags": ["抑郁", "重点关注"],
        "alert_level": "red",
        "date": "2024-01-15"
      }
    ],
    "total": 5
  }
}
```

### 4.2 筛查结果分析

**请求**
```
POST /retrieval/analyze
```

**请求体**
```json
{
  "screening_id": 1,
  "include_retrieval": true,
  "top_k": 5
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| screening_id | int | 是 | - | 筛查记录ID |
| include_retrieval | bool | 否 | true | 是否包含相似案例检索 |
| top_k | int | 否 | 5 | 检索结果数量 |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "screening_id": 1,
    "retrieval_results": {
      "query": "张三 PHQ-9",
      "results": [],
      "total": 0
    },
    "rag_report": {
      "subject": "张三",
      "date": "2024-01-15",
      "summary": "筛查结果显示中度抑郁风险",
      "risk_level": "orange",
      "sections": [
        {
          "title": "筛查结果分析",
          "content": "PHQ-9得分15分，属于中度抑郁范围"
        }
      ],
      "recommendations": [
        "建议进行心理咨询",
        "持续关注情绪变化"
      ]
    }
  }
}
```

### 4.3 获取分析报告

**请求**
```
GET /retrieval/report/{screening_id}
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| screening_id | int | 筛查记录ID |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "subject": "张三",
    "date": "2024-01-15",
    "summary": "筛查结果显示中度抑郁风险",
    "risk_level": "orange",
    "sections": [
      {
        "title": "筛查结果分析",
        "content": "PHQ-9得分15分，属于中度抑郁范围"
      }
    ],
    "recommendations": [
      "建议进行心理咨询",
      "持续关注情绪变化"
    ]
  }
}
```

---

## 5. 文件上传模块

### 5.1 上传文件

**请求**
```
POST /upload
Content-Type: multipart/form-data
```

**表单参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | file | 是 | 上传的文件 |
| screening_id | int | 否 | 关联的筛查记录ID |
| description | string | 否 | 文件描述 |

**支持的文件类型**

| 类型 | MIME类型 |
|------|----------|
| 音频 | audio/mpeg, audio/wav, audio/mp3, audio/m4a, audio/ogg |
| 图片 | image/jpeg, image/png, image/gif, image/webp |
| 文档 | application/pdf, text/plain, application/msword |

**文件大小限制**：最大 50MB

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "file_id": "FILE-A1B2C3D4",
    "file_type": "audio",
    "file_name": "recording.mp3",
    "file_path": "/uploads/audio/20240115100000_recording.mp3",
    "file_size": 1024000,
    "created_at": "2024-01-15T10:00:00"
  }
}
```

### 5.2 获取文件信息

**请求**
```
GET /upload/{file_id}
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| file_id | string | 文件ID |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "file_id": "FILE-A1B2C3D4",
    "file_type": "audio",
    "file_name": "recording.mp3",
    "file_path": "/uploads/audio/20240115100000_recording.mp3",
    "file_size": 1024000,
    "description": "咨询录音",
    "created_at": "2024-01-15T10:00:00"
  }
}
```

### 5.3 删除文件

**请求**
```
DELETE /upload/{file_id}
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| file_id | string | 文件ID |

**响应**
```json
{
  "code": 0,
  "message": "文件删除成功",
  "data": null
}
```

---

## 6. 仪表盘模块

### 6.1 获取统计数据

**请求**
```
GET /dashboard/stats
```

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total_screenings": 1000,
    "monthly_screenings": 150,
    "pending_alerts": 25,
    "completion_rate": 95.5,
    "alert_distribution": {
      "green": 500,
      "yellow": 300,
      "orange": 150,
      "red": 50
    },
    "trend_data": [
      {
        "date": "01-15",
        "count": 10,
        "alerts": 2
      }
    ]
  }
}
```

### 6.2 获取最近预警

**请求**
```
GET /dashboard/recent-alerts?limit=5
```

**查询参数**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| limit | int | 否 | 5 | 返回数量 |

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1,
      "alert_id": "ALT-20240115-0001",
      "name": "张三",
      "level": "orange",
      "trigger": "PHQ-9得分15分",
      "status": "pending",
      "created_at": "2024-01-15 10:00",
      "assignee_name": "李老师"
    }
  ]
}
```

### 6.3 获取案例汇总

**请求**
```
GET /dashboard/summary
```

**响应**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total_cases": 100,
    "active_cases": 30,
    "monitoring_cases": 20
  }
}
```

---

## 附录

### A. 枚举值说明

#### 筛查状态 (status)
| 值 | 说明 |
|------|------|
| pending | 待完成 |
| completed | 已完成 |
| cancelled | 已取消 |

#### 预警等级 (alert_level)
| 值 | 说明 | 颜色 |
|------|------|------|
| green | 正常 | 绿色 |
| yellow | 轻度关注 | 黄色 |
| orange | 中度关注 | 橙色 |
| red | 高度关注 | 红色 |

#### 预警状态 (status)
| 值 | 说明 |
|------|------|
| pending | 待处理 |
| processing | 处理中 |
| resolved | 已解决 |
| closed | 已关闭 |

#### 案例状态 (status)
| 值 | 说明 |
|------|------|
| active | 活跃 |
| monitoring | 监控中 |
| closed | 已关闭 |

#### 性别 (gender)
| 值 | 说明 |
|------|------|
| male | 男性 |
| female | 女性 |

### B. 日期时间格式

所有日期时间字段使用 ISO 8601 格式：
- 日期时间：`YYYY-MM-DDTHH:mm:ss`
- 日期：`YYYY-MM-DD`

### C. ID 生成规则

| 类型 | 格式 | 示例 |
|------|------|------|
| 筛查ID | SCR-YYYYMMDD-XXXX | SCR-20240115-0001 |
| 预警ID | ALT-YYYYMMDD-XXXX | ALT-20240115-0001 |
| 案例ID | CASE-YYYYMMDD-XXXX | CASE-20240115-0001 |
| 文件ID | FILE-XXXXXXXX | FILE-A1B2C3D4 |
