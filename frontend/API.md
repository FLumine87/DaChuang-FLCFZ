# 前后端接口对接文档

> 本文档面向后端开发者，列出前端需要的所有 HTTP 接口。
>
> - **统一前缀**：`/api`
> - **鉴权方式**：`Authorization: Bearer <token>`（JWT）
> - **数据格式**：`application/json`（文件上传除外）
> - **响应格式**：推荐统一包装，前端已支持自动解包
>
> ```json
> { "code": 0, "message": "ok", "data": <实际数据> }
> ```
>
> `code === 0 || 200` 视为成功，前端会直接取 `data`；其它 code 视为业务错误，前端会抛错。
> 若不使用包装，可直接返回 data，前端也能识别。
>
> **HTTP 401** 统一视为 Token 过期，前端会清除 token 并跳转到登录页。

---

## 1. Token 约定

所有需要登录态的接口都要求请求头携带：

```
Authorization: Bearer <token>
```

Token 必须是**标准三段式 JWT**（前端会自动解码 payload 获取 `username` / `role`）：

```
<header>.<base64_payload>.<signature>
```

`payload` 必须包含以下字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `username` | string | 用户名 |
| `role` | `"admin"` \| `"user"` | 角色，决定跳转管理端还是个人端 |
| `exp` | number (可选) | 过期时间戳（毫秒） |

---

## 2. 认证接口

### 2.1 登录 `POST /api/auth/login`

**请求体**

```json
{
  "username": "xiaoyu",
  "password": "123456"
}
```

**响应**

```json
{
  "token": "eyJhbGciOi...",
  "role": "user",
  "name": "小雨"
}
```

### 2.2 注册 `POST /api/auth/register`

**请求体**

```json
{
  "username": "newuser",
  "password": "password123"
}
```

**响应**：成功返回 200（data 可空），失败返回业务错误。

### 2.3 登出 `POST /api/auth/logout`

调用后端做 token 黑名单登记（可选）。前端始终会清除本地 token。

---

## 3. 个人端接口

### 3.1 仪表盘 `GET /api/personal/dashboard`

返回当前登录用户首页所需全部数据：

```ts
{
  moodTrend: { date: string; mood: number; stress: number; sleep: number }[];
  warningDistribution: { name: string; value: number; color: string }[];
  warningEvents: WarningEvent[];       // 见 3.4
  actionPlan: { id: string; title: string; duration: string; status: 'new' | 'tracking' | 'resolved' }[];
  screeningRecords: PersonalScreeningRecord[];   // 见 3.2
  userProfile: { name: string; age: number; gender: string; campus: string; major: string; stage: string; emergencyContact: string };
  questionnaireCatalog: { id: string; name: string; description: string; questions: number; minutes: number; target: string }[];
  personalTimeline: { date: string; type: 'screening' | 'warning' | 'collection' | 'plan'; title: string; detail: string }[];
}
```

### 3.2 筛查记录 `GET /api/personal/screenings`

```ts
PersonalScreeningRecord[]

interface PersonalScreeningRecord {
  id: string;
  questionnaire: string;    // 'PHQ-9' | 'GAD-7' | 'ISI' | 'PSS-10'
  score: number;
  maxScore: number;
  level: 'green' | 'yellow' | 'orange' | 'red';
  status: 'completed' | 'pending';
  moodTag: string;
  date: string;             // YYYY-MM-DD
}
```

### 3.3 提交筛查 `POST /api/personal/screenings`

**请求体**

```json
{
  "questionnaire": "PHQ-9",
  "score": 15,
  "maxScore": 27,
  "level": "orange",
  "answers": { "q1": 2, "q2": 1, ... }
}
```

**响应**

```json
{ "id": "ME-SCR-000123", "status": "success", "riskLevel": "中高" }
```

### 3.4 预警列表 `GET /api/personal/warnings`

```ts
WarningEvent[]

interface WarningEvent {
  id: string;
  level: 'green' | 'yellow' | 'orange' | 'red';
  title: string;
  reason: string;
  suggestion: string;
  status: 'new' | 'tracking' | 'resolved';
  createdAt: string;
  updatedAt: string;
}
```

### 3.5 个人档案 `GET /api/personal/profile`

```ts
{
  screeningRecords: PersonalScreeningRecord[];
  warningEvents: WarningEvent[];
  userProfile: UserProfile;
  personalTimeline: PersonalTimelineEvent[];
}
```

### 3.6 跨模态检索 `POST /api/personal/search`

**请求体**

```json
{ "query": "最近入睡困难、白天无力" }
```

**响应**

