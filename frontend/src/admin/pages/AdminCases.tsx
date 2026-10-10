import { useState, useEffect } from 'react';
import { type CaseRecord } from '../data/adminMockData';
import { getAdminCases } from '../../services/mockApi';
import AdminAlertBadge from '../components/AdminAlertBadge';
import AdminStatusBadge from '../components/AdminStatusBadge';

export default function AdminCases() {
  const [keyword, setKeyword] = useState('');
  const [caseRecords, setCaseRecords] = useState<CaseRecord[]>([]);
  const [, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await getAdminCases();
        setCaseRecords(data);
      } catch (e) {
        console.error('加载案例失败', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = caseRecords.filter((item) => item.name.includes(keyword) || item.id.includes(keyword));

  return (
    <div className="space-y-4">
      <input
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="搜索姓名或编号..."
        className="w-full sm:w-72 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {filtered.length === 0 && (
          <div className="ui-card md:col-span-2 xl:col-span-3 text-center py-12 text-sm text-slate-400">
            没有匹配的案例。试试清空搜索词；如果还没有任何案例，可先从筛查记录建立档案。
          </div>
        )}
        {filtered.map((item) => (
          <div key={item.id} className="ui-card p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="font-medium text-slate-800">{item.name}</p>
              <AdminAlertBadge level={item.alertLevel} size="sm" />
            </div>
            <p className="text-xs text-slate-400">{item.id} · {item.department}</p>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-sm text-slate-600">筛查 {item.screeningCount} 次</p>
              <AdminStatusBadge status={item.status} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
