import { useState, useEffect } from 'react';
import {
  FileText, Mic, ImageIcon, Search, ChevronDown,
  AlertTriangle, CheckCircle2, Clock, Loader2, Eye, X,
} from 'lucide-react';
import {
  type TextSubmission, type AudioSubmission, type ImageSubmission, type AnalysisStatus,
} from '../data/adminMockData';
import { getAdminCollectionData } from '../../services/mockApi';
import AdminAlertBadge from '../components/AdminAlertBadge';

type Tab = 'text' | 'audio' | 'image';

// ─── Status badge ─────────────────────────────────────────────────────────────
const statusConfig: Record<AnalysisStatus, { label: string; icon: typeof CheckCircle2; cls: string }> = {
  pending:    { label: '待分析',  icon: Clock,         cls: 'text-slate-500 bg-slate-100' },
  processing: { label: '分析中',  icon: Loader2,       cls: 'text-blue-600 bg-blue-50' },
  done:       { label: '已完成',  icon: CheckCircle2,  cls: 'text-green-700 bg-green-50' },
  flagged:    { label: '高风险',  icon: AlertTriangle, cls: 'text-danger-600 bg-danger-50' },
};

function AnalysisBadge({ status }: { status: AnalysisStatus }) {
  const cfg = statusConfig[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ─── Generic filter bar ───────────────────────────────────────────────────────
function FilterBar({
  search, onSearch, status, onStatus, risk, onRisk,
}: {
  search: string; onSearch: (v: string) => void;
  status: string; onStatus: (v: string) => void;
  risk: string;   onRisk: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="搜索用户名..."
          className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white w-52 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      <div className="relative">
        <select
          value={status}
          onChange={(e) => onStatus(e.target.value)}
          className="pl-3 pr-8 py-2 border border-slate-200 rounded-lg text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
        >
          <option value="all">全部状态</option>
          <option value="flagged">高风险</option>
          <option value="processing">分析中</option>
          <option value="done">已完成</option>
          <option value="pending">待分析</option>
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      </div>

      <div className="relative">
        <select
          value={risk}
          onChange={(e) => onRisk(e.target.value)}
          className="pl-3 pr-8 py-2 border border-slate-200 rounded-lg text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
        >
          <option value="all">全部风险</option>
          <option value="red">危险</option>
          <option value="orange">警告</option>
          <option value="yellow">关注</option>
          <option value="green">正常</option>
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      </div>
    </div>
  );
}

// ─── Text Tab ─────────────────────────────────────────────────────────────────
function TextTab({ rows }: { rows: TextSubmission[] }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [risk, setRisk] = useState('all');
  const [selected, setSelected] = useState<TextSubmission | null>(null);

  const filtered = rows.filter(
    (t) =>
      t.username.includes(search) &&
      (status === 'all' || t.analysisStatus === status) &&
      (risk === 'all' || t.riskLevel === risk)
  );

  return (
    <div className="space-y-4">
      <FilterBar search={search} onSearch={setSearch} status={status} onStatus={setStatus} risk={risk} onRisk={setRisk} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="ui-card lg:col-span-2 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <p className="text-sm font-semibold text-slate-700">文本日记列表</p>
            <p className="text-xs text-slate-400">共 {filtered.length} 条</p>
          </div>
          <div className="ui-table-scroll"><table className="ui-table">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-100">
                <th className="text-left px-5 py-2.5">用户</th>
                <th className="text-left px-5 py-2.5">提交时间</th>
                <th className="text-left px-5 py-2.5">字数</th>
                <th className="text-left px-5 py-2.5">情感</th>
                <th className="text-left px-5 py-2.5">分析状态</th>
                <th className="text-left px-5 py-2.5">风险</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelected(row)}
                  className={`hover:bg-slate-50 transition-colors cursor-pointer ${selected?.id === row.id ? 'bg-primary-50/40' : ''}`}
                >
                  <td className="px-5 py-3 text-sm font-medium text-slate-800">{row.username}</td>
                  <td className="px-5 py-3 text-xs text-slate-400">{row.submitAt}</td>
                  <td className="px-5 py-3 text-sm text-slate-600">{row.wordCount} 字</td>
                  <td className="px-5 py-3 text-sm text-slate-600">{row.sentiment}</td>
                  <td className="px-5 py-3"><AnalysisBadge status={row.analysisStatus} /></td>
                  <td className="px-5 py-3"><AdminAlertBadge level={row.riskLevel} size="sm" /></td>
                  <td className="px-5 py-3">
                    <Eye className="w-4 h-4 text-slate-400 hover:text-primary-600" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {filtered.length === 0 && (
            <p className="text-center py-10 text-slate-400 text-sm">暂无匹配记录</p>
          )}
        </div>

        {/* Detail panel */}
        <div className="ui-card p-5 h-fit sticky top-6">
          {selected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-800">{selected.username} 的文本日记</p>
                <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-400">{selected.submitAt} · {selected.wordCount} 字</p>
              <div className="p-3 bg-slate-50 rounded-lg text-sm text-slate-700 leading-6 border border-slate-200">
                {selected.preview}
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1.5">关键词</p>
                <div className="flex flex-wrap gap-1.5">
                  {selected.keywords.map((kw) => (
                    <span key={kw} className="px-2 py-0.5 bg-primary-50 text-primary-700 rounded-full text-xs">{kw}</span>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">情感倾向</span>
                <span className="font-medium text-slate-700">{selected.sentiment}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">风险等级</span>
                <AdminAlertBadge level={selected.riskLevel} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">分析状态</span>
                <AnalysisBadge status={selected.analysisStatus} />
              </div>
            </div>
          ) : (
            <div className="text-center py-10 text-slate-400 text-sm">
              <FileText className="w-8 h-8 mx-auto mb-2 text-slate-200" />
              点击左侧记录查看详情
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Audio Tab ─────────────────────────────────────────────────────────────────
function AudioTab({ rows }: { rows: AudioSubmission[] }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [risk, setRisk] = useState('all');
  const [selected, setSelected] = useState<AudioSubmission | null>(null);

  const filtered = rows.filter(
    (a) =>
      a.username.includes(search) &&
      (status === 'all' || a.analysisStatus === status) &&
      (risk === 'all' || a.riskLevel === risk)
  );

  return (
    <div className="space-y-4">
      <FilterBar search={search} onSearch={setSearch} status={status} onStatus={setStatus} risk={risk} onRisk={setRisk} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="ui-card lg:col-span-2 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <p className="text-sm font-semibold text-slate-700">语音条目列表</p>
            <p className="text-xs text-slate-400">共 {filtered.length} 条</p>
          </div>
          <div className="ui-table-scroll"><table className="ui-table">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-100">
                <th className="text-left px-5 py-2.5">用户</th>
                <th className="text-left px-5 py-2.5">文件名</th>
                <th className="text-left px-5 py-2.5">来源</th>
                <th className="text-left px-5 py-2.5">时长</th>
                <th className="text-left px-5 py-2.5">情感</th>
                <th className="text-left px-5 py-2.5">分析状态</th>
                <th className="text-left px-5 py-2.5">风险</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelected(row)}
                  className={`hover:bg-slate-50 transition-colors cursor-pointer ${selected?.id === row.id ? 'bg-primary-50/40' : ''}`}
                >
                  <td className="px-5 py-3 text-sm font-medium text-slate-800">{row.username}</td>
                  <td className="px-5 py-3 text-xs text-slate-500 max-w-[140px] truncate">{row.filename}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${row.source === '录制' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-600'}`}>
                      {row.source}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm text-slate-600">{row.duration}</td>
                  <td className="px-5 py-3 text-sm text-slate-600">{row.emotion}</td>
                  <td className="px-5 py-3"><AnalysisBadge status={row.analysisStatus} /></td>
                  <td className="px-5 py-3"><AdminAlertBadge level={row.riskLevel} size="sm" /></td>
                  <td className="px-5 py-3">
                    <Eye className="w-4 h-4 text-slate-400 hover:text-primary-600" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {filtered.length === 0 && (
            <p className="text-center py-10 text-slate-400 text-sm">暂无匹配记录</p>
          )}
        </div>

        {/* Detail panel */}
        <div className="ui-card p-5 h-fit sticky top-6">
          {selected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-800">{selected.username} 的语音</p>
                <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-400">{selected.submitAt}</p>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2 text-sm">
                {[
                  ['文件名', selected.filename],
                  ['来源', selected.source],
                  ['时长', selected.duration],
                  ['情感分类', selected.emotion],
                  ['语速特征', selected.speechRate],
                ].map(([label, val]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-slate-400">{label}</span>
                    <span className="text-slate-700 font-medium">{val}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">风险等级</span>
                <AdminAlertBadge level={selected.riskLevel} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">分析状态</span>
                <AnalysisBadge status={selected.analysisStatus} />
              </div>
            </div>
          ) : (
            <div className="text-center py-10 text-slate-400 text-sm">
              <Mic className="w-8 h-8 mx-auto mb-2 text-slate-200" />
              点击左侧记录查看详情
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Image Tab ─────────────────────────────────────────────────────────────────
function ImageTab({ rows }: { rows: ImageSubmission[] }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [risk, setRisk] = useState('all');
  const [selected, setSelected] = useState<ImageSubmission | null>(null);

  const filtered = rows.filter(
    (img) =>
      img.username.includes(search) &&
      (status === 'all' || img.analysisStatus === status) &&
      (risk === 'all' || img.riskLevel === risk)
  );

  return (
    <div className="space-y-4">
      <FilterBar search={search} onSearch={setSearch} status={status} onStatus={setStatus} risk={risk} onRisk={setRisk} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Card grid */}
        <div className="lg:col-span-2 space-y-3">
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-5 py-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">图像条目列表</p>
            <p className="text-xs text-slate-400">共 {filtered.length} 条</p>
          </div>
          {filtered.map((row) => (
            <div
              key={row.id}
              onClick={() => setSelected(row)}
              className={`bg-white rounded-2xl border p-5 cursor-pointer transition-colors ${
                selected?.id === row.id ? 'border-primary-400 ring-1 ring-primary-200' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                    <ImageIcon className="w-5 h-5 text-primary-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{row.username}</p>
                    <p className="text-xs text-slate-400 truncate mt-0.5">{row.filename}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">{row.type}</span>
                  <AnalysisBadge status={row.analysisStatus} />
                  <AdminAlertBadge level={row.riskLevel} size="sm" />
                </div>
              </div>
              {row.analysisStatus === 'done' || row.analysisStatus === 'flagged' ? (
                <p className="mt-2 text-xs text-slate-500 leading-5 pl-13">{row.annotation}</p>
              ) : null}
              <p className="text-xs text-slate-400 mt-1.5">{row.submitAt}</p>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="ui-card p-10 text-center text-slate-400 text-sm">
              暂无匹配记录
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="ui-card p-5 h-fit sticky top-6">
          {selected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-800">{selected.username} 的图像</p>
                <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-400">{selected.submitAt}</p>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2 text-sm">
                {[
                  ['文件名', selected.filename],
                  ['类型', selected.type],
                ].map(([label, val]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-slate-400">{label}</span>
                    <span className="text-slate-700 font-medium">{val}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">分析注解</p>
                <p className="text-sm text-slate-700 leading-6 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  {selected.annotation}
                </p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">风险等级</span>
                <AdminAlertBadge level={selected.riskLevel} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">分析状态</span>
                <AnalysisBadge status={selected.analysisStatus} />
              </div>
            </div>
          ) : (
            <div className="text-center py-10 text-slate-400 text-sm">
              <ImageIcon className="w-8 h-8 mx-auto mb-2 text-slate-200" />
              点击左侧记录查看详情
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function AdminDataCollection() {
  const [activeTab, setActiveTab] = useState<Tab>('text');
  // 采集数据统一从服务层取：mock 模式返回样例数据，真实模式打 /api/admin/data-collection。
  // 之前是直接 import adminMockData —— 那样件数永远是写死的，不会随真实数据变化。
  const [data, setData] = useState<{
    text: TextSubmission[];
    audio: AudioSubmission[];
    image: ImageSubmission[];
  } | null>(null);

  useEffect(() => {
    let active = true;
    getAdminCollectionData()
      .then((d) => {
        if (!active) return;
        setData({
          text: d.textSubmissions ?? [],
          audio: d.audioSubmissions ?? [],
          image: d.imageSubmissions ?? [],
        });
      })
      .catch(() => {
        if (active) setData({ text: [], audio: [], image: [] });
      });
    return () => {
      active = false;
    };
  }, []);

  // 风险提示条：本次会话里关掉就不再显示（用 sessionStorage —— 关掉浏览器即清空，
  // 所以下次上线仍会提醒）；条数变化（又有新数据被标记）时也会重新出现。
  const [dismissedFlagged, setDismissedFlagged] = useState<number | null>(() => {
    try {
      const saved = sessionStorage.getItem('admin-collection-flagged-dismissed');
      return saved === null ? null : Number(saved);
    } catch {
      return null;
    }
  });
  // 空态说明（解释后端返回空列表）本次会话可关闭，关掉浏览器即重置
  const [dismissedEmptyNote, setDismissedEmptyNote] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('admin-collection-empty-dismissed') === '1';
    } catch {
      return false;
    }
  });

  const tabs: { id: Tab; label: string; icon: typeof FileText; count: number }[] = [
    { id: 'text',  label: '文本采集', icon: FileText,  count: data?.text.length ?? 0 },
    { id: 'audio', label: '语音采集', icon: Mic,       count: data?.audio.length ?? 0 },
    { id: 'image', label: '图像采集', icon: ImageIcon, count: data?.image.length ?? 0 },
  ];

  const flaggedTotal =
    (data?.text ?? []).filter((t) => t.analysisStatus === 'flagged').length +
    (data?.audio ?? []).filter((a) => a.analysisStatus === 'flagged').length +
    (data?.image ?? []).filter((i) => i.analysisStatus === 'flagged').length;

  // 0 条时整条不显示；本次已关闭且条数没变时也不显示
  const showRiskBanner = flaggedTotal > 0 && dismissedFlagged !== flaggedTotal;

  return (
    <div className="space-y-5">
      {/* Header summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: '文本日记', count: data?.text.length ?? 0, sub: '条用户提交', color: 'bg-indigo-50 text-indigo-600' },
          { label: '语音条目', count: data?.audio.length ?? 0, sub: '条音频记录', color: 'bg-violet-50 text-violet-600' },
          { label: '图像上传', count: data?.image.length ?? 0, sub: '张图像', color: 'bg-amber-50 text-amber-600' },
        ].map((item) => (
          <div key={item.label} className="ui-card p-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg ${item.color}`}>
              {item.count}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800">{item.label}</p>
              <p className="text-xs text-slate-400">{item.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {showRiskBanner && (
        <div className="flex items-center gap-2 px-4 py-3 bg-danger-50 border border-danger-200 rounded-xl text-sm text-danger-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">
            当前有 <strong>{flaggedTotal}</strong> 条多模态数据被标记为高风险，请优先核查。
          </span>
          <button
            type="button"
            aria-label="关闭本次提示"
            title="关闭本次提示（下次上线仍会提醒）"
            onClick={() => {
              setDismissedFlagged(flaggedTotal);
              try {
                sessionStorage.setItem('admin-collection-flagged-dismissed', String(flaggedTotal));
              } catch {
                /* 隐私模式下 sessionStorage 不可用，忽略即可 */
              }
            }}
            className="shrink-0 cursor-pointer rounded-lg p-1 text-danger-600 transition-colors hover:bg-danger-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 空态说明：只在开发环境显示（生产构建不出现——它解释的是后端空数据，属开发期信息），
          且本次会话可关闭（sessionStorage → 下次上线仍会提示） */}
      {import.meta.env.DEV &&
        !dismissedEmptyNote &&
        data &&
        data.text.length + data.audio.length + data.image.length === 0 && (
          <div className="ui-card flex items-center gap-2 px-4 py-3 text-sm text-slate-500">
            <span className="flex-1">
              暂无采集数据：后端采集接口当前返回空列表，待文件上传与审阅链路启用后，这里的条目与件数会自动跟随真实数据变化。
            </span>
            <button
              type="button"
              aria-label="关闭本次提示"
              title="关闭本次提示（下次上线仍会提醒）"
              onClick={() => {
                setDismissedEmptyNote(true);
                try {
                  sessionStorage.setItem('admin-collection-empty-dismissed', '1');
                } catch {
                  /* 隐私模式下 sessionStorage 不可用，忽略即可 */
                }
              }}
              className="shrink-0 cursor-pointer rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

      {/* Tabs */}
      {/* 分段控件用**控件圆角**（rounded-xl = 12px），不用卡片那套 24px。
         24px 圆角套在 44px 高的条上会变成药丸形，和里面的按钮叠在一起
         整块都像药丸；改用控件圆角之后是规规矩矩的长方形，与项目里
         .ui-button（--control-radius）一致。 */}
      {/* 右侧缩进一点：这条分段控件是 w-fit 的窄条，和上面整宽的卡片同为
          左对齐时会贴着同一个左边界，看着"杵在最左边"。缩进一档之后
          它读起来更像上面那张卡片的附属操作条，不再抢左边界。 */}
      <div className="ml-2 flex w-fit gap-1.5 rounded-lg border border-slate-200 bg-white p-1.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
                isActive ? 'bg-primary-500 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/25' : 'bg-slate-100'}`}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 注：三个页签的条目目前来自前端样例数据（adminMockData）；
          后端采集审阅接口现在只返回空列表，等上传与审阅链路启用后再切服务层。 */}

      {activeTab === 'text'  && <TextTab rows={data?.text ?? []} />}
      {activeTab === 'audio' && <AudioTab rows={data?.audio ?? []} />}
      {activeTab === 'image' && <ImageTab rows={data?.image ?? []} />}
    </div>
  );
}
