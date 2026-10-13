import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Clock, Sparkles, FileText, AlertTriangle } from 'lucide-react';
import { type PersonalScreeningRecord, type WarningEvent, type PersonalTimelineEvent, type UserProfile } from '../data/mockData';
import { getCases } from '../services/mockApi';
import { getCurrentSession, getDisplayName } from '../auth/session';
import AlertBadge from '../components/AlertBadge';

export default function Cases() {
  const [screeningRecords, setScreeningRecords] = useState<PersonalScreeningRecord[]>([]);
  const [warningEvents, setWarningEvents] = useState<WarningEvent[]>([]);
  const [personalTimeline, setPersonalTimeline] = useState<PersonalTimelineEvent[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>({
    name: '—', age: 0, gender: '', campus: '', major: '', stage: '', emergencyContact: '',
  });
  const [, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await getCases();
        setScreeningRecords(data.screeningRecords ?? []);
        setWarningEvents(data.warningEvents ?? []);
        setPersonalTimeline(data.personalTimeline ?? []);
        if (data.userProfile) {
          // 个人端名称与登录时输入的用户名一致，避免演示资料中的姓名覆盖当前账号。
          const signedInUsername = getCurrentSession()?.username;
          const fallback = getDisplayName();
          const name = data.userProfile.name;
          setUserProfile({
            ...data.userProfile,
            name: signedInUsername || fallback || name || '—',
          });
        }
      } catch (e) {
        console.error('加载档案失败', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 副标题只拼有值的字段：此前会把空字段也连起来，渲染成「名字 ·  · 0 岁 ·  ·」，
  // 而 age 的 0 是「未知」不是真的 0 岁。宁可少显示，也不要显示假的。
  const profileMeta = [
    userProfile.name,
    userProfile.gender,
    userProfile.age ? `${userProfile.age} 岁` : '',
    userProfile.stage,
    userProfile.major,
  ]
    .map((v) => (v || '').toString().trim())
    .filter(Boolean)
    .join(' · ');


  return (
    <div className="space-y-6">
      <div className="ui-card p-5">
        <h2 className="text-xl font-semibold text-slate-800">我的心理档案</h2>
        <p className="text-sm text-slate-500 mt-1">{profileMeta}</p>
        <p className="text-xs text-slate-400 mt-2">
          紧急支持联系人：{userProfile.emergencyContact || '未填写'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="ui-card p-5">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-primary-600" />
            最近筛查
          </h3>
          <div className="space-y-2">
            {screeningRecords.length === 0 && (
              <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">
                还没有筛查记录。完成一次心理筛查后，最近的结果会显示在这里。
              </p>
            )}
            {screeningRecords.slice(0, 4).map((item) => (
              <div key={item.id} className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-800">{item.questionnaire}</p>
                  <AlertBadge level={item.level} size="sm" />
                </div>
                <p className="text-xs text-slate-500 mt-1">{item.score}/{item.maxScore} · {item.date}</p>
                {/* 记录详情就在筛查详情页（同一个 ScreeningDetail）：首次引导刚提交的
                    那条也在这里，点开能看到逐题作答、补充内容与本次检索快照 */}
                <Link
                  to={`/personal/screening?record=${encodeURIComponent(item.id)}`}
                  className="mt-2 inline-block text-xs font-medium text-primary-600 hover:underline"
                >
                  查看详情
                </Link>
              </div>
            ))}
          </div>
        </div>

        <div className="ui-card p-5">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-danger-500" />
            预警记录
          </h3>
          <div className="space-y-2">
            {warningEvents.length === 0 && (
              <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">
                目前没有预警记录。当情绪、压力或睡眠出现持续变化时，系统会在这里提醒你。
              </p>
            )}
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

        <div className="ui-card p-5">
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

      <div className="ui-card p-5">
        <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary-600" />
          关键时间线
        </h3>
        <div className="relative pl-6 space-y-5">
          <div className="absolute left-2.5 top-2 bottom-2 w-px bg-slate-200" />
          {personalTimeline.length === 0 && (
            <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">
              还没有时间线事件。完成筛查、记录情绪或产生预警后会自动生成。
            </p>
          )}
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

      <div className="ui-card p-5">
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
