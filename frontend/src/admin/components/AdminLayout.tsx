import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
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
  Bell,
  User,
  LogOut,
} from 'lucide-react';
import { getCurrentSession, logout } from '../../auth/session';

const navItems = [
  { path: '/admin/dashboard', label: '仪表盘', icon: LayoutDashboard },
  { path: '/admin/screening', label: '筛查管理', icon: ClipboardList },
  { path: '/admin/data-collection', label: '数据采集', icon: Database },
  { path: '/admin/retrieval', label: '检索与分析', icon: Search },
  { path: '/admin/alerts', label: '预警管理', icon: AlertTriangle },
  { path: '/admin/cases', label: '案例管理', icon: FolderOpen },
];

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const session = getCurrentSession();
  const username = session?.username || 'adminer';

  const handleLogout = () => {
    logout();
    navigate('/auth', { replace: true });
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-20'
        } bg-slate-900/95 border-r border-slate-700 flex flex-col transition-all duration-300 shadow-2xl backdrop-blur`}
      >
        <div className="h-16 flex items-center px-4 border-b border-slate-700">
          <Brain className="w-8 h-8 text-cyan-300 shrink-0" />
          {sidebarOpen && (
            <span className="ml-3 font-bold text-lg text-white whitespace-nowrap">心理筛查预警</span>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="ml-auto text-slate-400 hover:text-white cursor-pointer"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

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
                    ? 'bg-cyan-500/20 text-cyan-200 font-medium'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-cyan-300' : ''}`} />
                {sidebarOpen && <span className="ml-3 whitespace-nowrap">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {sidebarOpen && (
          <div className="p-4 border-t border-slate-700">
            <div className="flex items-center">
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                <User className="w-4 h-4 text-cyan-200" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-white">{username}</p>
                <p className="text-xs text-slate-400">管理账号</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 py-2 text-xs font-medium bg-slate-800 text-cyan-200 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              退出登录
            </button>
          </div>
        )}
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-slate-900/80 border-b border-slate-700 flex items-center justify-between px-6 shadow-sm backdrop-blur">
          <h1 className="text-lg font-semibold text-white">
            {navItems.find(
              (item) =>
                location.pathname === item.path ||
                location.pathname.startsWith(item.path + '/')
            )?.label || '仪表盘'}
          </h1>
          <div className="flex items-center gap-4">
            <button className="relative text-cyan-300 hover:text-cyan-100 cursor-pointer">
              <Bell className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-danger-500 text-white text-xs rounded-full flex items-center justify-center">
                3
              </span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6 bg-slate-100">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
