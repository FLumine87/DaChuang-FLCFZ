import StewardPanel from '../../components/StewardPanel';
import ActionPlanCard from '../../components/ActionPlanCard';

export default function ActionsPage() {
  return <div className="mx-auto max-w-4xl space-y-5"><h1 className="text-xl font-semibold">建议与行动</h1><p className="text-sm text-slate-500">选择适合您的小行动，加入计划并按自己的节奏完成。</p><StewardPanel mode="actions" /><ActionPlanCard /></div>;
}
