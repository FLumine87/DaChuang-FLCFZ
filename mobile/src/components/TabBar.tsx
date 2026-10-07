import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ClipboardList, Sparkles, Search, AlertTriangle } from 'lucide-react';
import { tapFeedback } from '../platform/native';

export const TABS = [
  { path: '/app/dashboard', label: '首页', icon: LayoutDashboard },
  { path: '/app/screening', label: '筛查', icon: ClipboardList },
  { path: '/app/collection', label: '采集', icon: Sparkles },
  { path: '/app/retrieval', label: '检索', icon: Search },
  { path: '/app/alerts', label: '预警', icon: AlertTriangle },
];

export default function TabBar() {
  return (
    <nav className="shrink-0 bg-white/95 backdrop-blur border-t border-slate-200 pb-safe">
      <div className="flex">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <NavLink
              key={tab.path}
              to={tab.path}
              onClick={() => void tapFeedback()}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center gap-1 min-h-[56px] pt-1.5 no-select ${
                  isActive ? 'text-primary-600' : 'text-slate-400'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="w-[22px] h-[22px]" strokeWidth={isActive ? 2.4 : 1.9} />
                  <span className={`text-[10px] ${isActive ? 'font-medium' : ''}`}>
                    {tab.label}
                  </span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