```ts
{
  results: {
    id: string;
    similarity: number;                    // 0~1
    modality: 'text' | 'audio' | 'image' | 'multimodal';
    summary: string;
    tags: string[];
    alertLevel: 'green' | 'yellow' | 'orange' | 'red';
    date: string;
  }[];
  report: {
    summary: string;
    riskLevel: 'low' | 'medium' | 'high';
    sections: { title: string; content: string }[];
    recommendations: string[];
  };
  query: string;
}
```

### 3.7 文件上传 `POST /api/personal/upload`

**Content-Type**: `multipart/form-data`

| 字段 | 类型 | 说明 |
|---|---|---|
| `file` | File | 音频 / 图像文件 |

**响应**

```json
{
  "url": "https://cdn.example.com/xxx.webm",
  "filename": "录音_2026-03-18.webm",
  "analysis": "对该文件的分析说明..."
}
```

---

## 4. 管理端接口

> 以下接口要求 token 的 `role === "admin"`。非管理员应返回 403。

### 4.1 管理端仪表盘 `GET /api/admin/dashboard`

```ts
{
  trendData: { date: string; count: number; alerts: number }[];
  alertDistribution: { name: string; value: number; color: string }[];
  alertRecords: AlertRecord[];              // 见 4.3
  screeningRecords: AdminScreeningRecord[]; // 见 4.2
  caseRecords: CaseRecord[];                // 见 4.4
}
```

### 4.2 筛查记录（全部用户）`GET /api/admin/screenings`

```ts
interface AdminScreeningRecord {
  id: string;
  name: string;
  age: number;
  gender: string;
  questionnaire: string;
  score: number;
  maxScore: number;
  status: 'completed' | 'in_progress' | 'pending';
  alertLevel: 'green' | 'yellow' | 'orange' | 'red';
  date: string;
  counselor: string;
}
```

### 4.3 预警记录 `GET /api/admin/alerts`

```ts
interface AlertRecord {
  id: string;
  screeningId: string;
  name: string;
  level: 'green' | 'yellow' | 'orange' | 'red';
  trigger: string;
  description: string;
  status: 'pending' | 'processing' | 'resolved' | 'closed';
  assignee: string;
  createdAt: string;
  updatedAt: string;
}
```

### 4.4 案例档案 `GET /api/admin/cases`

```ts
interface CaseRecord {
  id: string;
  name: string;
  age: number;
  gender: string;
  department: string;
  tags: string[];
  screeningCount: number;
  lastScreening: string;
  alertLevel: 'green' | 'yellow' | 'orange' | 'red';
  status: 'active' | 'monitoring' | 'closed';
}
```

### 4.5 管理端检索 `POST /api/admin/search`

同 3.6，但结果为全体用户范围。

### 4.6 多模态数据采集总览 `GET /api/admin/data-collection`

```ts
{
  textSubmissions: TextSubmission[];
  audioSubmissions: AudioSubmission[];
  imageSubmissions: ImageSubmission[];
}

interface TextSubmission {
  id: string;
  username: string;
  submittedAt: string;
  wordCount: number;
  preview: string;              // 截断后的正文摘要
  keywords: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  analysisStatus: 'pending' | 'processing' | 'done' | 'flagged';
  riskLevel: 'low' | 'medium' | 'high';
}

interface AudioSubmission {
  id: string;
  username: string;
  filename: string;
  source: 'recorded' | 'uploaded';
  submittedAt: string;
  durationSec: number;
  emotion: string;
  speechRate: string;
  analysisStatus: 'pending' | 'processing' | 'done' | 'flagged';
  riskLevel: 'low' | 'medium' | 'high';
}

interface ImageSubmission {
  id: string;
  username: string;
  filename: string;
  submittedAt: string;
  type: string;
  previewUrl: string;
  annotation: string;
  analysisStatus: 'pending' | 'processing' | 'done' | 'flagged';
  riskLevel: 'low' | 'medium' | 'high';
}
```

---

## 5. 错误码约定（建议）

| HTTP Status | 含义 | 前端行为 |
|---|---|---|
| 200 + code=0 | 成功 | 正常解包 data |
| 200 + code≠0 | 业务错误 | 抛 Error，组件可捕获展示 |
| 400 | 参数错误 | 展示 response.message |
| 401 | 未登录 / token 过期 | 清 token 并跳转 `/auth` |
| 403 | 无权限 | 展示"无权访问" |
| 500 | 服务器异常 | 展示"服务器异常" |

---

## 6. 前端如何切换真实后端

1. 编辑前端 `.env.local`：

   ```
   VITE_USE_MOCK=false
   VITE_API_BASE_URL=            # 留空时走 vite 代理
   VITE_DEV_PROXY_TARGET=http://localhost:8000   # 后端实际地址
   ```

2. 重启 `npm run dev` 即可，所有组件代码无需改动。
