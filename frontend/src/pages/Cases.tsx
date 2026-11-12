import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ClipboardList,
  Clock,
  FileText,
  Lock,
  Phone,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import {
  type PersonalScreeningRecord,
  type WarningEvent,
  type PersonalTimelineEvent,
  type UserProfile,
} from '../data/mockData';
import { getCases, getPersonalSupplements, type PersonalSupplement } from '../services/mockApi';
import { getCurrentSession, getDisplayName } from '../auth/session';
import AlertBadge from '../components/AlertBadge';

/*
 * 我的心理档案
 * ============
 * 版式按「纸质档案袋里的那张表」来做，而不是三张信息卡：
 *   · 表头：建档日期 / 姓名与院系，像档案封面
 *   · 基本信息：标签在左、值在右的两列表格，带分隔线
 *   · 档案状态：等级、筛查次数、预警次数、最近更新，做成右侧一竖栏
 *   · 记录明细：真正的 <table>，有表头、有对齐、有操作列
 *   · 关键时间线：日期用等宽字，事件按时间倒序
 *
 * 为什么不用"气泡卡片"：三张并列的卡片读起来像仪表盘，看不出"这是一份档案"。
 * 档案的本质是**有栏目、有表格、有留痕**，所以这里全用表格和分栏。
 */

/** 取一串日期里最早的一个（YYYY-MM-DD） */
function earliestDate(dates: (string | undefined)[]): string {
  const clean = dates
    .map((d) => String(d ?? '').trim())
    .filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d))
    .map((d) => d.slice(0, 10))
    .sort();
  return clean[0] ?? '';
}

const LEVEL_TEXT: Record<string, string> = {
  green: '稳定',
  yellow: '关注',
  orange: '警告',
  red: '高危',
};

const SCALE_TEXT: Record<string, string> = {
  'PHQ-9': '情绪筛查',
  'GAD-7': '焦虑筛查',
  ISI: '睡眠评估',
  'PSS-10': '压力评估',
};

/**
 * 档案摘要：只根据当前账号的记录生成，没有完成记录时返回 null。
 * 取最近一次完成的量表 → 与同名量表上一次对比 → 未处理预警 → 分级建议。
 */
function buildSummary(
  records: PersonalScreeningRecord[],
  warnings: WarningEvent[],
): string[] | null {
  const completed = records
    .filter((item) => item.status === 'completed')
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const latest = completed[0];
  if (!latest) return null;

  const lines: string[] = [];
  const scaleName = SCALE_TEXT[latest.questionnaire] ?? latest.questionnaire;
  lines.push(
    `最近一次${scaleName}（${latest.date}）得分 ${latest.score}/${latest.maxScore}，处于「${LEVEL_TEXT[latest.level] ?? latest.level}」区间。`,
  );

  const previous = completed.find(
    (item) => item.id !== latest.id && item.questionnaire === latest.questionnaire,
  );
  if (previous) {
    const delta = latest.score - previous.score;
    lines.push(
      delta === 0
        ? `与上一次同名量表（${previous.date}）相比持平。`
        : `与上一次同名量表（${previous.date}）相比${delta > 0 ? '上升' : '下降'} ${Math.abs(delta)} 分。`,
    );
  } else {
    lines.push('这是该量表在当前档案里的第一条完整记录，后续可以做同量表复测来观察变化。');
  }

  const openWarnings = warnings.filter((item) => item.status !== 'resolved');
  if (openWarnings.length > 0) {
    const latestWarning = openWarnings[0];
    const suggestion = (latestWarning.suggestion || '建议按预警页的提示跟进').replace(/[。！？!?；;]+$/, '');
    lines.push(
      `目前还有 ${openWarnings.length} 条未处理预警；最近一条是「${latestWarning.title}」（${latestWarning.createdAt}），${suggestion}。`,
    );
  } else {
    lines.push('目前没有未处理的预警记录。');
  }

  if (latest.level === 'red' || latest.level === 'orange') {
    lines.push('建议优先联系学校心理中心、咨询师或医疗专业人员，先安排一次面对面的支持。');
  } else if (latest.level === 'yellow') {
    lines.push('建议保持规律记录，并在 1–2 周内用同一份量表复测一次；若持续加重，及时联系专业人员。');
  } else {
    lines.push('当前结果较平稳，保持现有节奏即可；下次想了解变化时再做一次同量表复测。');
  }

  return lines;
}

