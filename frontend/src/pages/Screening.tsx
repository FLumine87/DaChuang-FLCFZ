import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import ScreeningDetail from './ScreeningDetail';
import {
  Search,
  Filter,
  ChevronDown,
  PlayCircle,
  ClipboardCheck,
  Info,
  X,
  Clock3,
  Target,
  BarChart3,
  ShieldCheck,
} from 'lucide-react';
import { questionnaireCatalog, type PersonalScreeningRecord } from '../data/mockData';
import { questionnaires } from '../data/questionnaireData';
import { getScreeningRecords, saveScreeningRetrieval, submitScreening } from '../services/mockApi';
import { api } from '../services/api';
import { loadFirstRunEvidence, toRetrievalSnapshot } from '../services/firstRunRetrieval';
import { getCurrentSession } from '../auth/session';
import AlertBadge from '../components/AlertBadge';
import StatusBadge from '../components/StatusBadge';
import QuestionnaireForm from '../components/QuestionnaireForm';

type AlertLevel = 'green' | 'yellow' | 'orange' | 'red';

export default function Screening() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('record');
  // ?paper=PHQ-9 时直接打开该量表的作答表单（多模态采集页的量表卡片跳到这里）
  const paperParam = params.get('paper');
  const [savedRecord, setSavedRecord] = useState<PersonalScreeningRecord | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLevel, setFilterLevel] = useState<'all' | AlertLevel>('all');
  const [activeQuestionnaire, setActiveQuestionnaire] = useState<string | null>(paperParam);
  const [infoQuestionnaire, setInfoQuestionnaire] = useState<string | null>(null);
  const [localRecords, setLocalRecords] = useState<PersonalScreeningRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [kgSyncMsg, setKgSyncMsg] = useState<string | null>(null);
  const userId = getCurrentSession()?.username ?? 'demo_user';

  const fetchRecords = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getScreeningRecords();
      setLocalRecords(data);
    } catch (e) {
      console.error('加载筛查记录失败', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeQuestionnaire, selectedId]);

  // 让 ?paper= 成为"当前在作答哪个量表"的唯一来源：
  // 带参数进来会打开表单，参数被清掉（点侧栏/关闭表单）则回到列表
  useEffect(() => {
    setActiveQuestionnaire(paperParam);
  }, [paperParam]);

  useEffect(() => {
    if (!infoQuestionnaire) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInfoQuestionnaire(null);
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [infoQuestionnaire]);

  const selectedInfo = questionnaires.find((item) => item.id === infoQuestionnaire);

  /* 只列真实历史记录，全部汇总在一起。
     原先用 ?example=1 往列表头部插一条示例记录，和真实记录混在同一张表里，
     再靠"示例记录"标签区分 —— 用户要求不区分，直接去掉这套。 */
  const records = localRecords;
  const selectedRecord = records.find(record => record.id === selectedId) ?? (savedRecord?.id === selectedId ? savedRecord : undefined);
  const filtered = records.filter(
    (record) =>
      (record.id.includes(searchTerm) || record.questionnaire.toLowerCase().includes(searchTerm.toLowerCase())) &&
      (filterLevel === 'all' || record.level === filterLevel)
  );

  /* 合并要点：团队 main 给 onComplete 加了第 4 个参数 answers（答卷逐题得分要一起落库，
     供分析依据里的检索用），我们这版则负责"提交成功先本地存一份再跳详情"。
     两边都留：answers 透传给 submitScreening，保存与跳转逻辑仍走我们这版。 */
  const handleComplete = async (
    score: number,
    maxScore: number,
    level: AlertLevel,
    answers: Record<string, number>,
  ) => {
    let recordId: string | null = null;
    try {
      const response = await submitScreening({
        questionnaire: activeQuestionnaire!,
        score,
        maxScore,
        level,
        answers,
      });
      if (response.status !== 'success') throw new Error('筛查尚未保存，请重试');
      recordId = response.id;
      setSavedRecord({ id: response.id, questionnaire: activeQuestionnaire!, score, maxScore, level, status: 'completed', moodTag: '已完成', date: new Date().toLocaleDateString('sv-SE') });
      setParams({ record: response.id });
    } catch (e) {
      console.error('提交筛查失败', e);
      throw e;
    }
    setActiveQuestionnaire(null);
    // 重新从后端拉取（真实模式下后端会生成筛查记录与分级预警）
    await fetchRecords();

    /* 本次「检索与解释」的快照写进这条记录（L1：只存在浏览器本地）。
       与首次引导 02 提交走的是同一套：拿不到就存 unavailable，不编造。
       写完再刷一次列表，这样马上打开详情也能看到这一块。 */
    if (recordId) {
      const id = recordId;
      void loadFirstRunEvidence(userId)
        .then((evidence) => saveScreeningRetrieval(id, toRetrievalSnapshot(evidence)))
        .catch(() =>
          saveScreeningRetrieval(id, {
            at: new Date().toISOString(),
            mode: 'unavailable',
            reason: '检索服务暂不可用',
          }),
        )
        .then(() => fetchRecords())
        .catch(() => undefined);
    }

    // 量表得分自动回写个人 KG（失败静默，不阻塞 UI）
    if (activeQuestionnaire) {
      api.submitScaleScore(userId, activeQuestionnaire, score, true)
        .then((r) => {
          /* 「写入图谱」与「给出风险评估」是两件事：Neo4j 未连接时 written=0（确实没写进去），
             但后端 mock 通路仍能返回一份模板报告。分开放两句话说，别混成一句"已写入"。 */
          if (r.written > 0) {
            setKgSyncMsg(
              r.inference_triggered && r.report
                ? `已写入知识图谱，最新风险评估：${r.report.risk_label}（综合分 ${r.report.overall_score}）`
                : '量表得分已写入个人知识图谱',
            );
          } else if (r.inference_triggered && r.report) {
            setKgSyncMsg(
              `量表得分未写入知识图谱（Neo4j 未连接）；已按演示模板给出风险评估：${r.report.risk_label}`,
            );
          }
        })
        .catch(() => setKgSyncMsg('量表得分写入知识图谱失败（Neo4j 未连接？），不影响本地记录'));
      setTimeout(() => setKgSyncMsg(null), 8000);
    }
  };

  if (activeQuestionnaire) {
    return (
      <div className="space-y-4">
        <QuestionnaireForm
          questionnaireId={activeQuestionnaire}
          onClose={() => {
            setActiveQuestionnaire(null);
            // 清掉 ?paper=，避免刷新后又被自动打开
            if (paperParam) {
              setParams({}, { replace: true });
            }
          }}
          onComplete={handleComplete}
        />
      </div>
    );
  }

  if (selectedRecord) return <ScreeningDetail record={selectedRecord} onBack={() => setParams({}, { replace: true })} />;
  if (selectedId) return <div className="ui-card p-6"><p className="text-sm text-slate-500">{loading ? '正在加载筛查详情…' : '未找到该筛查记录，请返回列表重试。'}</p><button className="ui-button mt-4" onClick={() => setParams({})}>返回筛查记录</button></div>;

  return (
    <div className="space-y-6">
      {/* 量表回写知识图谱的结果提示（团队 main 的功能）：容器换成 .ui-card，
          内层配色改走令牌，深色下不再是一块固定的浅绿。 */}
      {kgSyncMsg && (
        <div className="ui-card flex items-center gap-2 px-4 py-2.5 text-sm text-slate-600">
          <ClipboardCheck className="w-3.5 h-3.5 shrink-0 text-primary-500" /> {kgSyncMsg}
        </div>
      )}
      <div className="ui-card p-5">
        <h3 className="text-base font-semibold text-slate-800">筛查说明</h3>
        <p className="text-sm text-slate-500 mt-2 leading-6">
          这里提供个人自助心理筛查。系统会结合你的量表结果、文本/语音/图像采集结果，进行动态跨模态哈希检索和
          RAG 风险解释，用于"早发现、早干预"。结果仅作参考，不构成诊断。
        </p>
      </div>

      {/* Questionnaire Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {questionnaireCatalog.map((item) => (
          <div
            key={item.id}
            className="ui-card p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="text-base font-semibold text-slate-800">{item.name}</h4>
                <p className="text-sm text-slate-500 mt-2">{item.description}</p>
              </div>
              <ClipboardCheck className="w-5 h-5 text-primary-600 shrink-0 mt-1" />
            </div>
            <div className="flex items-center gap-4 mt-4 text-xs text-slate-500">
              <span>{item.questions} 题</span>
              <span>约 {item.minutes} 分钟</span>
              <span>关注：{item.target}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set('paper', item.id);
                  setParams(next);
                }}
                className="ui-button ui-button-primary"
              >
                <PlayCircle className="w-4 h-4" /> 开始 {item.id}
              </button>
              <button
                onClick={() => setInfoQuestionnaire(item.id)}
                className="ui-button"
                aria-label={`了解 ${item.name}`}
              >
                <Info className="w-4 h-4" /> 了解量表
              </button>
            </div>
          </div>
        ))}
      </div>

      {selectedInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setInfoQuestionnaire(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="questionnaire-info-title"
            className="app-scrollbar max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-start gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                <ClipboardCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary-600">
                  {selectedInfo.id} · 量表简介
                </p>
                <h2 id="questionnaire-info-title" className="mt-1 text-xl font-semibold text-slate-900">
                  {selectedInfo.name}
                </h2>
              </div>
              <button
                onClick={() => setInfoQuestionnaire(null)}
                className="ui-icon-button"
                aria-label="关闭量表介绍"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5 px-5 py-5 sm:px-6">
              <p className="text-sm leading-7 text-slate-600">
                {selectedInfo.introduction.summary}
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <Target className="h-4 w-4 text-primary-600" /> 主要关注什么
                  </div>
                  <ul className="mt-3 space-y-2 text-sm text-slate-600">
                    {selectedInfo.introduction.measures.map((measure) => (
                      <li key={measure} className="flex gap-2">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400" />
                        <span>{measure}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <Info className="h-4 w-4 text-primary-600" /> 什么时候适合做
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {selectedInfo.introduction.suitableFor}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <Clock3 className="h-4 w-4 text-primary-600" /> 回答时间范围
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {selectedInfo.introduction.recallPeriod}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <BarChart3 className="h-4 w-4 text-primary-600" /> 结果如何理解
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {selectedInfo.introduction.scoreBands.map((band) => (
                    <div key={band.range} className="rounded-lg bg-slate-50 px-3 py-2.5">
                      <p className="text-sm font-semibold text-slate-800">{band.range} 分</p>
                      <p className="mt-0.5 text-xs leading-5 text-slate-500">{band.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-primary-100 bg-primary-50/70 p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">请注意</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      {selectedInfo.introduction.notice}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              <button onClick={() => setInfoQuestionnaire(null)} className="ui-button">
                稍后再做
              </button>
              <button
                onClick={() => {
                  setInfoQuestionnaire(null);
                  setActiveQuestionnaire(selectedInfo.id);
                }}
                className="ui-button ui-button-primary"
              >
                <PlayCircle className="h-4 w-4" /> 开始 {selectedInfo.id}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Toolbar */}
      <div className="ui-card flex flex-wrap items-center justify-between gap-3 p-5">
        <div><h3 className="font-semibold text-slate-800">我的筛查记录</h3><p className="mt-1 text-sm text-slate-500">完成筛查后，点击下方记录的“查看详情”，回看得分、解释和建议。</p></div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="搜索编号或量表..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent w-64"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <select
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value as 'all' | AlertLevel)}
              className="pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
            >
              <option value="all">全部等级</option>
              <option value="red">危险</option>
              <option value="orange">警告</option>
              <option value="yellow">关注</option>
              <option value="green">稳定</option>
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
        </div>
        <p className="text-sm text-slate-500">
          {loading ? '加载中…' : `共 ${filtered.length} 条记录`}
        </p>
      </div>

      {/* Table */}
      <div className="ui-card overflow-hidden">
        <div className="ui-table-scroll"><table className="ui-table">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">编号</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">问卷</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">得分</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">预警等级</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">状态</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">情绪标签</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">日期</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((record) => (
              <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-5 py-3.5 text-sm font-mono text-slate-500">{record.id}</td>
                <td className="px-5 py-3.5 text-sm text-slate-600">{record.questionnaire}</td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{record.score}</span>
                    <span className="text-xs text-slate-400">/ {record.maxScore}</span>
                    <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          record.level === 'red' ? 'bg-danger-500' :
                          record.level === 'orange' ? 'bg-orange-500' :
                          record.level === 'yellow' ? 'bg-warning-500' : 'bg-success-500'
                        }`}
                        style={{ width: `${(record.score / record.maxScore) * 100}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3.5"><AlertBadge level={record.level} size="sm" /></td>
                <td className="px-5 py-3.5"><StatusBadge status={record.status} /></td>
                <td className="px-5 py-3.5 text-sm text-slate-600">{record.moodTag}</td>
                <td className="px-5 py-3.5 text-sm text-slate-500">{record.date}</td>
                <td className="px-5 py-3.5"><button className="whitespace-nowrap text-sm font-medium text-primary-600 hover:underline" onClick={() => setParams({ record: record.id })}>查看详情</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">
            {loading
              ? '正在加载筛查记录…'
              : records.length === 0
                ? '还没有筛查记录。从上方选择一个量表开始作答，结果会显示在这里。'
                : '当前筛选条件下没有筛查记录，试试清空搜索词或把等级改成全部。'}
          </div>
        )}
      </div>
    </div>
  );
}
