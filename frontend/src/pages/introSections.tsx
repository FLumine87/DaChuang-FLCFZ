import type { ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Binary,
  Check,
  Cpu,
  FileText,
  Lock,
  Server,
} from "lucide-react";
import Aurora from "../components/Aurora";

/* ============================================================================
   「平台简介」页的章节内容（导航项 / 屏幕定义 / 四个章节与示意图）
   从登录页拆出来单独维护：登录页只负责登录，平台内容在这里。
   ============================================================================ */

export function Section({
  id,
  eyebrow,
  title,
  desc,
  points,
  visual,
  footnote,
}: {
  id: string;
  eyebrow: string;
  /* ReactNode 而不是 string：标题需要把"检索 / 复核 / 评估 / 数据不出域"
     这类词组包进 <span className="whitespace-nowrap">，否则中文会逐字断行，
     出现"…哈希检 / 索与 RAG 生成"这种把词劈开的断法。 */
  title: ReactNode;
  desc: string;
  /* 要点列表：内容取自申报书（创新点 / 通道分工 / 处置流程 / 隐私手段），
     与首屏的要点样式保持一致，便于逐条扫读。 */
  points?: string[];
  visual: ReactNode;
  footnote?: string;
}) {
  /* 四个章节版式统一：文字在左、示意图在右，不再左右交替 */
  return (
    <section
      id={id}
      className="auth-screen relative flex items-center overflow-hidden border-t border-slate-200/70 bg-white/60 px-6 sm:px-10 lg:px-12 xl:px-16"
    >
      <Aurora />
      <div className="relative z-10 mx-auto grid w-full max-w-[1440px] items-center gap-12 py-16 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16 lg:py-12">
        <div data-reveal>
          <p className="text-[17px] font-semibold tracking-[0.2em] text-primary-500">
            {eyebrow}
          </p>
          <h2 className="auth-section-title mt-6 max-w-[720px] text-balance tracking-tight text-slate-900">
            {title}
          </h2>
          <p className="mt-8 max-w-[640px] text-[18px] leading-9 text-slate-600 sm:text-[20px] sm:leading-[2.1]">
            {desc}
          </p>
          {points && points.length > 0 && (
            <ul className="mt-5 grid max-w-[640px] gap-1 border-t border-dashed border-slate-200 pt-4">
              {points.map((point) => (
                <li
                  key={point}
                  className="flex items-start gap-2 text-[14px] leading-5 text-slate-600"
                >
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
                  {point}
                </li>
              ))}
            </ul>
          )}
          {footnote && <p className="mt-10 text-[13px] text-slate-500">{footnote}</p>}
        </div>
        <div data-reveal data-visual>{visual}</div>
      </div>
    </section>
  );
}

/* 动态背景层「极光」已上移到 components/Aurora.tsx（工作台也要复用同一层）。
   本文件里 Section 自己要用，同时原样再导出，
   主页的 `import { Aurora } from "./introSections"` 不用改。 */
export { Aurora };

/* 示意图统一外壳：放大内边距，让卡片撑满一屏 */
function Panel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-[30px] border border-slate-200 bg-white p-7 shadow-[0_26px_64px_-44px_rgba(16,24,40,0.5)] sm:p-9">
      <p className="text-[13px] font-medium tracking-[0.18em] text-slate-500">{label}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

/* ---------------- 各区块示意图 ---------------- */

