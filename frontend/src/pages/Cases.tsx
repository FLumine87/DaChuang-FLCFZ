import { ClipboardList, Clock, Sparkles, FileText, AlertTriangle } from 'lucide-react';
import { personalTimeline, screeningRecords, warningEvents, userProfile } from '../data/mockData';
import AlertBadge from '../components/AlertBadge';

export default function Cases() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-800">我的心理档案</h2>
        <p className="text-sm text-slate-500 mt-1">
          {userProfile.name} · {userProfile.gender} · {userProfile.age} 岁 · {userProfile.stage} · {userProfile.major}
        </p>
        <p className="text-xs text-slate-400 mt-2">紧急支持联系人：{userProfile.emergencyContact}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-primary-600" />
            最近筛查
          </h3>
          <div className="space-y-2">
            {screeningRecords.slice(0, 4).map((item) => (
              <div key={item.id} className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-800">{item.questionnaire}</p>
                  <AlertBadge level={item.level} size="sm" />
                </div>
                <p className="text-xs text-slate-500 mt-1">{item.score}/{item.maxScore} · {item.date}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-danger-500" />
            预警记录
          </h3>
          <div className="space-y-2">
            {warningEvents.map((item) => (
              <div key={item.id} className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-800">{item.title}</p>
                  <AlertBadge level={item.level} size="sm" />
                </div>
                <p className="text-xs text-slate-500 mt-1">{item.createdAt}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary-600" />
            档案摘要
          </h3>
          <div className="space-y-3 text-sm text-slate-600 leading-6">
            <p>你的风险主要由“学习压力上升 + 睡眠下降 + 情绪耗竭”共同驱动。</p>
            <p>模型建议优先执行短周期干预：稳定睡眠、降低压力峰值、增强支持连接。</p>
            <p>建议每 3-4 天完成一次简版筛查并更新多模态样本。</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary-600" />
          关键时间线
        </h3>
        <div className="relative pl-6 space-y-5">
          <div className="absolute left-2.5 top-2 bottom-2 w-px bg-slate-200" />
          {personalTimeline.map((event) => (
            <div key={`${event.date}-${event.title}`} className="relative">
              <span className="absolute -left-[18px] w-3 h-3 rounded-full bg-primary-500 border-2 border-white" />
              <p className="text-xs text-slate-400">{event.date}</p>
              <p className="text-sm text-slate-800 mt-1">{event.title}</p>
              <p className="text-sm text-slate-500 mt-1">{event.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary-600" />
          使用建议
        </h3>
        <ul className="text-sm text-slate-600 space-y-2 list-disc pl-5">
          <li>保持每周至少 2 次多模态采集，提升检索与 RAG 建议准确度。</li>
          <li>出现红色预警时，不要独自承受，优先联系可信赖同伴或学校心理支持资源。</li>
          <li>连续 7 天执行行动计划后，再查看趋势变化并做下一轮调整。</li>
        </ul>
      </div>
    </div>
  );
}
