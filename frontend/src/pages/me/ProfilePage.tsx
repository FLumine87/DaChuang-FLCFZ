import StewardPanel from '../../components/StewardPanel';
import PsychologicalOverview from '../../components/PsychologicalOverview';
import DailyQuote from '../../components/DailyQuote';
import KgPage from './KgPage';

export default function ProfilePage() {
  return <div className="space-y-5">
    <div><p className="text-xs font-medium tracking-widest text-primary-600">属于您的心理健康空间</p><h1 className="mt-2 text-2xl font-semibold text-slate-900">让我陪您，看见更完整的自己</h1><p className="mt-2 text-sm text-slate-500">我的心理档案 · 您的特点、近期状态与适合您的下一步，都在这里。</p></div>
    <PsychologicalOverview />
    {/* items-stretch：右栏星图固定 620px，左栏据此拉平。
        左栏 = 建议面板（管家在线时有内容）+ 今日一句（离线时把高度撑住，避免大片留白）。 */}
    <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <StewardPanel mode="profile" />
        <div className="min-h-0 flex-1"><DailyQuote /></div>
      </div>
      <div className="flex h-[620px] min-w-0 flex-col"><KgPage stewardGraph /></div>
    </div>
  </div>;
}
