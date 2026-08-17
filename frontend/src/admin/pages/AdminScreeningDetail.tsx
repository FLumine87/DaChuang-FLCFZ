import { ArrowLeft } from 'lucide-react';
import type { ScreeningRecord } from '../data/adminMockData';
import AdminAlertBadge from '../components/AdminAlertBadge';

interface Props {
  record: ScreeningRecord;
  onBack: () => void;
}

export default function AdminScreeningDetail({ record, onBack }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer">
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div>
          <h2 className="text-xl font-bold text-slate-800">筛查详情 - {record.id}</h2>
          <p className="text-sm text-slate-400 mt-0.5">{record.date} · {record.counselor}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <div><span className="text-slate-400">姓名：</span><span className="text-slate-700">{record.name}</span></div>
          <div><span className="text-slate-400">性别：</span><span className="text-slate-700">{record.gender}</span></div>
          <div><span className="text-slate-400">年龄：</span><span className="text-slate-700">{record.age}岁</span></div>
          <div><span className="text-slate-400">问卷：</span><span className="text-slate-700">{record.questionnaire}</span></div>
          <div><span className="text-slate-400">得分：</span><span className="text-slate-700">{record.score}/{record.maxScore}</span></div>
          <div><span className="text-slate-400">咨询师：</span><span className="text-slate-700">{record.counselor}</span></div>
        </div>
        <div className="mt-4">
          <AdminAlertBadge level={record.alertLevel} />
        </div>
      </div>
    </div>
  );
}