export function TechVisual() {
  const steps = ["三模态输入", "哈希编码", "跨模态检索", "RAG 报告"];
  const metrics = [
    { value: "毫秒级", label: "相似案例检索响应", icon: Activity },
    { value: "亿级", label: "汉明距离检索规模", icon: Binary },
    { value: "双依据", label: "检索样例 + 专业知识库", icon: FileText },
  ];
  const points = [
    "多哈希表增量更新，适应样本分布变化",
    "查询自适应重排序与非对称距离度量",
    "半监督伪标签与类别敏感稀疏正则化",
    "知识图谱关联支撑报告依据可追溯",
  ];
  return (
    <Panel label="技术链路">
      <div className="flex flex-wrap items-center gap-2.5">
        {steps.map((step, index) => (
          <span key={step} className="inline-flex items-center gap-2.5">
            {index > 0 && <ArrowRight className="h-4 w-4 text-slate-300" />}
            <span className="rounded-full border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-medium text-primary-600">
              {step}
            </span>
          </span>
        ))}
      </div>

      <div className="mt-6 grid gap-3.5 sm:grid-cols-3">
        {metrics.map((item) => (
          <div key={item.label} className="flex items-start gap-3.5 rounded-2xl bg-slate-50 p-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-primary-500">
              <item.icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[26px] font-medium leading-none tabular-nums text-primary-600">
                {item.value}
              </p>
              <p className="mt-2 text-[14px] leading-5 text-slate-500">{item.label}</p>
            </div>
          </div>
        ))}
      </div>

      <ul className="mt-6 grid gap-3 border-t border-dashed border-slate-200 pt-6 sm:grid-cols-2">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-3 text-[15px] leading-7 text-slate-600">
            <Check className="mt-1 h-4 w-4 shrink-0 text-success-600" />
            {point}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function AssessVisual() {
  const groups = [
    {
      title: "文本",
      tone: "bg-success-50 text-success-600",
      bar: "bg-success-500",
      items: [
        ["量表答案", "标准化条目作答"],
        ["认知模式", "用词与归因倾向"],
        ["语言逻辑", "语义连贯性"],
      ],
    },
    {
      title: "音频",
      tone: "bg-primary-50 text-primary-600",
      bar: "bg-primary-500",
      items: [
        ["语音语调", "音高与能量分布"],
        ["情绪波动", "短时起伏幅度"],
        ["情感强度", "情感表达力度"],
      ],
    },
    {
      title: "视觉",
      tone: "bg-orange-50 text-orange-600",
      bar: "bg-orange-500",
      items: [
        ["面部表情", "表情张力与效价"],
        ["绘画笔迹", "线条与用色特征"],
        ["情绪外露", "画面整体氛围"],
      ],
    },
  ];
  const dims = ["压力水平", "睡眠时长", "情绪趋势", "PHQ-9", "GAD-7", "ISI", "PSS-10"];
  return (
    <Panel label="三模态 × 多维度">
      <div className="grid gap-4 sm:grid-cols-3">
        {groups.map((group) => (
          <div key={group.title} className="rounded-2xl border border-slate-100 p-6">
            <span className={`inline-block rounded-xl px-3.5 py-2 text-[15px] font-semibold ${group.tone}`}>
              {group.title}
            </span>
            <ul className="mt-4 space-y-2.5">
              {group.items.map(([name, note]) => (
                <li key={name}>
                  <p className="flex items-center gap-2.5 text-[15px] font-medium text-slate-700">
                    <span className={`h-1.5 w-1.5 rounded-full ${group.bar}`} />
                    {name}
                  </p>
                  <p className="mt-1 pl-4 text-[14px] text-slate-500">{note}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-6 border-t border-dashed border-slate-200 pt-5">
        <p className="text-[13px] text-slate-500">同时纳入的标准化量表</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {dims.map((chip) => (
            <span key={chip} className="rounded-full bg-slate-100 px-4 py-2 text-[14px] text-slate-600">
              {chip}
            </span>
          ))}
        </div>
        <p className="mt-4 text-[13px] leading-6 text-slate-500">
          量表只作辅助校准，结论以三模态证据为主。
        </p>
      </div>
    </Panel>
  );
}

export function AlertVisual() {
  const levels = [
    { label: "状态平稳", note: "维持常规记录", tone: "bg-success-500", width: "w-1/4" },
    { label: "建议留意", note: "推送自助建议", tone: "bg-warning-500", width: "w-2/4" },
    { label: "需要关注", note: "纳入观察名单", tone: "bg-orange-500", width: "w-3/4" },
    { label: "优先照顾", note: "进入人工研判", tone: "bg-danger-500", width: "w-full" },
  ];
  const flow = ["自动预警", "人工研判", "个案跟踪", "处置留痕"];
  return (
    <Panel label="四级预警 · 处置闭环">
      <div className="space-y-5">
        {levels.map((level) => (
          <div key={level.label} className="flex items-center gap-4">
            <span className="w-24 shrink-0 text-[15px] text-slate-600">{level.label}</span>
            <span className="h-3.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <span className={`block h-full rounded-full ${level.tone} ${level.width}`} />
            </span>
            <span className="w-36 shrink-0 text-right text-[14px] text-slate-500">{level.note}</span>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2.5 border-t border-dashed border-slate-200 pt-6">
        {flow.map((step, index) => (
          <span key={step} className="inline-flex items-center gap-2.5 text-[15px] text-slate-600">
            {index > 0 && <ArrowRight className="h-4 w-4 text-slate-300" />}
            <span className="rounded-full border border-slate-200 px-5 py-2.5">{step}</span>
          </span>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-dashed border-slate-200 pt-5">
        {[
          { value: "4", label: "级预警阈值" },
          { value: "100%", label: "高风险个案人工复核" },
          { value: "全程", label: "处置流程留痕可追溯" },
        ].map((item) => (
          <span key={item.label} className="flex items-baseline gap-2">
            <b className="text-[22px] font-medium leading-none tabular-nums text-primary-600">
              {item.value}
            </b>
            <span className="text-[14px] text-slate-500">{item.label}</span>
          </span>
        ))}
      </div>

      <ul className="mt-6 grid gap-2.5">
        {[
          "高风险个案自动进入人工研判队列，不交由算法独立判定",
          "咨询师确认后转入个案跟踪，处置过程全程留痕、可回溯",
        ].map((point) => (
          <li key={point} className="flex items-start gap-2.5 text-[14px] leading-6 text-slate-600">
            <Check className="mt-1 h-4 w-4 shrink-0 text-success-600" />
            {point}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function PrivacyVisual() {
  const points = [
    "横向联邦：同构机构间协同建模",
    "纵向联邦：同一人群的多源特征联合",
    "联邦迁移：小样本机构亦可参与",
    "仅上行加密模型更新，原始数据不出域",
  ];
  return (
    <Panel label="联邦学习架构">
      <div className="grid gap-4 sm:grid-cols-2">
        {["学校 A", "学校 B"].map((node) => (
          <div key={node} className="flex items-start gap-3.5 rounded-2xl border border-slate-100 bg-slate-50 p-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-primary-500">
              <Server className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-base font-semibold text-slate-700">{node}</p>
              <p className="mt-1 text-[13px] leading-5 text-slate-500">
                本地训练 · 原始数据留存本地
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="my-5 flex items-center gap-3 text-[13px] text-slate-500">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-medium text-primary-600">
          <Lock className="h-4 w-4" />
          只交换加密模型更新
        </span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      <div className="flex items-start gap-3.5 rounded-2xl bg-slate-50 p-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-primary-500">
          <Cpu className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-700">全局模型</p>
          <p className="mt-1 text-[13px] leading-5 text-slate-500">
            数据不出域 · 兼顾模型精度与隐私合规
          </p>
        </div>
      </div>

      <ul className="mt-9 grid gap-3.5 border-t border-dashed border-slate-200 pt-8 sm:grid-cols-2">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-3 text-[15px] leading-7 text-slate-600">
            <Check className="mt-1 h-4 w-4 shrink-0 text-success-600" />
            {point}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
