import { useEffect, useState } from 'react';
import { Bell, RefreshCw, AlertTriangle, Music, Trophy, BookOpen, Film, UtensilsCrossed, Heart, HardDrive } from 'lucide-react';
import { api, type InferenceRunResult, type CopingRecommendation } from '../../services/api';
import { getWarnings } from '../../services/mockApi';
import type { WarningEvent } from '../../data/mockData';
import { getCurrentSession } from '../../auth/session';
import { briefErrorMessage } from '../../services/http';
import { buildLocalFeed, buildLocalReport, collectLocalSignals, type LocalAdvice } from '../../services/localKg';

const CATEGORY_ICON: Record<string, typeof Music> = {
  音乐: Music, 体育赛事: Trophy, 运动: Trophy,
  影视: Film, 电影: Film, 剧集: Film,
  书籍: BookOpen, 小说: BookOpen, 读书: BookOpen,
  漫画: BookOpen, 动漫: BookOpen,
  美食: UtensilsCrossed, 烹饪: UtensilsCrossed,
  冥想: BookOpen, 认知: BookOpen, 社交: BookOpen, 专业帮助: BookOpen,
};

export default function FeedPage() {
  const session = getCurrentSession();
  const userId = session?.username ?? 'demo_user';

  const [feed, setFeed] = useState<InferenceRunResult | null>(null);
  /**
   * 预警统一取自主服务端（8000 GET /api/personal/warnings）。
   * 个人端（8001）不产预警：它的图谱推理只输出参考，筛查分层由主业务后端统一判定，
   * 所以 /api/v1/alerts 永远是空表。此前这里调的是 8001，导致"累积预警"恒为 0 条，
   * 与「预警」页显示的条数互相矛盾——同一个概念两个数据源。现统一到服务端。
   */
  const [alerts, setAlerts] = useState<WarningEvent[]>([]);
  const [interestFeed, setInterestFeed] = useState<CopingRecommendation[]>([]);
  /** 本机记录生成的条目（L1）：服务端没有内容时用它兜底 */
  const [localItems, setLocalItems] = useState<LocalAdvice[]>([]);
  const [source, setSource] = useState<'server' | 'local'>('server');
  const [notice, setNotice] = useState('');
  const [activeTab, setActiveTab] = useState<'status' | 'interest'>('status');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    setNotice('');
    /* 本机数据（量表记录 + 补充记录关键词 + 对话抽取的三元组）先算好：
       服务端拿不到就直接用它，页面不会空着，也不需要假数据填空。 */
    const signals = await collectLocalSignals(userId);
    const local = buildLocalFeed(signals);
    setLocalItems(local);

    const [feedResult, alertResult] = await Promise.allSettled([
      api.runInference(userId),
      getWarnings(),
    ]);

    if (feedResult.status === 'fulfilled') {
      setFeed(feedResult.value);
      setSource('server');
      if (feedResult.value.report.mock) {
        /* 只描述真实状态：mock_mode 现在是"没有真实大模型 Key，正文走模板"，
           与图谱是否连接无关（Neo4j 已接通，不能再写"未连接个人知识图谱"）。 */
        setNotice('服务端处于演示模式 · 模板生成：报告正文由后端模板组装（尚未配置大模型 Key）。');
      }
    } else {
      /* 服务端推理不可用：用本机记录组装一份同结构的报告，页面结构照旧 */
      setFeed(buildLocalReport(userId, signals) as unknown as InferenceRunResult);
      setSource('local');
      /* 只放一句人话：axios 的消息可能带着原始响应体（裸 JSON），不能直接展示 */
      setError(briefErrorMessage(feedResult.reason, '未连接到服务端'));
    }
    setAlerts(alertResult.status === 'fulfilled' ? alertResult.value : []);

    /* Interests do not require inferring that an unknown graph status is healthy. */
    if (feedResult.status === 'fulfilled' && (feedResult.value.report.reference_only || feedResult.value.report.risk_level === 'unknown' || feedResult.value.report.risk_level === 'green')) {
      try {
        setInterestFeed(await api.getInterestFeed(userId, 4));
      } catch {
        setInterestFeed([]);
      }
    } else {
      setInterestFeed([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /* 推荐内容：服务端优先，其次本机记录（L1）。两者结构一致，渲染复用同一个组件。
     注意"报告来自服务端"不等于"推荐内容也来自服务端"：服务端可能只回了报告、
     content_feed 为空，此时列表实际是本机记录组装的。来源标识必须跟内容走，
     否则就会出现"顶部写服务端推理、正文说本机记录"的自相矛盾。 */
  const statusFromServer =
    source === 'server' && Boolean(feed && feed.content_feed.length > 0);
  const statusItems = statusFromServer ? feed!.content_feed : localItems;
  const interestItems = interestFeed.length > 0 ? interestFeed : localItems;
  const reportSourceLabel =
    source === 'local'
      ? '本机记录整理'
      : feed?.report.mock
        ? '服务端演示模式 · 模板生成'
        : '服务端推理';
  const statusSourceLabel = statusFromServer ? '服务端内容' : '本机记录整理';
  const interestSourceLabel = interestFeed.length > 0 ? '服务端兴趣画像' : '本机记录整理';

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="ui-card p-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary-600" /> 个性化推送
          </h2>
          <p className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>根据你的量表记录、对话线索与兴趣画像整理缓解内容</span>
            {feed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                <HardDrive className="w-3 h-3" />
                报告来源：{reportSourceLabel}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-50 text-primary-600 text-sm font-medium hover:bg-primary-100 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {notice && (
        <div className="ui-card flex items-center gap-2 px-3 py-2 text-sm text-slate-600">
          <AlertTriangle className="w-4 h-4 shrink-0 text-warning-500" /> {notice}
        </div>
      )}

      {/* 服务端取不到时的如实说明：不再把原始 503/401 文本糊在页面上 */}
      {source === 'local' && (
        <div className="ui-card flex items-start gap-2 px-3 py-2 text-sm text-slate-600">
          <AlertTriangle className="mt-0.5 w-4 h-4 shrink-0 text-warning-500" />
          <span>
            服务端推理暂时取不到{error ? `（${error}）` : ''}，下面的内容由本机记录组装，未经过服务端图谱推理。
          </span>
        </div>
      )}

      {/* 状态卡片 */}
      {feed && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="ui-card p-4">
            <p className="text-xs text-slate-500">参考来源</p>
            <p className={`text-lg font-bold mt-1 ${
              feed.report.reference_only || feed.report.risk_level === 'unknown' || source === 'local' ? 'text-slate-700' :
              feed.report.risk_level === 'red' ? 'text-danger-600' :
              feed.report.risk_level === 'orange' ? 'text-orange-600' :
              feed.report.risk_level === 'yellow' ? 'text-warning-600' : 'text-success-600'
            }`}>{source === 'local' ? '本机记录参考' : feed.report.reference_only || feed.report.risk_level === 'unknown' ? '图谱参考，待标准筛查' : feed.report.risk_label}</p>
            <p className="text-xs text-slate-400 mt-1">参考匹配分不作为本人风险分数</p>
          </div>
          <div className="ui-card p-4">
            <p className="text-xs text-slate-500">本次更新</p>
            <p className="text-lg font-bold mt-1 text-slate-700">{feed.report.created_at.slice(5, 16)}</p>
            <p className="text-xs text-slate-400 mt-1">
              {feed.report.reference_only || feed.report.risk_level === 'unknown' || source === 'local' ? '仅更新参考，不据此生成风险结论' : feed.report.alert_created ? '已同步生成预警' : '未触发预警'}
            </p>
          </div>
          <div className="ui-card p-4 col-span-2 md:col-span-1">
            <p className="text-xs text-slate-500">累积预警</p>
            <p className="text-lg font-bold mt-1 text-slate-700">{alerts.length} 条</p>
            <p className="text-xs text-slate-400 mt-1">
              {alerts.filter((a) => a.status !== 'resolved').length} 条待处理
            </p>
          </div>
        </div>
      )}

      {/* 内容推送标签切换 */}
      {feed && (
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab('status')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'status' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            状态推荐
          </button>
          <button
            onClick={() => setActiveTab('interest')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'interest' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Heart className="w-3.5 h-3.5 inline mr-1" />兴趣推送
          </button>
        </div>
      )}

      {/* 缓解内容推送（按状态）：服务端有内容用服务端的，没有就用本机记录生成的条目 */}
      {feed && activeTab === 'status' && (
        <div className="ui-card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">为你推荐</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
              内容来源：{statusSourceLabel}
            </span>
          </div>
          {statusItems.length > 0 ? (
            <FeedItems items={statusItems} />
          ) : (
            <p className="text-sm text-slate-400 py-4 text-center">
              本机还没有可用的量表记录或对话记录，暂时给不出推荐。
            </p>
          )}
        </div>
      )}

      {/* 兴趣推送（绿级稳定期）：服务端兴趣画像优先，其次本机记录 */}
      {activeTab === 'interest' && (
        <div className="ui-card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">兴趣推送</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
              内容来源：{interestSourceLabel}
            </span>
          </div>
          {interestItems.length > 0 ? (
            <FeedItems items={interestItems} />
          ) : (
            <p className="text-sm text-slate-400 py-4 text-center">
              暂无可用兴趣画像数据，可以去对话页补充自己的爱好。
            </p>
          )}
        </div>
      )}

      {/* 预警记录（统一取自主服务端，与「预警」页同源） */}
      {alerts.length > 0 && (
        <div className="ui-card p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">预警记录</h3>
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-center gap-3 border border-slate-100 rounded-xl px-4 py-3">
                <span className={`px-2 py-1 rounded text-xs font-bold ${
                  a.level === 'red' ? 'bg-danger-50 text-danger-600' :
                  a.level === 'orange' ? 'bg-orange-50 text-orange-600' :
                  a.level === 'yellow' ? 'bg-warning-50 text-warning-600' :
                  'bg-success-50 text-success-600'
                }`}>{
                  a.level === 'red' ? '红' : a.level === 'orange' ? '橙' :
                  a.level === 'yellow' ? '黄' : '绿'
                }</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 truncate">{a.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{(a.createdAt ?? '').slice(0, 16)} · {a.reason ?? ''}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  a.status === 'new' ? 'bg-warning-50 text-warning-600' :
                  a.status === 'tracking' ? 'bg-primary-50 text-primary-600' :
                  'bg-slate-100 text-slate-500'
                }`}>
                  {a.status === 'new' ? '待确认' : a.status === 'tracking' ? '跟进中' : '已缓解'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 免责声明 */}
      {feed && (
        <p className="text-xs text-slate-400 text-center pb-2">{feed.report.disclaimer}</p>
      )}
    </div>
  );
}

/** 一条推送：服务端 CopingRecommendation 与本机 LocalAdvice 结构一致，共用一套渲染 */
function FeedItems({
  items,
}: {
  items: { name: string; category?: string | null; suggestion?: string | null; reason: string }[];
}) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const Icon = CATEGORY_ICON[item.category ?? ''] ?? BookOpen;
        return (
          <div
            key={`${item.name}-${i}`}
            className="flex gap-3 border border-slate-100 rounded-xl p-4 hover:border-primary-200 transition-colors"
          >
            <div className="w-9 h-9 rounded-lg bg-primary-50 flex items-center justify-center shrink-0">
              <Icon className="w-4.5 h-4.5 text-primary-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800">{item.name}</p>
              {/* break-words 是必需的，不是装饰：推荐文案里会带程序拼接的搜索链接
                  （网易云是 https://music.163.com/#/search/m/?s=%E7%A7%A6... 这种
                  百分号编码串），整串没有任何空格。whitespace-pre-wrap 只保留换行，
                  它的 overflow-wrap 仍是默认的 normal —— 不在"词内"断行，于是这条
                  长链接会把文字顶出卡片右边界（用户截图反馈的问题）。
                  break-words 让超长不可断串在必要时从任意位置折行，中文正文不受影响。 */}
              {item.suggestion && (
                <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap break-words leading-relaxed">{item.suggestion}</p>
              )}
              <p className="text-xs text-primary-600 mt-2 break-words">{item.reason}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
