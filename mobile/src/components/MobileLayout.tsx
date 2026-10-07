import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, User } from 'lucide-react';
import { useEffect } from 'react';
import TabBar, { TABS } from './TabBar';
import { useBackHandler } from '../platform/useBackHandler';

const TITLES: Record<string, string> = {
  '/app/dashboard': '个人首页',
  '/app/screening': '心理筛查',
  '/app/collection': '多模态采集',
  '/app/retrieval': '哈希检索 + RAG',
  '/app/alerts': '预警中心',
  '/app/cases': '我的档案',
  '/app/me': '我的',
  '/app/settings': '设置',
};

export default function MobileLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  useBackHandler();

  // 切换 tab 时回到顶部，避免"新页面停在上一页滚动位置"的错位感
  useEffect(() => {
    document.getElementById('app-scroll')?.scrollTo({ top: 0 });
  }, [location.pathname]);

  const isTabRoot = TABS.some((t) => t.path === location.pathname);
  const title = TITLES[location.pathname] ?? '心理守护';

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* 顶栏 */}
      <header className="shrink-0 bg-emerald-600 text-white pt-safe no-select">
        <div className="h-[52px] px-3 flex items-center gap-1">
          {!isTabRoot && (
            <button
              onClick={() => navigate(-1)}
              className="w-10 h-10 -ml-1 flex items-center justify-center active:opacity-60"
              aria-label="返回"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}
          <h1 className={`text-[17px] font-semibold ${isTabRoot ? 'pl-2' : ''}`}>{title}</h1>
          <button
            onClick={() => navigate('/app/me')}
            className="ml-auto w-10 h-10 flex items-center justify-center active:opacity-60"
            aria-label="我的"
          >
            <span className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <User className="w-[18px] h-[18px]" />
            </span>
          </button>
        </div>
      </header>

      {/* 内容 */}
      <main
        id="app-scroll"
        className="flex-1 overflow-y-auto overscroll-contain hide-scrollbar"
      >
        <div className="px-4 py-4">
          <Outlet />
        </div>
      </main>

      <TabBar />
    </div>
  );
}
