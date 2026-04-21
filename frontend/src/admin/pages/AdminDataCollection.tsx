import { useState } from 'react';
import {
  FileText, Mic, ImageIcon, Search, ChevronDown,
  AlertTriangle, CheckCircle2, Clock, Loader2, Eye, X,
} from 'lucide-react';
import {
  textSubmissions, audioSubmissions, imageSubmissions,
  type TextSubmission, type AudioSubmission, type ImageSubmission, type AnalysisStatus,
} from '../data/adminMockData';
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
function TextTab() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [risk, setRisk] = useState('all');
  const [selected, setSelected] = useState<TextSubmission | null>(null);

  const filtered = textSubmissions.filter(
    (t) =>
      t.username.includes(search) &&
      (status === 'all' || t.analysisStatus === status) &&
      (risk === 'all' || t.riskLevel === risk)
  );

  return (
    <div className="space-y-4">
      <FilterBar search={search} onSearch={setSearch} status={status} onStatus={setStatus} risk={risk} onRisk={setRisk} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <p className="text-sm font-semibold text-slate-700">文本日记列表</p>
            <p className="text-xs text-slate-400">共 {filtered.length} 条</p>
          </div>
          <table className="w-full">
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
          </table>
          {filtered.length === 0 && (
            <p className="text-center py-10 text-slate-400 text-sm">暂无匹配记录</p>
          )}
        </div>

        {/* Detail panel */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-fit sticky top-6">
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
function AudioTab() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [risk, setRisk] = useState('all');
  const [selected, setSelected] = useState<AudioSubmission | null>(null);

  const filtered = audioSubmissions.filter(
    (a) =>
      a.username.includes(search) &&
      (status === 'all' || a.analysisStatus === status) &&
      (risk === 'all' || a.riskLevel === risk)
  );

  return (
    <div className="space-y-4">
      <FilterBar search={search} onSearch={setSearch} status={status} onStatus={setStatus} risk={risk} onRisk={setRisk} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <p className="text-sm font-semibold text-slate-700">语音条目列表</p>
            <p className="text-xs text-slate-400">共 {filtered.length} 条</p>
          </div>
          <table className="w-full">
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
          </table>
          {filtered.length === 0 && (
            <p className="text-center py-10 text-slate-400 text-sm">暂无匹配记录</p>
          )}
        </div>

        {/* Detail panel */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-fit sticky top-6">
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
function ImageTab() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [risk, setRisk] = useState('all');
  const [selected, setSelected] = useState<ImageSubmission | null>(null);

  const filtered = imageSubmissions.filter(
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
              className={`bg-white rounded-xl border p-4 shadow-sm cursor-pointer transition-colors ${
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
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 text-sm">
              暂无匹配记录
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-fit sticky top-6">
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

  const tabs: { id: Tab; label: string; icon: typeof FileText; count: number }[] = [
    { id: 'text',  label: '文本采集', icon: FileText,  count: textSubmissions.length },
    { id: 'audio', label: '语音采集', icon: Mic,       count: audioSubmissions.length },
    { id: 'image', label: '图像采集', icon: ImageIcon, count: imageSubmissions.length },
  ];

  const flaggedTotal =
    textSubmissions.filter((t) => t.analysisStatus === 'flagged').length +
    audioSubmissions.filter((a) => a.analysisStatus === 'flagged').length +
    imageSubmissions.filter((i) => i.analysisStatus === 'flagged').length;

  return (
    <div className="space-y-5">
      {/* Header summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: '文本日记', count: textSubmissions.length, sub: '条用户提交', color: 'bg-indigo-50 text-indigo-600' },
          { label: '语音条目', count: audioSubmissions.length, sub: '条音频记录', color: 'bg-violet-50 text-violet-600' },
          { label: '图像上传', count: imageSubmissions.length, sub: '张图像', color: 'bg-amber-50 text-amber-600' },
        ].map((item) => (
          <div key={item.label} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center gap-4">
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

      {flaggedTotal > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 bg-danger-50 border border-danger-200 rounded-xl text-sm text-danger-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          当前有 <strong>{flaggedTotal}</strong> 条多模态数据被标记为高风险，请优先核查。
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 bg-white rounded-xl border border-slate-200 p-1.5 shadow-sm w-fit">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                isActive ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
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

      {activeTab === 'text'  && <TextTab />}
      {activeTab === 'audio' && <AudioTab />}
      {activeTab === 'image' && <ImageTab />}
    </div>
  );
}
