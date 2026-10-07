import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { initNative, registerBackHandler } from './native';

/** Tab 根页面：在这些页面上按返回键 = 退出 App */
const TAB_ROOTS = [
  '/app/dashboard',
  '/app/screening',
  '/app/collection',
  '/app/retrieval',
  '/app/alerts',
];

/**
 * Android 物理返回键 / 手势返回 的映射：
 *   子页面 → 返回上一层；Tab 根页面 → 交还系统（退出 App）
 */
export function useBackHandler() {
  const navigate = useNavigate();
  const location = useLocation();

  // 状态栏只需初始化一次
  useEffect(() => {
    void initNative();
  }, []);

  // 返回键监听随路径重建，且**必须注销旧的**（否则监听器累积）
  useEffect(() => {
    let alive = true;
    let dispose: (() => void) | undefined;

    void registerBackHandler(() => {
      if (!alive) return false;
      if (TAB_ROOTS.includes(location.pathname)) return false; // 根页面 → 退出 App
      navigate(-1);
      return true;
    }).then((fn) => {
      if (alive) dispose = fn;
      else fn(); // 已卸载则立刻注销
    });

    return () => {
      alive = false;
      dispose?.();
    };
  }, [location.pathname, navigate]);
}
