import { useEffect, useState } from 'react';
import { Search, Filter, Eye, ChevronDown, RefreshCw } from 'lucide-react';
import { type ScreeningRecord } from '../data/adminMockData';
import { getAdminScreeningRecords } from '../../services/mockApi';
import { listAdminSupplements, type AdminSupplement } from '../../services/adminApi';
import AdminAlertBadge from '../components/AdminAlertBadge';
import AdminStatusBadge from '../components/AdminStatusBadge';
import AdminScreeningDetail from './AdminScreeningDetail';

type Category = 'all' | 'scale' | 'multimodal';
type RiskLevel = 'green' | 'yellow' | 'orange' | 'red';

const MODALITY_LABEL: Record<string, string> = { text: '文本', audio: '语音', image: '图像' };

/** 统一列表的一行：量表筛查与多模态采集共用同一张表。 */
interface UnifiedRow {
  key: string;
  kind: 'scale' | 'multimodal';
  id: string;
  name: string;
  typeLabel: string;
  content: string;
  result: string;
  level: RiskLevel | '';
  status: string;
  date: string;
  record?: ScreeningRecord;
  supplement?: AdminSupplement;
}

/** 采集接口固定 50 条一页；这里翻完所有页，保证统一列表不会漏记录。 */
async function loadAllSupplements(): Promise<AdminSupplement[]> {
  const items: AdminSupplement[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const data = await listAdminSupplements({ page });
    items.push(...data.items);
    if (data.items.length === 0 || items.length >= data.total) break;
  }
  return items;
}

function supplementLevel(item: AdminSupplement): RiskLevel | '' {
  const level = item.analysis?.level;
  return typeof level === 'string' && ['green', 'yellow', 'orange', 'red'].includes(level)
    ? level as RiskLevel
    : '';
}

function supplementResult(item: AdminSupplement): string {
  const analysis = item.analysis;
  if (!analysis) return '未分析';
  return analysis.levelLabel || analysis.conclusion || '已分析';
}

