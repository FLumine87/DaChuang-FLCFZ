import { useState } from 'react';
import { caseRecords } from '../data/adminMockData';
import AdminAlertBadge from '../components/AdminAlertBadge';
import AdminStatusBadge from '../components/AdminStatusBadge';

export default function AdminCases() {
  const [keyword, setKeyword] = useState('');
  const filtered = caseRecords.filter((item) => item.name.includes(keyword) || item.id.includes(keyword));

  return (
    <div className="space-y-4">
      <input
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="搜索姓名或编号..."
        className="w-72 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((item) => (
          <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
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
