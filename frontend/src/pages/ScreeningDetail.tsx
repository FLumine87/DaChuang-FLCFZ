import { ArrowLeft, FileText, Download } from 'lucide-react';
import type { ScreeningRecord } from '../data/mockData';
import AlertBadge from '../components/AlertBadge';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from 'recharts';

interface Props {
  record: ScreeningRecord;
  onBack: () => void;
}

const dimensionData = [
  { dimension: '躯体化', score: 2.1 },
  { dimension: '强迫', score: 1.8 },
  { dimension: '人际敏感', score: 2.5 },
  { dimension: '抑郁', score: 3.2 },
  { dimension: '焦虑', score: 2.8 },
  { dimension: '敌对', score: 1.2 },
  { dimension: '恐怖', score: 1.5 },
  { dimension: '偏执', score: 1.9 },
  { dimension: '精神病性', score: 1.3 },
];

export default function ScreeningDetail({ record, onBack }: Props) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div>
          <h2 className="text-xl font-bold text-slate-800">筛查详情 - {record.id}</h2>
          <p className="text-sm text-slate-400 mt-0.5">{record.date} · 个人用户视图</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button className="inline-flex items-center gap-2 px-3 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 text-sm cursor-pointer">
            <Download className="w-4 h-4" /> 导出
          </button>
          <button className="inline-flex items-center gap-2 px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm cursor-pointer">
            <FileText className="w-4 h-4" /> 生成报告
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Basic Info */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-4">基本信息</h3>
          <div className="space-y-3">
            {[
              ['问卷类型', record.questionnaire],
              ['情绪标签', record.moodTag],
              ['状态', record.status],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <span className="text-sm text-slate-400">{label}</span>
                <span className="text-sm font-medium text-slate-700">{value}</span>
              </div>
            ))}
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-400">预警等级</span>
              <AlertBadge level={record.level} size="sm" />
            </div>
          </div>
        </div>

        {/* Score Overview */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-4">得分概览</h3>
          <div className="flex flex-col items-center">
            <div className="relative w-32 h-32">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128">
                <circle cx="64" cy="64" r="56" fill="none" stroke="#f1f5f9" strokeWidth="12" />
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  fill="none"
                  stroke={
                    record.level === 'red' ? '#ef4444' :
                    record.level === 'orange' ? '#f97316' :
                    record.level === 'yellow' ? '#f59e0b' : '#22c55e'
                  }
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={`${(record.score / record.maxScore) * 352} 352`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-slate-800">{record.score}</span>
                <span className="text-xs text-slate-400">/ {record.maxScore}</span>
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-500 text-center">
              得分率 {((record.score / record.maxScore) * 100).toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Dimension Radar */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-4">维度分析</h3>
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={dimensionData}>
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10 }} />
              <PolarRadiusAxis tick={{ fontSize: 10 }} domain={[0, 4]} />
              <Radar dataKey="score" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Answer Details */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-4">作答详情（示例）</h3>
        <div className="space-y-3">
          {[
            { q: '1. 做事时提不起劲或没有兴趣', a: 3, desc: '几乎每天' },
            { q: '2. 感到心情低落、沮丧或绝望', a: 2, desc: '一半以上的天数' },
            { q: '3. 入睡困难、睡不安稳或睡眠过多', a: 3, desc: '几乎每天' },
            { q: '4. 感觉疲倦或没有精力', a: 2, desc: '一半以上的天数' },
            { q: '5. 食欲不振或吃太多', a: 1, desc: '好几天' },
            { q: '6. 觉得自己很糟或很失败', a: 2, desc: '一半以上的天数' },
            { q: '7. 注意力难以集中', a: 2, desc: '一半以上的天数' },
            { q: '8. 动作或说话速度变化', a: 1, desc: '好几天' },
            { q: '9. 有不如死掉或伤害自己的念头', a: 2, desc: '一半以上的天数' },
          ].map((item, i) => (
            <div key={i} className={`flex items-center justify-between p-3 rounded-lg ${item.a >= 2 ? 'bg-danger-50' : 'bg-slate-50'}`}>
              <span className="text-sm text-slate-700">{item.q}</span>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-medium ${item.a >= 2 ? 'text-danger-600' : 'text-slate-600'}`}>
                  {item.a}分
                </span>
                <span className="text-xs text-slate-400">{item.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