export default function AdminScreening() {
  const [category, setCategory] = useState<Category>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSupplement, setSelectedSupplement] = useState<AdminSupplement | null>(null);
  const [screeningRecords, setScreeningRecords] = useState<ScreeningRecord[]>([]);
  const [supplements, setSupplements] = useState<AdminSupplement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const [records, items] = await Promise.all([
          getAdminScreeningRecords(),
          loadAllSupplements(),
        ]);
        if (alive) {
          setScreeningRecords(records);
          setSupplements(items);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '筛查记录加载失败，请稍后重试');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  const rows: UnifiedRow[] = [
    ...screeningRecords.map((record) => ({
      key: `scale-${record.id}`,
      kind: 'scale' as const,
      id: record.id,
      name: record.name,
      typeLabel: '量表',
      content: record.questionnaire,
      result: `${record.score}/${record.maxScore}`,
      level: record.alertLevel,
      status: record.status,
      date: record.date,
      record,
    })),
    ...supplements.map((item) => ({
      key: `supplement-${item.id}`,
      kind: 'multimodal' as const,
      id: `SUP-${item.id}`,
      name: item.name,
      typeLabel: MODALITY_LABEL[item.kind] || item.kind,
      content: item.filename || item.text || item.description || '未填写说明',
      result: supplementResult(item),
      level: supplementLevel(item),
      status: item.analysis ? 'completed' : '待分析',
      date: item.createdAt,
      supplement: item,
    })),
  ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const filtered = rows.filter((row) => {
    const matchesCategory = category === 'all'
      || (category === 'scale' ? row.kind === 'scale' : row.kind === 'multimodal');
    const term = searchTerm.trim();
    const matchesSearch = !term
      || row.name.includes(term)
      || row.id.includes(term)
      || row.content.includes(term);
    const matchesLevel = filterLevel === 'all' || row.level === filterLevel;
    return matchesCategory && matchesSearch && matchesLevel;
  });

  if (selectedId) {
    const record = screeningRecords.find((r) => r.id === selectedId);
    if (record) {
      return <AdminScreeningDetail record={record} onBack={() => setSelectedId(null)} />;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="搜索姓名、编号、问卷或采集内容..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setSelectedSupplement(null); }}
            className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent w-72"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value as Category); setSelectedSupplement(null); }}
            aria-label="数据类型"
            className="pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
          >
            <option value="all">全部类型</option>
            <option value="scale">仅量表</option>
            <option value="multimodal">仅多模态</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <select
            value={filterLevel}
            onChange={(e) => { setFilterLevel(e.target.value); setSelectedSupplement(null); }}
            aria-label="预警等级"
            className="pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
          >
            <option value="all">全部等级</option>
            <option value="red">危险</option>
            <option value="orange">警告</option>
            <option value="yellow">关注</option>
            <option value="green">正常</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
      </div>

      <div className="ui-card overflow-hidden">
        <div className="ui-table-scroll"><table className="ui-table">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">编号</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">姓名</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">类型</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">内容</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">得分 / 分析</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">预警等级</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">状态</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">日期</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={9} className="px-5 py-12 text-center text-sm text-slate-400">
                  正在加载筛查与采集记录…
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={9} className="px-5 py-12 text-center text-sm">
                  <p className="font-medium text-rose-700">筛查记录加载失败</p>
                  <p className="mt-1 text-slate-500">{error}</p>
                  <p className="mt-1 text-xs text-slate-400">这不等于没有记录，可能是网络或后端暂时不可用。</p>
                  <button
                    type="button"
                    onClick={() => setReload((value) => value + 1)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    重试
                  </button>
                </td>
              </tr>
            )}
            {!loading && !error && filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-12 text-center text-sm text-slate-400">
                  当前筛选条件下没有记录。试试切换类型、清空搜索词，或把等级筛选改成全部。
                </td>
              </tr>
            )}
            {!loading && !error && filtered.map((row) => (
              <tr key={row.key} className="hover:bg-slate-50 transition-colors">
                <td className="px-5 py-3.5 text-sm font-mono text-slate-500">{row.id}</td>
                <td className="px-5 py-3.5 text-sm text-slate-700">{row.name}</td>
                <td className="px-5 py-3.5">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    row.kind === 'scale'
                      ? 'bg-primary-50 text-primary-600'
                      : 'bg-warning-50 text-warning-600'
                  }`}>
                    {row.typeLabel}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-sm text-slate-600 max-w-64 truncate">{row.content}</td>
                <td className="px-5 py-3.5 text-sm text-slate-700 max-w-56 truncate">{row.result}</td>
                <td className="px-5 py-3.5">
                  {row.level
                    ? <AdminAlertBadge level={row.level} size="sm" />
                    : <span className="text-xs text-slate-400">未分析</span>}
                </td>
                <td className="px-5 py-3.5"><AdminStatusBadge status={row.status} /></td>
                <td className="px-5 py-3.5 text-sm text-slate-500">{row.date}</td>
                <td className="px-5 py-3.5">
                  <button
                    onClick={() => {
                      if (row.kind === 'scale' && row.record) setSelectedId(row.record.id);
                      else if (row.supplement) setSelectedSupplement(row.supplement);
                    }}
                    aria-label={`查看 ${row.name} 的记录详情`}
                    className="text-primary-600 hover:text-primary-700 cursor-pointer"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      {!loading && !error && (
        <p className="text-xs text-slate-400">
          共 {filtered.length} 条（量表 {filtered.filter((row) => row.kind === 'scale').length} · 多模态 {filtered.filter((row) => row.kind === 'multimodal').length}）
        </p>
      )}

      {selectedSupplement && (
        <article className="ui-card space-y-3 p-5" aria-label="采集详情">
          <div className="flex justify-between">
            <h3 className="font-semibold">采集详情 · {MODALITY_LABEL[selectedSupplement.kind] || selectedSupplement.kind}</h3>
            <button className="ui-button" onClick={() => setSelectedSupplement(null)}>关闭详情</button>
          </div>
          <p>{selectedSupplement.name} · {selectedSupplement.createdAt}</p>
          {selectedSupplement.screeningId && (
            <p className="text-xs text-slate-400">关联筛查：{selectedSupplement.screeningId}</p>
          )}
          <p className="whitespace-pre-wrap">
            {selectedSupplement.text || selectedSupplement.description || selectedSupplement.filename || '无补充说明'}
          </p>
          <h4 className="font-medium">已保存的分析结果</h4>
          {selectedSupplement.analysis ? (
            <div className="space-y-2 text-sm text-slate-600">
              <p>分析等级：{selectedSupplement.analysis.levelLabel || '未提供'}</p>
              <p>{selectedSupplement.analysis.conclusion || '未保存分析结论'}</p>
              <p>{selectedSupplement.analysis.reason}</p>
              {selectedSupplement.analysis.alertId && (
                <a
                  className="text-primary-600 underline"
                  href={`#/admin/alerts?alert=${encodeURIComponent(selectedSupplement.analysis.alertId)}`}
                >
                  查看关联预警 →
                </a>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500">暂无分析结果，不能据此判断风险。</p>
          )}
        </article>
      )}
    </div>
  );
}
