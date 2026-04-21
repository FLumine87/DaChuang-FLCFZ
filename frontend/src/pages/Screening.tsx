import { useState } from 'react';
import { Search, Filter, ChevronDown, PlayCircle, ClipboardCheck } from 'lucide-react';
import { screeningRecords, questionnaireCatalog } from '../data/mockData';
import type { PersonalScreeningRecord } from '../data/mockData';
import AlertBadge from '../components/AlertBadge';
import StatusBadge from '../components/StatusBadge';
import QuestionnaireForm from '../components/QuestionnaireForm';

type AlertLevel = 'green' | 'yellow' | 'orange' | 'red';

export default function Screening() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLevel, setFilterLevel] = useState<'all' | AlertLevel>('all');
  const [activeQuestionnaire, setActiveQuestionnaire] = useState<string | null>(null);
  const [localRecords, setLocalRecords] = useState<PersonalScreeningRecord[]>(screeningRecords);

  const filtered = localRecords.filter(
    (record) =>
      (record.id.includes(searchTerm) || record.questionnaire.toLowerCase().includes(searchTerm.toLowerCase())) &&
      (filterLevel === 'all' || record.level === filterLevel)
  );

  const levelToMoodTag: Record<AlertLevel, string> = {
    green: '状态稳定',
    yellow: '轻度波动',
    orange: '情绪波动',
    red: '高风险',
  };

  const handleComplete = (score: number, maxScore: number, level: AlertLevel) => {
    const today = new Date().toISOString().slice(0, 10);
    const id = `ME-SCR-${Date.now().toString().slice(-6)}`;
    const newRecord: PersonalScreeningRecord = {
      id,
      questionnaire: activeQuestionnaire!,
      score,
      maxScore,
      level,
      status: 'completed',
      moodTag: levelToMoodTag[level],
      date: today,
    };
    setLocalRecords((prev) => [newRecord, ...prev]);
  };

  if (activeQuestionnaire) {
    return (
      <div className="space-y-4">
        <QuestionnaireForm
          questionnaireId={activeQuestionnaire}
          onClose={() => setActiveQuestionnaire(null)}
          onComplete={(score, maxScore, level) => {
            handleComplete(score, maxScore, level);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-800">筛查说明</h3>
        <p className="text-sm text-slate-500 mt-2 leading-6">
          这里提供个人自助心理筛查。系统会结合你的量表结果、文本/语音/图像采集结果，进行动态跨模态哈希检索和
          RAG 风险解释，用于"早发现、早干预"。结果仅作参考，不构成诊断。
        </p>
      </div>

      {/* Questionnaire Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {questionnaireCatalog.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-slate-400">{item.id}</p>
                <h4 className="text-base font-semibold text-slate-800 mt-1">{item.name}</h4>
                <p className="text-sm text-slate-500 mt-2">{item.description}</p>
              </div>
              <ClipboardCheck className="w-5 h-5 text-primary-600 shrink-0 mt-1" />
            </div>
            <div className="flex items-center gap-4 mt-4 text-xs text-slate-500">
              <span>{item.questions} 题</span>
              <span>约 {item.minutes} 分钟</span>
              <span>关注：{item.target}</span>
            </div>
            <button
              onClick={() => setActiveQuestionnaire(item.id)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium cursor-pointer"
            >
              <PlayCircle className="w-4 h-4" /> 开始 {item.id}
            </button>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-3 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="搜索编号或量表..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent w-64"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <select
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value as 'all' | AlertLevel)}
              className="pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
            >
              <option value="all">全部等级</option>
              <option value="red">危险</option>
              <option value="orange">警告</option>
              <option value="yellow">关注</option>
              <option value="green">稳定</option>
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
        </div>
        <p className="text-sm text-slate-500">共 {filtered.length} 条记录</p>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">编号</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">问卷</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">得分</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">预警等级</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">状态</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">情绪标签</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">日期</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((record) => (
              <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-5 py-3.5 text-sm font-mono text-slate-500">{record.id}</td>
                <td className="px-5 py-3.5 text-sm text-slate-600">{record.questionnaire}</td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{record.score}</span>
                    <span className="text-xs text-slate-400">/ {record.maxScore}</span>
                    <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          record.level === 'red' ? 'bg-danger-500' :
                          record.level === 'orange' ? 'bg-orange-500' :
                          record.level === 'yellow' ? 'bg-warning-500' : 'bg-success-500'
                        }`}
                        style={{ width: `${(record.score / record.maxScore) * 100}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3.5"><AlertBadge level={record.level} size="sm" /></td>
                <td className="px-5 py-3.5"><StatusBadge status={record.status} /></td>
                <td className="px-5 py-3.5 text-sm text-slate-600">{record.moodTag}</td>
                <td className="px-5 py-3.5 text-sm text-slate-500">{record.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">暂无匹配的筛查记录</div>
        )}
      </div>
    </div>
  );
}
