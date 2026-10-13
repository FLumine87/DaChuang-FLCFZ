import { useEffect, useState } from 'react';
import { Bell, RefreshCw, AlertTriangle, Music, Trophy, BookOpen, Film, UtensilsCrossed, Heart, HardDrive } from 'lucide-react';
import { api, type AlertItem, type InferenceRunResult, type CopingRecommendation } from '../../services/api';
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
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
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
      api.listAlerts(userId),
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

    /* 绿级或稳定期同时加载兴趣推送；服务端没有就用本机条目 */
    if (feedResult.status === 'fulfilled' && feedResult.value.report.risk_level === 'green') {
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

  /* 推荐内容：服务端优先，其次本机记录（L1）。两者结构一致，渲染复用同一个组件。 */
  const statusItems = feed && feed.content_feed.length > 0 ? feed.content_feed : localItems;
  const interestItems = interestFeed.length > 0 ? interestFeed : localItems;

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="ui-card p-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary-600" /> 个性化推送
          </h2>
          <p className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>基于你的心理状况评估 + 兴趣画像，为你定制缓解内容</span>
            {feed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                <HardDrive className="w-3 h-3" />
                {source === 'local'
                  ? '本机组装（localStorage）'
                  : feed.report.mock
                    ? '演示模式 · 模板生成'
                    : '服务端推理'}
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
            <p className="text-xs text-slate-500">当前状态</p>
            <p className={`text-lg font-bold mt-1 ${
              feed.report.risk_level === 'red' ? 'text-danger-600' :
              feed.report.risk_level === 'orange' ? 'text-orange-600' :
              feed.report.risk_level === 'yellow' ? 'text-warning-600' : 'text-success-600'
            }`}>{feed.report.risk_label}</p>
            <p className="text-xs text-slate-400 mt-1">综合分 {feed.report.overall_score}</p>
          </div>
          <div className="ui-card p-4">
            <p className="text-xs text-slate-500">本次更新</p>
            <p className="text-lg font-bold mt-1 text-slate-700">{feed.report.created_at.slice(5, 16)}</p>
            <p className="text-xs text-slate-400 mt-1">
              {feed.report.alert_created ? '已同步生成预警' : '未触发预警'}
            </p>
          </div>
          <div className="ui-card p-4 col-span-2 md:col-span-1">
            <p className="text-xs text-slate-500">累积预警</p>
            <p className="text-lg font-bold mt-1 text-slate-700">{alerts.length} 条</p>
            <p className="text-xs text-slate-400 mt-1">
              {alerts.filter((a) => a.status === 'pending').length} 条待确认
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
          <h3 className="text-sm font-semibold text-slate-800 mb-3">为你推荐</h3>
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
          <h3 className="text-sm font-semibold text-slate-800 mb-3">兴趣推送</h3>
          {interestItems.length > 0 ? (
            <FeedItems items={interestItems} />
          ) : (
            <p className="text-sm text-slate-400 py-4 text-center">
              {feed?.report.risk_level === 'green'
                ? '暂无兴趣画像数据，去对话页聊聊你的爱好吧'
                : '当前状态不适合兴趣推送，先关注状态推荐'}
            </p>
          )}
        </div>
      )}

      {/* 预警记录 */}
      {alerts.length > 0 && (
        <div className="ui-card p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">预警记录</h3>
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-center gap-3 border border-slate-100 rounded-xl px-4 py-3">
                <span className={`px-2 py-1 rounded text-xs font-bold ${
                  a.level === 'red' ? 'bg-danger-50 text-danger-600' : 'bg-orange-50 text-orange-600'
                }`}>{a.level === 'red' ? '红' : '橙'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 truncate">{a.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{a.created_at.slice(0, 16)} · {a.reason ?? ''}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  a.status === 'pending' ? 'bg-warning-50 text-warning-600' :
                  a.status === 'closed' ? 'bg-slate-100 text-slate-500' :
                  'bg-primary-50 text-primary-600'
                }`}>
                  {a.status === 'pending' ? '待确认' : a.status === 'confirmed' ? '已确认' :
                   a.status === 'processing' ? '跟进中' : '已关闭'}
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
              {item.suggestion && (
                <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap leading-relaxed">{item.suggestion}</p>
              )}
              <p className="text-xs text-primary-600 mt-2">{item.reason}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
