import StewardPanel from '../../components/StewardPanel';
import PsychologicalOverview from '../../components/PsychologicalOverview';
import KgPage from './KgPage';

export default function ProfilePage() {
  return <div className="space-y-5">
    <div><p className="text-xs font-medium tracking-widest text-primary-600">属于你的心理健康空间</p><h1 className="mt-2 text-2xl font-semibold text-slate-900">让我陪你，看见更完整的自己</h1><p className="mt-2 text-sm text-slate-500">我的心理档案 · 你的特点、近期状态与适合你的下一步，都在这里。</p></div>
    <PsychologicalOverview />
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="min-w-0"><StewardPanel mode="profile" /></div>
      <div className="flex h-[620px] min-w-0 flex-col"><KgPage stewardGraph /></div>
    </div>
  </div>;
}
