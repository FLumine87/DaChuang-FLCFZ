import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Clock, Sparkles, FileText, AlertTriangle, RefreshCw } from 'lucide-react';
import { type PersonalScreeningRecord, type WarningEvent, type PersonalTimelineEvent, type UserProfile } from '../data/mockData';
import { getCases } from '../services/mockApi';
import { getCurrentSession, getDisplayName } from '../auth/session';
import AlertBadge from '../components/AlertBadge';

const LEVEL_LABEL: Record<string, string> = {
  green: '稳定',
  yellow: '关注',
  orange: '警告',
  red: '高危',
};

const SCALE_LABEL: Record<string, string> = {
  'PHQ-9': '情绪筛查',
  'GAD-7': '焦虑筛查',
  ISI: '睡眠评估',
  'PSS-10': '压力评估',
};

/** 档案摘要只根据当前账号的记录生成；没有记录时返回 null，由页面提示"完成筛查后生成"。 */
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
  const scaleName = SCALE_LABEL[latest.questionnaire] ?? latest.questionnaire;
  lines.push(
    `最近一次${scaleName}（${latest.date}）得分 ${latest.score}/${latest.maxScore}，处于「${LEVEL_LABEL[latest.level] ?? latest.level}」区间。`,
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

export default function Cases() {
  const [screeningRecords, setScreeningRecords] = useState<PersonalScreeningRecord[]>([]);
  const [warningEvents, setWarningEvents] = useState<WarningEvent[]>([]);
  const [personalTimeline, setPersonalTimeline] = useState<PersonalTimelineEvent[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>({
    name: '—', age: 0, gender: '', campus: '', major: '', stage: '', emergencyContact: '',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const data = await getCases();
        if (!alive) return;
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
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '档案加载失败，请稍后重试');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  // 副标题只拼有值的字段：此前会把空字段也连起来，渲染成「名字 ·  · 0 岁 ·  ·」，
  // 而 age 的 0 是「未知」不是真的 0 岁。宁可少显示，也不要显示假的。
  const profileMeta = [
    userProfile.name,
    userProfile.gender,
    userProfile.age ? `${userProfile.age} 岁` : '',
    userProfile.stage,
    userProfile.major,
  ]
    .map((v) => (v || '').toString().trim())
    .filter(Boolean)
    .join(' · ');

  const summary = buildSummary(screeningRecords, warningEvents);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="ui-card p-5">
          <div className="h-6 w-40 animate-pulse rounded bg-slate-100" />
          <div className="mt-3 h-4 w-64 animate-pulse rounded bg-slate-100" />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="ui-card h-52 animate-pulse bg-slate-50" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ui-card p-6">
        <p className="text-[15px] font-medium text-slate-800">心理档案加载失败</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">{error}</p>
        <p className="mt-1 text-[12.5px] leading-5 text-slate-500">
          这不等于你没有记录；可能是网络或后端暂时不可用。
        </p>
        <button
          type="button"
          onClick={() => setReload((value) => value + 1)}
          className="ui-button ui-button-primary mt-4 inline-flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="ui-card p-5">
        <h2 className="text-xl font-semibold text-slate-800">我的心理档案</h2>
        <p className="text-sm text-slate-500 mt-1">{profileMeta}</p>
        <p className="text-xs text-slate-400 mt-2">
          紧急支持联系人：{userProfile.emergencyContact || '未填写'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="ui-card p-5">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-primary-600" />
            最近筛查
          </h3>
          <div className="space-y-2">
            {screeningRecords.length === 0 && (
              <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">
                还没有筛查记录。完成一次心理筛查后，最近的结果会显示在这里。
              </p>
            )}
            {screeningRecords.slice(0, 4).map((item) => (
              <div key={item.id} className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-800">{item.questionnaire}</p>
                  <AlertBadge level={item.level} size="sm" />
                </div>
                <p className="text-xs text-slate-500 mt-1">{item.score}/{item.maxScore} · {item.date}</p>
                {/* 记录详情就在筛查详情页（同一个 ScreeningDetail）：首次引导刚提交的
                    那条也在这里，点开能看到逐题作答、补充内容与本次检索快照 */}
                <Link
                  to={`/personal/screening?record=${encodeURIComponent(item.id)}`}
                  className="mt-2 inline-block text-xs font-medium text-primary-600 hover:underline"
                >
                  查看详情
                </Link>
              </div>
            ))}
          </div>
        </div>

        <div className="ui-card p-5">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-danger-500" />
            预警记录
          </h3>
          <div className="space-y-2">
            {warningEvents.length === 0 && (
              <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">
                目前没有预警记录。当情绪、压力或睡眠出现持续变化时，系统会在这里提醒你。
              </p>
            )}
            {warningEvents.map((item) => (
              <div key={item.id} className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-800">{item.title}</p>
                  <AlertBadge level={item.level} size="sm" />
                </div>
                <p className="text-xs text-slate-500 mt-1">{item.createdAt}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="ui-card p-5">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary-600" />
            档案摘要
          </h3>
          {summary ? (
            <div className="space-y-2.5 text-sm leading-6 text-slate-600">
              {summary.map((line, index) => (
                <p key={index} className="flex gap-2">
                  <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                  <span>{line}</span>
                </p>
              ))}
            </div>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm leading-6 text-slate-400">
              还没有完成的筛查记录。
              <br />
              完成一次筛查后，这里会根据你的最近记录生成摘要。
            </p>
          )}
        </div>
      </div>

      <div className="ui-card p-5">
        <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary-600" />
          关键时间线
        </h3>
        <div className="relative pl-6 space-y-5">
          <div className="absolute left-2.5 top-2 bottom-2 w-px bg-slate-200" />
          {personalTimeline.length === 0 && (
            <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">
              还没有时间线事件。完成筛查、记录情绪或产生预警后会自动生成。
            </p>
          )}
          {personalTimeline.map((event, index) => (
            /* 同一天可能有多条同标题事件（例如同一天完成两次同一量表），
               只用 date+title 会撞 key；index 只作为同 key 时的区分，排序不变。 */
            <div key={`${event.date}-${event.title}-${index}`} className="relative">
              <span className="absolute -left-[18px] w-3 h-3 rounded-full bg-primary-500 border-2 border-white" />
              <p className="text-xs text-slate-400">{event.date}</p>
              <p className="text-sm text-slate-800 mt-1">{event.title}</p>
              <p className="text-sm text-slate-500 mt-1">{event.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="ui-card p-5">
        <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary-600" />
          使用建议
        </h3>
        <ul className="text-sm text-slate-600 space-y-2 list-disc pl-5">
          <li>保持每周至少 2 次记录，提升检索与 RAG 建议准确度。</li>
          <li>出现红色预警时，不要独自承受，优先联系可信赖同伴或学校心理支持资源。</li>
          <li>连续 7 天执行行动计划后，再查看趋势变化并做下一轮调整。</li>
        </ul>
      </div>
    </div>
  );
}
