import StewardPanel from '../../components/StewardPanel';
import ActionPlanCard from '../../components/ActionPlanCard';

export default function ActionsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <StewardPanel mode="actions" />
      <ActionPlanCard />
    </div>
  );
}
