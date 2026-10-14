import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  ClipboardList,
  Info,
  Loader2,
  Network,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import {
  questionnaires,
  type AlertLevel,
  type QuestionnaireDefinition,
} from "../../data/questionnaireData";
import { getDraft } from "../../services/firstRun";
import {
  MAX_FACTORS,
  MAX_ROWS,
  MAX_TRIPLES,
  loadFirstRunEvidence,
  relationLabel,
  topMatched,
  type FirstRunEvidence,
} from "../../services/firstRunRetrieval";
import { getCurrentSession } from "../../auth/session";
import ScrollArea from "../../components/ScrollArea";
import FirstRunShell from "./FirstRunShell";
import { firstRunSteps } from "./firstRunSteps";

/**
 * FirstRunResult.tsx · 首次引导 03 本次结果
 *
 * 按「本次筛查报告卡」重做：右边合成**一张**卡，从上到下是
 *   顶部（本次筛查结果 + 量表名/完成时间）→ 核心结果（得分，切换标签时始终可见）
 *   → 三个标签（结果摘要 / 分析依据 / 后续建议）→ 底部操作按钮。
 * 之前是"得分卡 + 结论来自哪里 + 下一步"三块横着摆，得分最小、依据最大、
 * 按钮又单独一块，用户看完要在几处之间找重点；现在一次只讲一件事。
 *
 * 三类刻意的写法（都为了不说过头的话）：
 *   1. PSS-10 不走临床分级：PSS 作者实验室明确说它不是诊断工具、没有统一截断值，
 *      所以不写"中度压力"，也没有四色风险条，只写"本次压力感受记录 + 得分 +
 *      量表范围 0–40"，配一条 0–40 的简单刻度（表示量表得分，不是百分比）。
 *      PHQ-9 / GAD-7 / ISI 有通行的严重程度分档，仍显示分档条。
 *   2. 没有历史数据就不画趋势、不提"比上次改善"。
 *   3. 哈希检索与 RAG 尚未参与本次结果：放在「分析依据」里作为可展开的
 *      「了解分析技术」条目，并写明尚未参与；不把它们摆在结论里冒充依据。
 */
