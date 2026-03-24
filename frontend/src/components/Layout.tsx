import { useState } from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';
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
} from 'lucide-react';

const navItems = [
  { path: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
  { path: '/screening', label: '筛查管理', icon: ClipboardList },
  { path: '/data-collection', label: '数据采集', icon: Database },
  { path: '/retrieval', label: '检索与分析', icon: Search },
  { path: '/alerts', label: '预警管理', icon: AlertTriangle },
  { path: '/cases', label: '案例管理', icon: FolderOpen },
];

export default function Layout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-20'
        } bg-white border-r border-slate-200 flex flex-col transition-all duration-300 shadow-sm`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-slate-200">
          <Brain className="w-8 h-8 text-primary-600 shrink-0" />
          {sidebarOpen && (
            <span className="ml-3 font-bold text-lg text-slate-800 whitespace-nowrap">
              心理筛查预警
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
                    ? 'bg-primary-50 text-primary-700 font-medium'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-primary-600' : ''}`} />
                {sidebarOpen && <span className="ml-3 whitespace-nowrap">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        {sidebarOpen && (
          <div className="p-4 border-t border-slate-200">
            <div className="flex items-center">
              <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                <User className="w-4 h-4 text-primary-600" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-slate-700">李老师</p>
                <p className="text-xs text-slate-400">心理咨询师</p>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-800">
            {navItems.find(
              (item) =>
                location.pathname === item.path ||
                location.pathname.startsWith(item.path + '/')
            )?.label || '仪表盘'}
          </h1>
          <div className="flex items-center gap-4">
            <button className="relative text-slate-400 hover:text-slate-600 cursor-pointer">
              <Bell className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-danger-500 text-white text-xs rounded-full flex items-center justify-center">
                3
              </span>
            </button>
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
