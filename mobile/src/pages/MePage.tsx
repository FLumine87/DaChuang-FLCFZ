import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  ClipboardList,
  FolderOpen,
  LogOut,
  Settings,
  ShieldCheck,
  User,
} from 'lucide-react';
import { getCurrentSession, logout } from '@shared/auth/session';
import { getCases } from '@shared/services/mockApi';
import type { PersonalScreeningRecord, UserProfile } from '@shared/data/mockData';
import AlertBadge from '@shared/components/AlertBadge';
import { Card, ListRow, PrimaryButton } from '../components/ui';
import { getBase, getMode } from '../platform/mode';

export default function MePage() {
  const navigate = useNavigate();
  const session = getCurrentSession();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [latest, setLatest] = useState<PersonalScreeningRecord | null>(null);

  useEffect(() => {
    let alive = true;
    getCases()
      .then((res) => {
        if (!alive) return;
        setProfile(res.userProfile);
        setLatest(res.screeningRecords?.[0] ?? null);
      })
      .catch(() => {
        /* 档案加载失败不影响本页其它功能 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/auth', { replace: true });
  };

  const mode = getMode();

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
            <User className="w-7 h-7 text-emerald-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-semibold text-slate-800 truncate">
              {profile?.name ?? session?.username ?? '—'}
            </p>
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              {session?.username} · {session?.role === 'admin' ? '管理端账号' : '学生端账号'}
            </p>
          </div>
          {latest && <AlertBadge level={latest.level} size="sm" />}
        </div>
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
          <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="text-[12px] text-slate-500">
            当前模式：{mode === 'mock' ? '离线演示（内置数据）' : `连接实机 · ${getBase() || '未配置'}`}
          </span>
        </div>
      </Card>

      <Card className="divide-y divide-slate-100 overflow-hidden">
        <ListRow
          icon={<FolderOpen className="w-5 h-5 text-slate-400" />}
          title="我的档案"
          subtitle="基本信息 / 筛查记录 / 时间线"
          right={<ChevronRight className="w-4 h-4 text-slate-300" />}
          onClick={() => navigate('/app/cases')}
        />
        <ListRow
          icon={<ClipboardList className="w-5 h-5 text-slate-400" />}
          title="历史筛查"
          subtitle="查看与重新作答量表"
          right={<ChevronRight className="w-4 h-4 text-slate-300" />}
          onClick={() => navigate('/app/screening')}
        />
        <ListRow
          icon={<Settings className="w-5 h-5 text-slate-400" />}
          title="设置"
          subtitle="模式切换 / 后端地址 / 本地数据"
          right={<ChevronRight className="w-4 h-4 text-slate-300" />}
          onClick={() => navigate('/app/settings')}
        />
      </Card>

      <PrimaryButton
        onClick={() => void handleLogout()}
        className="!bg-white !text-danger-600 border border-danger-200 !active:bg-danger-50"
      >
        <span className="inline-flex items-center gap-2">
          <LogOut className="w-4 h-4" />
          退出登录
        </span>
      </PrimaryButton>

      <p className="text-[11px] text-slate-400 text-center leading-5 pb-2">
        心理守护 · 移动端 v1.0.0
        <br />
        本项目为大学生创新创业训练计划研究成果，不替代专业诊疗。
      </p>
    </div>
  );
}
