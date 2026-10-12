import { useEffect, useState } from 'react';
import { Bell, RefreshCw, AlertTriangle, Music, Trophy, BookOpen, Film, UtensilsCrossed, Heart } from 'lucide-react';
import { api, type AlertItem, type InferenceRunResult, type CopingRecommendation } from '../../services/api';
import { getCurrentSession } from '../../auth/session';

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
  const [activeTab, setActiveTab] = useState<'status' | 'interest'>('status');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [feedResult, alertList] = await Promise.all([
        api.runInference(userId),
        api.listAlerts(userId),
      ]);
      setFeed(feedResult);
      setAlerts(alertList);
      // 绿级或稳定期同时加载兴趣推送
      if (feedResult.report.risk_level === 'green') {
        const interestResult = await api.getInterestFeed(userId, 4);
        setInterestFeed(interestResult);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Bell className="w-4 h-4 text-emerald-600" /> 个性化推送
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            基于你的心理状况评估 + 兴趣画像，为你定制缓解内容
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-medium hover:bg-emerald-100 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-danger-600 bg-danger-50 border border-danger-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* 状态卡片 */}
      {feed && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <p className="text-xs text-slate-500">当前状态</p>
            <p className={`text-lg font-bold mt-1 ${
              feed.report.risk_level === 'red' ? 'text-red-600' :
              feed.report.risk_level === 'orange' ? 'text-orange-600' :
              feed.report.risk_level === 'yellow' ? 'text-yellow-600' : 'text-emerald-600'
            }`}>{feed.report.risk_label}</p>
            <p className="text-xs text-slate-400 mt-1">综合分 {feed.report.overall_score}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <p className="text-xs text-slate-500">本次更新</p>
            <p className="text-lg font-bold mt-1 text-slate-700">{feed.report.created_at.slice(5, 16)}</p>
            <p className="text-xs text-slate-400 mt-1">
              {feed.report.alert_created ? '已同步生成预警' : '未触发预警'}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm col-span-2 md:col-span-1">
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

      {/* 缓解内容推送（按状态） */}
      {feed && activeTab === 'status' && feed.content_feed.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">为你推荐</h3>
          <div className="space-y-3">
            {feed.content_feed.map((item, i) => {
              const Icon = CATEGORY_ICON[item.category ?? ''] ?? BookOpen;
              return (
                <div key={i} className="flex gap-3 border border-slate-100 rounded-xl p-4 hover:border-emerald-200 transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                    <Icon className="w-4.5 h-4.5 text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800">{item.name}</p>
                    {item.suggestion && (
                      <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap leading-relaxed">{item.suggestion}</p>
                    )}
                    <p className="text-xs text-emerald-600 mt-2">{item.reason}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 纯兴趣推送（绿级稳定期） */}
      {activeTab === 'interest' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">兴趣推送</h3>
          {interestFeed.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">
              {feed?.report.risk_level === 'green'
                ? '暂无兴趣画像数据，去对话页聊聊你的爱好吧'
                : '当前状态不适合兴趣推送，先关注状态推荐'}
            </p>
          ) : (
            <div className="space-y-3">
              {interestFeed.map((item, i) => {
                const Icon = CATEGORY_ICON[item.category ?? ''] ?? BookOpen;
                return (
                  <div key={i} className="flex gap-3 border border-slate-100 rounded-xl p-4 hover:border-emerald-200 transition-colors">
                    <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                      <Icon className="w-4.5 h-4.5 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800">{item.name}</p>
                      {item.suggestion && (
                        <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap leading-relaxed">{item.suggestion}</p>
                      )}
                      <p className="text-xs text-emerald-600 mt-2">{item.reason}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 预警记录 */}
      {alerts.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">预警记录</h3>
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-center gap-3 border border-slate-100 rounded-xl px-4 py-3">
                <span className={`px-2 py-1 rounded text-xs font-bold ${
                  a.level === 'red' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                }`}>{a.level === 'red' ? '红' : '橙'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 truncate">{a.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{a.created_at.slice(0, 16)} · {a.reason ?? ''}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  a.status === 'pending' ? 'bg-yellow-50 text-yellow-700' :
                  a.status === 'closed' ? 'bg-slate-100 text-slate-500' :
                  'bg-blue-50 text-blue-700'
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
