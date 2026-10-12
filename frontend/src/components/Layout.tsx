import { useState, useEffect } from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  Database,
  Search,
  AlertTriangle,
  FolderOpen,
  Menu,
  X,
  Brain,
  User,
  LogOut,
} from 'lucide-react';
import { getCurrentSession, logout } from '../auth/session';
import { getWarnings } from '../services/mockApi';
import NotificationBell, { type NotifyItem } from './NotificationBell';

const navItems = [
  { path: '/personal/dashboard', label: '个人首页', icon: LayoutDashboard },
  { path: '/personal/screening', label: '心理筛查', icon: ClipboardList },
  { path: '/personal/data-collection', label: '多模态采集', icon: Database },
  { path: '/personal/retrieval', label: '动态哈希检索 + RAG', icon: Search },
  { path: '/personal/alerts', label: '预警中心', icon: AlertTriangle },
  { path: '/personal/cases', label: '我的档案', icon: FolderOpen },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const session = getCurrentSession();
  const username = session?.username || '个人用户';
  const [notifs, setNotifs] = useState<NotifyItem[]>([]);
  const [notifLoading, setNotifLoading] = useState(true);

  // 预警通知：进入页面时拉取一次，未处理数作为红点
  useEffect(() => {
    let alive = true;
    getWarnings()
      .then((list) => {
        if (!alive) return;
        const active = list.filter((w) => w.status !== 'resolved');
        setNotifs(
          active.slice(0, 8).map((w) => ({
            id: w.id,
            title: w.title,
            description: w.reason,
            time: w.createdAt,
            level: w.level === 'red' ? 'danger' : w.level === 'orange' || w.level === 'yellow' ? 'warning' : 'info',
            onClick: () => navigate('/personal/alerts'),
          }))
        );
      })
      .catch(() => setNotifs([]))
      .finally(() => alive && setNotifLoading(false));
    return () => {
      alive = false;
    };
  }, [navigate]);

  const handleLogout = () => {
    logout();
    navigate('/auth', { replace: true });
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-emerald-50 via-cyan-50 to-teal-100">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-20'
        } relative z-20 shrink-0 bg-white/90 border-r border-emerald-200 flex flex-col
                    transition-all duration-300 shadow-sm backdrop-blur`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-emerald-200">
          <Brain className="w-8 h-8 text-emerald-600 shrink-0" />
          {sidebarOpen && (
            <span className="ml-3 font-bold text-lg text-slate-800 whitespace-nowrap">
              个人心理守护
            </span>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="ml-auto text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive =
              location.pathname === item.path ||
              location.pathname.startsWith(item.path + '/');
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center px-3 py-2.5 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-700 font-medium'
                    : 'text-slate-600 hover:bg-emerald-50/60 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-emerald-600' : ''}`} />
                {sidebarOpen && <span className="ml-3 whitespace-nowrap">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        {sidebarOpen && (
          <div className="p-4 border-t border-emerald-200">
            <div className="flex items-center">
              <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                <User className="w-4 h-4 text-emerald-700" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-slate-700">{username}</p>
                <p className="text-xs text-slate-400">个人用户</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 py-2 text-xs font-medium bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              退出登录
            </button>
          </div>
        )}
      </aside>

      {/* Main content：外层不能用 overflow-hidden（会裁掉通知铃铛下拉面板），
          min-h-0 让 main 的 overflow-auto 生效 */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top bar */}
        <header className="relative z-20 h-16 shrink-0 bg-white/90 border-b border-emerald-200 flex items-center justify-between px-6 shadow-sm backdrop-blur">
          <h1 className="text-lg font-semibold text-slate-800">
            {navItems.find(
              (item) =>
                location.pathname === item.path ||
                location.pathname.startsWith(item.path + '/')
            )?.label || '仪表盘'}
          </h1>
          <div className="flex items-center gap-4">
            <NotificationBell
              items={notifs}
              unread={notifs.length}
              loading={notifLoading}
              emptyText="暂无预警通知"
            />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
