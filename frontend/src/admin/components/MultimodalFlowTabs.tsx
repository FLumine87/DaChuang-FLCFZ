import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Database, Search } from 'lucide-react';

/**
 * 管理端「多模态采集 ⇄ 检索与分析」的共用分段控件（评审问题 6）。
 *
 * 这两个页面在同一条链路上：采集负责入库与审阅，检索负责出库与分析，
 * 按的是同一条模态轴（文本 / 语音 / 图像）。之前它们分属两个分组、
 * 中间还隔着别的菜单项，评审据此认为功能重复或关系不明。
 * 除了在侧栏里并入同一组，这里再把“上下游”直接摆到页面上，
 * 从任一页到另一页都只要 1 次点击、0 次跨分组。
 */
const STEPS = [
  { id: 'collect', to: '/admin/data-collection', label: '多模态采集', hint: '入库 · 审阅', icon: Database },
  { id: 'search', to: '/admin/retrieval', label: '检索与分析', hint: '出库 · 分析', icon: Search },
] as const;

export default function MultimodalFlowTabs({ active }: { active: 'collect' | 'search' }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
      <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
          多模态链路
        </span>
        <span className="text-[13px]">同一批数据：先采集入库，再从库里检索分析</span>
      </p>
      <nav aria-label="多模态采集与检索切换" className="flex items-center gap-1.5">
        {STEPS.map((step, index) => {
          const isActive = active === step.id;
          const Icon = step.icon;
          return (
            <Fragment key={step.id}>
              {index > 0 && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />}
              <Link
                to={step.to}
                aria-current={isActive ? 'page' : undefined}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-500 text-white shadow-sm'
                    : 'border border-slate-200 text-slate-600 hover:border-primary-300 hover:text-primary-700'
                }`}
              >
                <Icon className="h-4 w-4" />
                {step.label}
                <span className={`hidden text-[11px] font-normal sm:inline ${isActive ? 'text-white/75' : 'text-slate-400'}`}>
                  {step.hint}
                </span>
              </Link>
            </Fragment>
          );
        })}
      </nav>
    </div>
  );
}