/** 表格里统一的小字号 */
const tdCls = 'px-4 py-2.5 text-[12.5px] text-slate-700';
const thCls =
  'px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-slate-400';

const SUP_MODALITY: Record<string, string> = { text: '文字', audio: '语音', image: '照片' };

/** 检索记录的摘要：文字取原文，语音/照片取文件名或描述 */
function supplementSummary(item: PersonalSupplement): string {
  if (item.kind === 'text') return (item.text || '').trim() || '（空文本）';
  return item.filename || item.description || '（媒体文件）';
}

/** 基本信息的一行：标签 + 值 */
function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  const empty = !value || value === '—';
  return (
    <div className="flex items-baseline gap-3 px-5 py-2.5">
      <span className="w-20 shrink-0 text-[12px] text-slate-400">{label}</span>
      <span
        className={`min-w-0 flex-1 break-words text-[13px] ${
          empty ? 'text-slate-300' : 'text-slate-800'
        } ${mono && !empty ? 'tabular-nums' : ''}`}
      >
        {empty ? '未填写' : value}
      </span>
    </div>
  );
}

/** 区块标题条 */
function SectionTitle({
  icon: Icon,
  title,
  extra,
}: {
  icon: typeof UserRound;
  title: string;
  extra?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-2.5">
      <h3 className="flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-wider text-slate-600">
        <Icon className="h-3.5 w-3.5 text-slate-400" />
        {title}
      </h3>
      {extra && <span className="text-[11px] tabular-nums text-slate-400">{extra}</span>}
    </div>
  );
}