export default function FirstRunResult() {
  const draft = getDraft();
  const definition = questionnaires.find((item) => item.id === draft?.scaleId);
  const supplement = draft?.supplement;
  const supplementText = supplement?.text?.trim();
  const hasSupplement = Boolean(supplementText || supplement?.filename);
  /* 用户补充过东西时，直接落在「分析依据」——那里能看到"你补充的内容被用在哪"。
     否则补充完回到结果页看不出任何变化，像是白填了。 */
  const [tab, setTab] = useState<"summary" | "evidence" | "advice">(
    hasSupplement ? "evidence" : "summary",
  );

  /* 「分析依据」里的真实检索数据。挂载即发起：后端不可达/处于演示模式时，
     下面三个条目会各自给出如实说明，而不是留空或假装有结果。 */
  const ready = Boolean(draft?.recordId && draft.score !== undefined);
  const [evidence, setEvidence] = useState<FirstRunEvidence | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(ready);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const userId = getCurrentSession()?.username ?? "demo_user";
    loadFirstRunEvidence(userId, draft?.supplement?.text)
      .then((result) => {
        if (active) setEvidence(result);
      })
      .catch(() => {
        /* loadFirstRunEvidence 内部已把三种模式都收敛成状态，正常不会走到这里；
           真走到了也按"暂不可用"处理，绝不留一个转不完的圈。 */
        if (active) {
          setEvidence({
            mode: "unreachable",
            neo4jConnected: false,
            inferenceOk: false,
            matchedOmitted: 0,
          });
        }
      })
      .finally(() => {
        if (active) setEvidenceLoading(false);
      });
    return () => {
      active = false;
    };
    // 依赖只取"本次筛查身份"与补充正文：换一条记录才重新检索
  }, [ready, draft?.recordId, draft?.supplement?.text]);

  if (!draft?.recordId || !definition || draft.score === undefined || draft.maxScore === undefined) {
    return (
      <FirstRunShell
        step={4}
        eyebrow="03  ·  本次结果"
        title={<>还没有可以展示的结果。</>}
        body={<>先完成一份量表，这里会显示本次的分数与解释。</>}
      >
        <div className="ui-card p-6">
          <p className="text-sm text-slate-500">
            当前会话里没有本次筛查记录，可能刷新过或换了标签页。
          </p>
          <Link to="/personal/first/questionnaire" className="ui-button ui-button-primary mt-4">
            重新作答
          </Link>
        </div>
      </FirstRunShell>
    );
  }

  /* 四项（含只在有补充文字时出现的知识关联）的状态：摘要与徽标只算一次，
     与下面的内容用同一判据，避免"摘要说没检索到、内容说服务挂了"这种自相矛盾 */
  const hashState = hashRetrievalState(evidence, evidenceLoading);
  const ragState = ragReferenceState(evidence, evidenceLoading);
  const linkState = knowledgeLinkState(evidence, evidenceLoading);
  const showLinks = ready && Boolean(supplementText);

  const score = draft.score ?? 0;
  const maxScore = draft.maxScore ?? 0;
  const result = definition.scoring(score);
  const isPss = definition.id === "PSS-10";
  /* 用 completedAt（量表提交时刻）而不是 updatedAt：后者在 02 补充后会被刷新 */
  const completedAt = formatTime(draft.completedAt ?? draft.updatedAt);

  return (
    <FirstRunShell
      step={4}
      /* 这里**不能**加 wide。wide 的列定义是 [520px_1fr]，两条轨道正好铺满
         max-w-[1440px] 的栅格，于是 lg:justify-center 失去作用 ——
         左栏从 118px 掉到 64px（少了 54px 内缩），看着"左边贴边"；
         同时右栏被撑到 728px 宽、再叠上 stretch 的 max-h-720，
         卡片又宽又高而内容不长，中间空一大块（用户原话："左边的字体有点太靠边，
         右边的表格周围空"）。用默认的 [620px_520px] 就与其他首次引导页
         完全对齐（轨道 1204 + gap 64 < 栅格 1312，居中内缩恢复）。
         stretch 保留：它是给带 tab 的结果卡用的 —— 面板高度随 tab 变，
         需要卡片定高 + 内容区自己滚动，否则切 tab 会整页跳。 */
      stretch
      eyebrow="03  ·  本次结果"
      title={
        <>
          了解当下，
          <br />
          接下来有方向。
        </>
      }
      body={
        <>
          本次结果帮助你了解近期状态。
          <br />
          也为之后的记录提供参考。
        </>
      }
      steps={firstRunSteps(4)}
    >
      {/* ============ 本次筛查报告卡 ============ */}
      {/* 长宽固定：切「结果摘要 / 分析依据 / 后续建议」时卡片尺寸不变，内容多就在卡内滚动（用户要求：方框长宽不要变） */}
      <section className="flex flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_70px_-36px_rgba(16,24,40,0.35)] sm:p-7 report-card">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-base font-semibold text-slate-900">本次筛查结果</h2>
          <p className="text-[12px] text-slate-400">
            {definition.id} · {definition.name.replace(`${definition.id} `, "")}
            {completedAt ? ` · 完成于 ${completedAt}` : ""}
          </p>
        </div>

        {/* 核心结果：得分在标签上方，切到「分析依据」也仍然看得见 */}
        <div className="mt-4">
          {isPss ? (
            <PssScore score={score} maxScore={maxScore} />
          ) : (
            <div>
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <p className="text-[40px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">
                  {score}
                  <span className="ml-1 text-base font-normal text-slate-400">
                    / {maxScore} 分
                  </span>
                </p>
                <span
                  className={`rounded-full px-3 py-1 text-[13px] font-medium ${LEVEL_LOOK[result.level].pill}`}
                >
                  {result.label}
                </span>
              </div>
              <div className="mt-4 flex gap-1.5">
                {bands(definition, maxScore).map((band) => (
                  <span
                    key={`${band.from}-${band.label}`}
                    title={band.label}
                    className={`h-2 flex-1 rounded-full ${
                      score >= band.from && score <= band.to ? band.color : "bg-slate-100"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 内容导航 */}
        <div
          className="mt-6 flex gap-1 rounded-xl bg-slate-100 p-1"
          role="tablist"
          aria-label="报告内容"
        >
          {(
            [
              { id: "summary", label: "结果摘要" },
              { id: "evidence", label: "分析依据" },
              { id: "advice", label: "后续建议" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`flex-1 rounded-lg py-2.5 text-[13px] font-medium transition-all ${
                tab === item.id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* 内容区：占满剩余高度，超长时在卡内滚动——这样卡片高度不会随标签变化。
            子元素用 my-auto 垂直居中：矮内容（结果摘要）不再贴着标签栏顶、
            把空白全堆在按钮上方；内容超高时 auto 外边距归零，从顶部开始滚动，
            不会裁掉第一行。 */}
        <div
          className={`mt-5 flex min-h-0 flex-1 flex-col pr-1 ${
            tab === "evidence"
              ? "overflow-hidden" /* 分析依据：四项连排，滚动交给里面那个 ScrollArea */
              : "app-scrollbar overflow-y-auto [&>*]:my-auto"
          }`}
        >
          {tab === "summary" && (
            <div className="grid gap-3">
              {/* 结论与免责声明必须拉开层级：原来两句都是 14/12px 的灰字，
                  在深色下几乎分不出主次。结论用近黑 + 中等字重、字号提一档，
                  免责声明保持小号浅灰，一眼就能看出哪句是本次结果。 */}
              <p className="text-[17px] font-medium leading-8 text-slate-900">
                {isPss
                  ? "本次记录反映你过去一个月的主观压力感受。之后可以结合生活情况，回看自己的得分变化。"
                  : result.description}
              </p>
              <p className="text-[12px] leading-5 text-slate-400">
                {isPss
                  ? "PSS-10 不用于诊断心理疾病，也没有统一的临床分界值；上面的分组是系统参考分组，不是临床结论。"
                  : "筛查结果仅供自我了解，不等同于医学诊断。"}
              </p>
            </div>
          )}

          {tab === "evidence" && (
            /* 四项内容连成一个整体（用户 2026-10-14："能不能去掉导航栏，四个塞在一起"）：
               不再有左边的来源导航列表，也不折叠/点选 —— 往下滚依次看到
               本次作答与补充 → 动态跨模态哈希检索 → RAG 参考资料 →（有补充时的）知识关联，
               每项只留小标题 + 状态徽标 + 一行摘要，用细分隔线分开，同样面积放更多文字。
               滚动交给 ScrollArea：滚动条可见 + 底部渐隐与「向下滚动查看更多」提示。 */
            <ScrollArea
              /* min-h 从 300px 收到 200px。
                 它对"分析依据"那种长面板是必要的（切 tab 时卡片高度别乱跳），
                 但"结果摘要"内容很短，300px 会在文字上下各留一大块空白 ——
                 叠加卡片本身被 stretch 拉到整行高，就形成用户说的
                 "右边的表格周围空"。200px 仍然够托住各 tab 的高度差，
                 短面板的洞少掉三分之一。
                 两条 tab 都被撑到同一高度这件事本身是有意的，不改。 */
              className="min-h-[200px] flex-1"
              innerClassName="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white px-4 text-[13.5px] leading-[1.75] text-slate-600"
            >
              <EvidenceSection
                icon={ClipboardList}
                title="本次作答与补充"
                summary={`${definition.id} 共 ${definition.questions.length} 题${
                  hasSupplement ? "，并补充了一条记录" : "，未补充其他内容"
                }`}
              >
                <p>
                  量表：{definition.name}（{definition.instructions}）
                </p>
                <p className="mt-1">
                  补充内容：
                  {supplementText
                    ? `「${supplementText}」`
                    : supplement?.filename
                      ? `${supplement.filename}（${
                          supplement.kind === "audio" ? "语音" : "图片"
                        }）`
                      : "本次未补充"}
                </p>
              </EvidenceSection>

              <EvidenceSection
                icon={Network}
                title="动态跨模态哈希检索"
                summary={hashState.summary}
                badge={hashState.badge}
                loading={evidenceLoading}
              >
                <HashRetrievalContent
                  evidence={evidence}
                  loading={evidenceLoading}
                  enabled={ready}
                />
              </EvidenceSection>

              <EvidenceSection
                icon={BookOpen}
                title="RAG 参考资料"
                summary={ragState.summary}
                badge={ragState.badge}
                loading={evidenceLoading}
              >
                <RagReferenceContent
                  evidence={evidence}
                  loading={evidenceLoading}
                  enabled={ready}
                />
              </EvidenceSection>

              {/* 有补充文字时才会出现：后端从这段文字抽出的实体/关系（没补充就不留空壳） */}
              {showLinks && (
                <EvidenceSection
                  icon={Sparkles}
                  title="知识关联"
                  summary={linkState.summary}
                  loading={evidenceLoading}
                >
                  <KnowledgeLinkContent evidence={evidence} loading={evidenceLoading} />
                </EvidenceSection>
              )}
            </ScrollArea>
          )}

          {tab === "advice" && (
            <ul className="grid gap-4">
              {adviceList(result.level).map((item) => (
                <li key={item.title} className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-600">
                    <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium text-slate-800">{item.title}</p>
                    <p className="mt-1 text-[13px] leading-6 text-slate-500">{item.desc}</p>
                    {item.action && (
                      <Link
                        to={item.action.to}
                        className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-primary-600 transition-colors hover:text-primary-700"
                      >
                        {item.action.label}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 底部操作：只留一个出口。原先还有个「查看本次记录」，
            它指向工作台那套旧的记录详情页——而结果已经完整体现在这张卡上，
            没必要再把人送走一趟。 */}
        <div className="mt-6 shrink-0 border-t border-slate-100 pt-5 lg:mt-auto">
          <Link
            to="/personal/dashboard"
            className="ui-button ui-button-primary h-12 w-full rounded-xl"
          >
            进入个人主页
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </FirstRunShell>
  );
}

/* ---------------------------------------------------------------- 子组件 */

/* ---------------------------------------- 分析依据：左来源列表 / 右全文（左右分栏） */

/**
 * 演示模式的统一标注（用户 2026-10-14 明确要求这个说法）。
 * 后端 mock_mode=true 时，报告是**模板 + 本机记录 + 仓库内置内容**拼出来的，
 * 不是真实检索/大模型输出，界面上必须一眼看得出来。
 */
const MOCK_BADGE = "演示模式 · 模板生成";

/**
 * 「分析依据」里的一项：轻量小标题 + 状态徽标 + 一行摘要 + 内容。
 *
 * 刻意不做成可点的大卡片（用户 2026-10-14 明确要求去掉来源导航列表）：
 * 四项连排、细分隔线分开，同样的面积里能放更多文字；也就没有展开/收起这回事。
 */
function EvidenceSection({
  icon: Icon,
  title,
  summary,
  badge,
  loading = false,
  children,
}: {
  icon: typeof Info;
  title: string;
  summary: string;
  /** 状态徽标（如「演示模式 · 模板生成」），沿用原来那套克制的灰底胶囊 */
  badge?: string;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary-500" strokeWidth={1.7} />
        <h3 className="text-[13.5px] font-medium text-slate-800">{title}</h3>
        {badge && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
            {badge}
          </span>
        )}
        {loading && (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-slate-400" aria-hidden="true" />
        )}
      </div>
      <p className="mt-0.5 text-[12px] leading-5 text-slate-500">{summary}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** 只在这里统一三态文案，避免每条各写一遍 */
function ModeNotice({ evidence }: { evidence: FirstRunEvidence }) {
  if (evidence.mode === "mock") {
    return (
      <p>
        当前为{MOCK_BADGE}：报告正文由后端模板整理（尚未配置大模型 Key），不是大模型输出。
        {evidence.neo4jConnected
          ? "本次没有匹配到图谱里的相似线索。"
          : "后端未连接个人知识图谱（Neo4j），本次没有图谱相似线索。"}
      </p>
    );
  }
  return (
    <p>
      这一版尚未参与本次结果：检索服务未接入本次筛查，接通后会在这里给出本次检索到的相关线索摘要。
    </p>
  );
}

/**
 * 服务失败时的统一样子。
 * reason 为"检索服务暂不可用"时不重复一遍（briefError 已经归一过），
 * 避免出现"检索服务暂不可用（检索服务暂不可用）"这种叠字。
 */
function UnavailableNotice({
  reason,
  label = "检索服务暂不可用",
}: {
  reason: string;
  label?: string;
}) {
  const same = reason === label;
  return (
    <p className="flex items-start gap-1.5 text-slate-500">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-500" />
      <span>
        {same ? label : `${label}（${reason}）`}。其它条目不受影响。
      </span>
    </p>
  );
}

/* 三条来源的状态：摘要与徽标在这里算一次，左栏与右栏共用同一套判据，
   绝不能出现"摘要说没检索到、右栏说服务挂了"这种自相矛盾。 */

function hashRetrievalState(evidence: FirstRunEvidence | null, loading: boolean) {
  const rows = topMatched(evidence?.report, MAX_ROWS);
  const summary = loading
    ? "正在检索…"
    : rows.length
      ? `命中 ${rows.length + (evidence?.matchedOmitted ?? 0)} 条相似线索`
      : evidence?.mode === "live" && evidence.inferenceError
        ? "检索服务暂不可用"
        : evidence?.mode === "live"
          ? "本次未检索到高相似线索"
          : evidence?.mode === "mock"
            ? evidence.neo4jConnected
              ? "本次未检索到高相似线索"
              : "演示模式 · 未连接图谱，无相似线索"
            : "多模态线索的相似模式匹配";
  const badge =
    evidence?.mode === "mock"
      ? MOCK_BADGE
      : !loading && evidence?.mode !== "live"
        ? "了解分析技术"
        : undefined;
  return { rows, summary, badge };
}

function ragReferenceState(evidence: FirstRunEvidence | null, loading: boolean) {
  const factors = (evidence?.report?.factors ?? []).slice(0, MAX_FACTORS);
  const recs = (evidence?.report?.recommendations ?? []).slice(0, MAX_ROWS);
  /** 报告正文（后端返回的 summary；演示模式下就是模板文案，界面另有标注） */
  const reportSummary = evidence?.report?.summary?.trim() ?? "";
  const hasAny = Boolean(reportSummary) || factors.length > 0 || recs.length > 0;
  const summary = loading
    ? "正在整理…"
    : hasAny
      ? `${factors.length} 条风险因素 · ${recs.length} 条建议依据`
      : evidence?.mode === "live" && evidence.inferenceError
        ? "检索服务暂不可用"
        : evidence?.mode === "live"
          ? "本次未返回知识依据"
          : "结合心理知识库组织解释与建议";
  const badge =
    evidence?.mode === "mock"
      ? MOCK_BADGE
      : !loading && evidence?.mode !== "live"
        ? "了解分析技术"
        : undefined;
  return { factors, recs, reportSummary, hasAny, summary, badge };
}

function knowledgeLinkState(evidence: FirstRunEvidence | null, loading: boolean) {
  const triples = (evidence?.triples?.triples ?? []).slice(0, MAX_TRIPLES);
  const total = evidence?.triples?.triples.length ?? 0;
  const summary = loading
    ? "正在抽取…"
    : evidence?.triplesError
      ? "抽取服务暂不可用"
      : total
        ? `抽取到 ${total} 条实体关系`
        : evidence?.triples
          ? "本次未抽取到实体关系"
          : "从补充文字中抽取实体与关系";
  return { triples, total, summary };
}

/**
 * 动态跨模态哈希检索（右栏内容）。
 * 命中的相似线索 = 后端 matched_disorders（按 score 降序），只展示摘要字段：
 * 名称、匹配到的症状/诱因、相似度评分、覆盖率。接口没有的字段一律不显示。
 */
function HashRetrievalContent({
  evidence,
  loading,
  enabled,
}: {
  evidence: FirstRunEvidence | null;
  loading: boolean;
  enabled: boolean;
}) {
  const { rows } = hashRetrievalState(evidence, loading);

  return (
    <div className="grid gap-2.5">
      {loading && <p className="text-slate-500">正在比对本次线索…</p>}

      {!loading && !enabled && <p>本次没有可用的筛查记录，未发起检索。</p>}

      {!loading && enabled && evidence && evidence.mode !== "live" && (
        <ModeNotice evidence={evidence} />
      )}

      {!loading && evidence?.mode === "live" && evidence.inferenceError && (
        <UnavailableNotice reason={evidence.inferenceError} />
      )}

      {/* 出错与"无命中"互斥：服务都没答上来，就不能再说一句"本次未检索到"，
          否则等于替一次失败的检索下了结论。 */}
      {!loading && evidence?.mode === "live" && !evidence.inferenceError && rows.length === 0 && (
        <p>本次未检索到高相似线索：个人图谱里还没有足够的线索，暂时无法给出相似匹配。</p>
      )}

      {!loading && rows.length > 0 && (
        <div className="grid gap-2">
          {rows.map((row) => (
            <div
              key={row.name}
              className="rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[13.5px] font-medium text-slate-800">{row.name}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                  相似度 {row.score}
                </span>
                <span className="text-[11px] text-slate-400">
                  覆盖 {Math.round((row.coverage ?? 0) * 100)}%
                </span>
              </div>
              {row.matched_symptoms.length > 0 && (
                <p className="mt-1.5 text-[13px] leading-[1.7] text-slate-500">
                  匹配症状：{row.matched_symptoms.join("、")}
                </p>
              )}
              {row.matched_triggers.length > 0 && (
                <p className="mt-0.5 text-[13px] leading-[1.7] text-slate-500">
                  匹配诱因：{row.matched_triggers.join("、")}
                </p>
              )}
            </div>
          ))}
          {(evidence?.matchedOmitted ?? 0) > 0 && (
            <p className="text-[11px] text-slate-400">
              其余 {evidence?.matchedOmitted} 条略。
            </p>
          )}
          <p className="text-[11px] leading-5 text-slate-400">
            只展示线索摘要，不展示其他人的原始资料。
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * RAG 参考资料（右栏内容）。
 * 接口没有"sources / references"这类字段，所以不硬凑一份假的文献列表：
 * 这里展示的是后端报告里**本来就是从知识图谱取出来的**两类内容 ——
 * factors（可解释风险因素）与 recommendations[].reason（该建议的由来），
 * 外加后端返回的报告正文 summary。
 */
function RagReferenceContent({
  evidence,
  loading,
  enabled,
}: {
  evidence: FirstRunEvidence | null;
  loading: boolean;
  enabled: boolean;
}) {
  const { factors, recs, reportSummary, hasAny } = ragReferenceState(evidence, loading);

  return (
    <div className="grid gap-3">
      {loading && <p className="text-slate-500">正在整理知识依据…</p>}

      {!loading && !enabled && <p>本次没有可用的筛查记录，未发起检索。</p>}

      {!loading && enabled && evidence && evidence.mode !== "live" && (
        <ModeNotice evidence={evidence} />
      )}

      {!loading && evidence?.mode === "live" && evidence.inferenceError && (
        <UnavailableNotice reason={evidence.inferenceError} />
      )}

      {!loading &&
        evidence?.mode === "live" &&
        !evidence.inferenceError &&
        !hasAny && <p>本次未返回知识依据：个人图谱里的线索还不足以形成解释与建议。</p>}

      {!loading && hasAny && (
        <div className="grid gap-3">
          {/* 报告正文：后端返回的 summary 原样展示（接口给什么就显示什么） */}
          {reportSummary && (
            <div>
              <p className="text-[13px] font-medium text-slate-700">报告正文</p>
              <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-[1.75] text-slate-600">
                {reportSummary}
              </p>
            </div>
          )}

          {factors.length > 0 && (
            <div>
              <p className="text-[13px] font-medium text-slate-700">风险因素</p>
              <ul className="mt-1 grid gap-1">
                {factors.map((factor) => (
                  <li key={factor} className="flex gap-1.5 text-[13.5px] leading-[1.7] text-slate-600">
                    <span className="text-slate-300">·</span>
                    <span className="min-w-0">{factor}</span>
                  </li>
                ))}
              </ul>
              {(evidence?.report?.factors.length ?? 0) > factors.length && (
                <p className="mt-1 text-[11px] text-slate-400">
                  其余 {(evidence?.report?.factors.length ?? 0) - factors.length} 条略。
                </p>
              )}
            </div>
          )}

          {recs.length > 0 && (
            <div>
              <p className="text-[13px] font-medium text-slate-700">建议的知识依据</p>
              <div className="mt-1 grid gap-1.5">
                {recs.map((rec) => (
                  <div key={`${rec.name}-${rec.reason}`} className="text-[13.5px] leading-[1.7]">
                    <span className="font-medium text-slate-800">{rec.name}</span>
                    {rec.category && (
                      <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                        {rec.category}
                      </span>
                    )}
                    <span className="mt-0.5 block text-slate-600">{rec.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {evidence?.report?.disclaimer && (
            <p className="border-t border-slate-200 pt-2 text-[11.5px] leading-5 text-slate-400">
              {evidence.report.disclaimer}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** 知识关联（右栏内容）：仅在有补充文字时出现，展示后端抽取到的实体与关系 */
function KnowledgeLinkContent({
  evidence,
  loading,
}: {
  evidence: FirstRunEvidence | null;
  loading: boolean;
}) {
  const { triples, total } = knowledgeLinkState(evidence, loading);

  return (
    <div className="grid gap-1.5">
      {loading && <p className="text-slate-500">正在从补充文字中抽取…</p>}

      {!loading && evidence?.triplesError && (
        <UnavailableNotice reason={evidence.triplesError} label="抽取服务暂不可用" />
      )}

      {!loading && !evidence?.triplesError && triples.length === 0 && (
        <p>本次未从补充文字中抽取到实体关系。</p>
      )}

      {!loading && triples.length > 0 && (
        <div className="grid gap-1.5">
          <ul className="grid gap-1">
            {triples.map((triple, index) => (
              <li
                key={`${triple.relation}-${triple.object}-${index}`}
                className="flex flex-wrap items-center gap-1.5 text-[13px]"
              >
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                  {relationLabel(triple.relation)}
                </span>
                <span className="text-slate-800">{triple.object}</span>
                {triple.value !== undefined && triple.value !== null && (
                  <span className="text-slate-400">{triple.value}</span>
                )}
              </li>
            ))}
          </ul>
          {total > triples.length && (
            <p className="text-[11px] text-slate-400">其余 {total - triples.length} 条略。</p>
          )}
          {/* 写入状态如实说明：Neo4j 未连接时后端能抽出来但存不进去 */}
          <p className="text-[11px] leading-5 text-slate-400">
            {evidence?.triples?.written
              ? `已写入个人知识图谱 ${evidence.triples.written} 条。`
              : evidence?.triples?.neo4jConnected
                ? "已连接个人知识图谱，本次没有可写入的实体关系。"
                : "本次未写入个人知识图谱（图数据库未连接）。"}
            {evidence?.triples?.mock ? "抽取走演示引擎（内置关键词），非大模型输出。" : ""}
          </p>
        </div>
      )}
    </div>
  );
}
/** PSS-10 的得分展示：不做临床分级，只给量表范围与一条定位刻度 */
function PssScore({ score, maxScore }: { score: number; maxScore: number }) {
  const percent = maxScore > 0 ? Math.min(100, Math.max(0, (score / maxScore) * 100)) : 0;
  return (
    <div>
      <p className="text-[13px] text-slate-500">本次压力感受记录</p>
      <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
        <p className="text-[40px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">
          {score}
          <span className="ml-1.5 text-base font-normal text-slate-400">分</span>
        </p>
        <p className="text-[13px] text-slate-500">量表范围 0–{maxScore}</p>
      </div>
      <div className="mt-4">
        <div className="relative h-2 rounded-full bg-slate-100">
          <span
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary-500 shadow"
            style={{ left: `${percent}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-slate-400">
          <span>0</span>
          <span>{maxScore}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 工具 */

const LEVEL_LOOK: Record<AlertLevel, { pill: string }> = {
  green: { pill: "bg-success-50 text-success-600" },
  yellow: { pill: "bg-warning-50 text-warning-600" },
  orange: { pill: "bg-orange-50 text-orange-600" },
  red: { pill: "bg-danger-50 text-danger-600" },
};

/** 完成时间：草稿里存的是 ISO，这里只取到分钟 */
function formatTime(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** 分档条：在 0..满分 上按量表自己的阈值扫出区间（与筛查结果页永远一致） */
function bands(definition: QuestionnaireDefinition, maxScore: number) {
  const colorOf: Record<AlertLevel, string> = {
    green: "bg-success-500",
    yellow: "bg-warning-500",
    orange: "bg-orange-500",
    red: "bg-danger-500",
  };
  const out: { from: number; to: number; label: string; level: AlertLevel }[] = [];
  let start = 0;
  let current = definition.scoring(0);
  for (let value = 1; value <= maxScore; value += 1) {
    const next = definition.scoring(value);
    if (next.label !== current.label) {
      out.push({ from: start, to: value - 1, label: current.label, level: current.level });
      start = value;
      current = next;
    }
  }
  out.push({ from: start, to: maxScore, label: current.label, level: current.level });
  return out.map((band) => ({ ...band, color: colorOf[band.level] }));
}

/** 后续建议：两三条，短标题 + 一句说明，相关操作跟在旁边 */
function adviceList(level: AlertLevel) {
  const list: {
    title: string;
    desc: string;
    action?: { label: string; to: string };
  }[] = [];

  if (level === "red" || level === "orange") {
    list.push({
      title: "尽快找专业人员聊一次",
      desc: "这次结果提示近期状态值得关注。学校心理中心、心理咨询师或医疗专业人员都可以，越早越有帮助。",
    });
  } else {
    list.push({
      title: "保持记录的习惯",
      desc: "隔一段时间再做一次同样的量表，对照自己的变化比看单次分数更有意义。",
    });
  }

  list.push({
    title: "补一条近况记录",
    desc: "文字、语音或图片都可以，让后面的分析多一条线索。",
    action: { label: "去多模态采集", to: "/personal/data-collection" },
  });

  /* 只留两条：第三条原本是"回看完整记录"，指向的旧记录页已经不再从引导里进入 */
  return list.slice(0, 2);
}
