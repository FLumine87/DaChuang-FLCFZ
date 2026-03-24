import { useState, useEffect } from 'react';
import { Search, Filter, ChevronDown, Calendar, ClipboardList, ArrowLeft, Clock } from 'lucide-react';
import { getCaseList } from '../services/api';
import { screeningRecords, alertRecords } from '../data/mockData';
import AlertBadge from '../components/AlertBadge';
import StatusBadge from '../components/StatusBadge';

export default function Cases() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedCase, setSelectedCase] = useState<number | null>(null);
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCases() {
      try {
        setLoading(true);
        const data = await getCaseList();
        setCases(data);
      } catch (error) {
        console.error('Failed to fetch cases:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchCases();
  }, []);

  const filtered = cases.filter((c) => {
    const matchSearch = c.name.includes(searchTerm) || c.case_id.includes(searchTerm);
    const matchStatus = filterStatus === 'all' || c.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const selected = cases.find((c) => c.id === selectedCase);

  if (selected) {
    const caseScreenings = screeningRecords.filter((s) => s.name === selected.name);
    const caseAlerts = alertRecords.filter((a) => a.name === selected.name);

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => setSelectedCase(null)}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-slate-800">案例详情 - {selected.name}</h2>
            <p className="text-sm text-slate-400 mt-0.5">{selected.id} · {selected.department}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Profile Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-xl font-bold">
                {selected.name[0]}
              </div>
              <div>
                <h3 className="font-semibold text-slate-800">{selected.name}</h3>
                <p className="text-sm text-slate-400">{selected.gender} · {selected.age}岁</p>
              </div>
            </div>
            <div className="space-y-3 text-sm">
              {[
                ['院系', selected.department],
                ['筛查次数', `${selected.screeningCount} 次`],
                ['最近筛查', selected.lastScreening],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-slate-400">{label}</span>
                  <span className="text-slate-700 font-medium">{value}</span>
                </div>
              ))}
              <div className="flex justify-between items-center">
                <span className="text-slate-400">预警等级</span>
                <AlertBadge level={selected.alertLevel} size="sm" />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">状态</span>
                <StatusBadge status={selected.status} />
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-sm text-slate-400 mb-2">标签</p>
              <div className="flex flex-wrap gap-2">
                {selected.tags.map((tag) => (
                  <span key={tag} className="px-2.5 py-1 bg-primary-50 text-primary-600 rounded-full text-xs font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Timeline & Records */}
          <div className="lg:col-span-2 space-y-6">
            {/* Timeline */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary-600" />
                案例时间线
              </h3>
              <div className="relative pl-6 space-y-6">
                <div className="absolute left-2.5 top-2 bottom-2 w-px bg-slate-200" />
                {[
                  { date: '2026-03-12', type: 'alert', text: '触发红色预警 - PHQ-9 得分18' },
                  { date: '2026-03-12', type: 'screening', text: '完成 PHQ-9 筛查' },
                  { date: '2026-02-20', type: 'screening', text: '完成 GAD-7 筛查，得分8' },
                  { date: '2026-02-01', type: 'screening', text: '首次 PHQ-9 筛查，得分12' },
                  { date: '2026-01-15', type: 'case', text: '建立心理档案' },
                ].map((event, i) => (
                  <div key={i} className="relative flex gap-3">
                    <div className={`absolute -left-[18px] w-3 h-3 rounded-full border-2 border-white ${
                      event.type === 'alert' ? 'bg-danger-500' :
                      event.type === 'screening' ? 'bg-primary-500' : 'bg-slate-400'
                    }`} />
                    <div>
                      <p className="text-xs text-slate-400">{event.date}</p>
                      <p className="text-sm text-slate-700">{event.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Screening History */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-primary-600" />
                筛查记录
              </h3>
              {caseScreenings.length > 0 ? (
                <div className="space-y-2">
                  {caseScreenings.map((s) => (
                    <div key={s.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono text-slate-500">{s.id}</span>
                        <span className="text-sm text-slate-700">{s.questionnaire}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-slate-800">{s.score}/{s.maxScore}</span>
                        <AlertBadge level={s.alertLevel} size="sm" />
                        <span className="text-xs text-slate-400">{s.date}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 text-center py-4">暂无筛查记录</p>
              )}
            </div>

            {/* Alert History */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary-600" />
                预警记录
              </h3>
              {caseAlerts.length > 0 ? (
                <div className="space-y-2">
                  {caseAlerts.map((a) => (
                    <div key={a.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <AlertBadge level={a.level} size="sm" />
                        <span className="text-sm text-slate-700">{a.trigger}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={a.status} />
                        <span className="text-xs text-slate-400">{a.createdAt}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 text-center py-4">暂无预警记录</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-3 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="搜索姓名或编号..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent w-64"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
            >
              <option value="all">全部状态</option>
              <option value="active">活跃</option>
              <option value="monitoring">监控中</option>
              <option value="closed">已关闭</option>
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Case Cards Grid */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm bg-white rounded-xl border border-slate-200">
          加载中...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm bg-white rounded-xl border border-slate-200">
          暂无匹配的案例
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <div
              key={c.id}
              onClick={() => setSelectedCase(c.id)}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition-all cursor-pointer"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold">
                    {c.name[0]}
                  </div>
                  <div>
                    <p className="font-medium text-slate-800">{c.name}</p>
                    <p className="text-xs text-slate-400">{c.gender} · {c.age}岁 · {c.department}</p>
                  </div>
                </div>
                <AlertBadge level={c.alert_level} size="sm" />
              </div>
              <div className="flex items-center justify-between text-sm mb-3">
                <span className="text-slate-400">筛查 {c.screening_count} 次</span>
                <StatusBadge status={c.status} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {c.tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-xs">
                    {tag}
                  </span>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-3">最近筛查: {c.last_screening}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