export default function Cases() {
  const [screeningRecords, setScreeningRecords] = useState<PersonalScreeningRecord[]>([]);
  const [warningEvents, setWarningEvents] = useState<WarningEvent[]>([]);
  const [personalTimeline, setPersonalTimeline] = useState<PersonalTimelineEvent[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>({
    name: '—', age: 0, gender: '', campus: '', major: '', stage: '', emergencyContact: '',
  });
  const [loading, setLoading] = useState(false);
  /* 检索记录（文字/语音/照片）：与「筛查记录」页同一份数据 */
  const [supplements, setSupplements] = useState<PersonalSupplement[]>([]);
  /* 下方明细表的切换：量表 / 检索 */
  const [recordTab, setRecordTab] = useState<'screening' | 'retrieval'>('screening');

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await getCases();
        setScreeningRecords(data.screeningRecords ?? []);
        setWarningEvents(data.warningEvents ?? []);
        setPersonalTimeline(data.personalTimeline ?? []);
        if (data.userProfile) {
          // 个人端名称与登录时输入的用户名一致，避免演示资料中的姓名覆盖当前账号。
          const signedInUsername = getCurrentSession()?.username;
          const fallback = getDisplayName();
          const name = data.userProfile.name;
          setUserProfile({
            ...data.userProfile,
            name: signedInUsername || fallback || name || '—',
          });
        }
        // 检索记录单独取一次（档案主接口只回量表），失败不影响其余区块
        try {
          setSupplements(await getPersonalSupplements());
        } catch {
          setSupplements([]);
        }
      } catch (e) {
        console.error('加载档案失败', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const openedAt = earliestDate([
    ...screeningRecords.map((r) => r.date),
    ...personalTimeline.map((t) => t.date),
  ]);

  /* 档案摘要：照着远端那套口径，从当前账号的筛查/预警记录里自动生成 */
  const summary = buildSummary(screeningRecords, warningEvents);

  // 当前等级：取最近一次筛查（没有就看最近预警）
  const latest = screeningRecords[0];
  const latestLevel = latest?.level ?? warningEvents[0]?.level ?? 'green';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* ==================== 档案封面 ==================== */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-5 p-6">
          <div className="flex min-w-0 items-start gap-4">
            {/* 照片位 */}
            <div className="grid h-16 w-14 shrink-0 place-items-center overflow-hidden rounded-md border border-slate-200 bg-gradient-to-b from-slate-50 to-slate-100">
              <span className="text-[22px] font-semibold text-slate-400">
                {(userProfile.name || '—').slice(0, 1)}
              </span>
            </div>

            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                心理健康档案
              </p>
              <h1 className="mt-1 text-[24px] font-semibold leading-tight text-slate-900">
                {userProfile.name || '—'}
              </h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-slate-500">
                {[userProfile.gender, userProfile.age ? `${userProfile.age} 岁` : '',
                  userProfile.campus, userProfile.stage]
                  .filter(Boolean)
                  .join(' · ') || '资料待完善'}
              </p>
            </div>
          </div>

          {/* 建档日期 */}
          <div className="shrink-0 text-right">
            <p className="text-[10.5px] uppercase tracking-wider text-slate-400">建档日期</p>
            <p className="font-mono text-[12.5px] text-slate-600">{openedAt || '—'}</p>
          </div>
        </div>
      </div>

      {/* ==================== 基本信息 + 档案状态 ==================== */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <SectionTitle icon={UserRound} title="基本信息" />
          <div className="divide-y divide-slate-100">
            <Field label="姓名" value={userProfile.name} />
            <Field label="性别" value={userProfile.gender} />
            <Field label="年龄" value={userProfile.age ? `${userProfile.age} 岁` : ''} mono />
            <Field label="院系" value={userProfile.campus} />
            <Field label="专业" value={userProfile.major} />
            <Field label="年级" value={userProfile.stage} />
            <div className="flex items-baseline gap-3 px-5 py-2.5">
              <span className="flex w-20 shrink-0 items-center gap-1 text-[12px] text-slate-400">
                <Phone className="h-3 w-3" />
                紧急联系
              </span>
              <span
                className={`min-w-0 flex-1 break-words text-[13px] tabular-nums ${
                  userProfile.emergencyContact ? 'text-slate-800' : 'text-slate-300'
                }`}
              >
                {userProfile.emergencyContact || '未填写'}
              </span>
            </div>
          </div>
          <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-2.5">
            <p className="text-[11px] leading-5 text-slate-400">
              档案内容随筛查与记录自动更新。可以在
              <Link
                to="/personal/settings"
                className="mx-1 font-medium text-primary-600 hover:text-primary-700"
              >
                账号设置
              </Link>
              里补全或修改基本信息。
            </p>
          </div>
        </div>

        {/* 档案状态 */}
        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <SectionTitle icon={ShieldCheck} title="档案状态" />
            <div className="divide-y divide-slate-100">
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-[12px] text-slate-400">当前等级</span>
                <AlertBadge level={latestLevel} size="sm" />
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-[12px] text-slate-400">筛查次数</span>
                <span className="text-[13px] font-medium tabular-nums text-slate-800">
                  {screeningRecords.length}
                </span>
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-[12px] text-slate-400">预警次数</span>
                <span className="text-[13px] font-medium tabular-nums text-slate-800">
                  {warningEvents.length}
                </span>
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-[12px] text-slate-400">最近更新</span>
                <span className="font-mono text-[12px] text-slate-600">
                  {latest?.date?.slice(0, 10) ?? '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-400">
              <Lock className="h-3 w-3" />
              保管说明
            </p>
            <p className="mt-2 text-[12px] leading-6 text-slate-500">
              本档案仅本人与值班咨询师可见。记录用于连续性评估，
              不作为诊断结论；需要专业判断时会转介人工复核。
            </p>
          </div>
        </div>
      </div>

      {/* ==================== 记录明细：量表 / 检索 切换 ==================== */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-2.5">
          <h3 className="flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-wider text-slate-600">
            <ClipboardList className="h-3.5 w-3.5 text-slate-400" />
            筛查记录
          </h3>
          {/* 量表 / 检索 切换：两类记录都挂在"筛查记录"名下，用切换代替并列两张表 */}
          <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5">
            {([
              ['screening', '量表', screeningRecords.length],
              ['retrieval', '检索', supplements.length],
            ] as const).map(([key, label, n]) => {
              const active = recordTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRecordTab(key)}
                  aria-pressed={active}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                    active
                      ? 'bg-primary-500 text-white shadow-sm'
                      : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {label}
                  <span className={`tabular-nums ${active ? 'text-white/80' : 'text-slate-400'}`}>
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {recordTab === 'screening' ? (
          screeningRecords.length === 0 ? (
            <p className="px-5 py-10 text-center text-[12.5px] text-slate-400">
              还没有筛查记录。完成一次心理筛查后，结果会登记在这里。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-white">
                    <th className={thCls}>日期</th>
                    <th className={thCls}>量表</th>
                    <th className={thCls}>得分</th>
                    <th className={thCls}>等级</th>
                    <th className={`${thCls} text-right`}>操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {screeningRecords.map((item) => (
                    <tr key={item.id} className="transition-colors hover:bg-slate-50/70">
                      <td className={`${tdCls} whitespace-nowrap font-mono text-slate-500`}>
                        {item.date}
                      </td>
                      <td className={tdCls}>{item.questionnaire}</td>
                      <td className={`${tdCls} whitespace-nowrap tabular-nums`}>
                        {item.score}
                        <span className="text-slate-400">/{item.maxScore}</span>
                      </td>
                      <td className={tdCls}>
                        <AlertBadge level={item.level} size="sm" />
                      </td>
                      <td className={`${tdCls} whitespace-nowrap text-right`}>
                        <Link
                          to={`/personal/screening?record=${encodeURIComponent(item.id)}`}
                          className="text-[12px] font-medium text-primary-600 hover:text-primary-700"
                        >
                          查看详情
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : supplements.length === 0 ? (
          <p className="px-5 py-10 text-center text-[12.5px] text-slate-400">
            还没有检索记录。在「心理筛查分析」里写下文字、录一段语音或上传照片后，
            系统会同步做一次检索，结果登记在这里。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-white">
                  <th className={thCls}>时间</th>
                  <th className={thCls}>类型</th>
                  <th className={thCls}>内容</th>
                  <th className={thCls}>等级</th>
                  <th className={`${thCls} text-right`}>操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {supplements.map((item) => (
                  <tr key={item.id} className="transition-colors hover:bg-slate-50/70">
                    <td className={`${tdCls} whitespace-nowrap font-mono text-slate-500`}>
                      {item.createdAt ?? '—'}
                    </td>
                    <td className={tdCls}>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                        {SUP_MODALITY[item.kind] ?? item.kind}
                      </span>
                    </td>
                    <td className={`${tdCls} max-w-[280px] truncate`} title={supplementSummary(item)}>
                      {supplementSummary(item)}
                    </td>
                    <td className={tdCls}>
                      <AlertBadge level={item.analysis?.level ?? 'unknown'} size="sm" />
                    </td>
                    <td className={`${tdCls} whitespace-nowrap text-right`}>
                      <Link
                        to={`/personal/screening?tab=retrieval&assessmentSupplementId=${item.id}`}
                        className="text-[12px] font-medium text-primary-600 hover:text-primary-700"
                      >
                        查看结论
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ==================== 预警记录（明细表） ==================== */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <SectionTitle
          icon={AlertTriangle}
          title="预警记录"
          extra={`共 ${warningEvents.length} 条`}
        />
        {warningEvents.length === 0 ? (
          <p className="px-5 py-10 text-center text-[12.5px] text-slate-400">
            目前没有预警记录。当情绪、压力或睡眠出现持续变化时，系统会在这里登记。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-white">
                  <th className={thCls}>时间</th>
                  <th className={thCls}>事项</th>
                  <th className={thCls}>等级</th>
                  <th className={`${thCls} text-right`}>状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {warningEvents.map((item) => (
                  <tr key={item.id} className="transition-colors hover:bg-slate-50/70">
                    <td className={`${tdCls} whitespace-nowrap font-mono text-slate-500`}>
                      {item.createdAt}
                    </td>
                    <td className={tdCls}>{item.title}</td>
                    <td className={tdCls}>
                      <AlertBadge level={item.level} size="sm" />
                    </td>
                    <td className={`${tdCls} whitespace-nowrap text-right text-slate-500`}>
                      {item.status === 'resolved' ? '已处置' : item.status === 'tracking' ? '跟踪中' : '待处置'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ==================== 档案摘要 ==================== */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <SectionTitle icon={Sparkles} title="档案摘要" />
        {summary ? (
          <div className="space-y-2.5 px-5 py-4 text-[13px] leading-6 text-slate-600">
            {summary.map((line, index) => (
              <p key={index} className="flex gap-2">
                <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                <span>{line}</span>
              </p>
            ))}
          </div>
        ) : (
          <p className="px-5 py-10 text-center text-[12.5px] leading-6 text-slate-400">
            还没有完成的筛查记录。
            <br />
            完成一次筛查后，这里会根据你的最近记录生成摘要。
          </p>
        )}
      </div>

      {/* ==================== 关键时间线 ==================== */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <SectionTitle
          icon={Clock}
          title="关键时间线"
          extra={personalTimeline.length ? `最近 ${personalTimeline.length} 条` : undefined}
        />
        {personalTimeline.length === 0 ? (
          <p className="px-5 py-10 text-center text-[12.5px] text-slate-400">
            还没有时间线事件。完成筛查、记录近况或产生预警后会自动登记。
          </p>
        ) : (
          <ol className="divide-y divide-slate-100">
            {personalTimeline.map((event, idx) => {
              /* 事件类型标出来：问卷（筛查）与检索/采集是两类不同的留痕，
                 不加标记会让人以为时间线里全是量表 */
              const chip =
                event.type === 'screening'
                  ? { text: '筛查', cls: 'bg-primary-50 text-primary-600' }
                  : event.type === 'collection'
                    ? {
                        text: event.modalityLabel ? `检索·${event.modalityLabel}` : '检索',
                        cls: 'bg-slate-100 text-slate-600',
                      }
                    : event.type === 'warning'
                      ? { text: '预警', cls: 'bg-danger-50 text-danger-600' }
                      : { text: '计划', cls: 'bg-warning-50 text-warning-700' };
              return (
                <li key={`${event.date}-${idx}`} className="flex gap-4 px-5 py-3">
                  {/* 日期与时间分两行：时间线现在精确到分钟，一行放不下 */}
                  <span className="w-20 shrink-0 font-mono text-[11.5px] leading-5 text-slate-400">
                    {String(event.date).split(' ')[0]}
                    {String(event.date).split(' ')[1] && (
                      <>
                        <br />
                        {String(event.date).split(' ')[1]}
                      </>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${chip.cls}`}>
                        {chip.text}
                      </span>
                      <p className="text-[13px] font-medium text-slate-800">{event.title}</p>
                    </div>
                    {event.detail && (
                      <p className="mt-0.5 text-[12px] leading-5 text-slate-500">{event.detail}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* ==================== 档案说明 ==================== */}
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-5">
        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-400">
          <FileText className="h-3 w-3" />
          档案说明
        </p>
        <ul className="mt-2.5 space-y-1.5 text-[12px] leading-6 text-slate-500">
          <li>· 保持每周至少 2 次记录，连续性越完整，检索与建议越贴近你的实际情况。</li>
          <li>· 出现红色预警时不要独自承受，优先联系可信赖的同伴或学校心理支持资源。</li>
          <li>· 连续 7 天执行行动计划后，再回看趋势变化并做下一轮调整。</li>
        </ul>
      </div>

      {loading && (
        <p className="text-center text-[12px] text-slate-400">正在读取档案…</p>
      )}
    </div>
  );
}
