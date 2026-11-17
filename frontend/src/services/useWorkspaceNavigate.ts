import { useCallback, useLayoutEffect, useRef } from 'react';
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom';
import { usePageActive } from './pageActivity';

/** 后台保存成功时不抢走当前页面；用户回到原工作页后再打开下一步。 */
export function useWorkspaceNavigate() {
  const navigate = useNavigate();
  const pageActive = usePageActive();
  const active = useRef(pageActive);
  const pending = useRef<{ to: To; options?: NavigateOptions } | null>(null);
  useLayoutEffect(() => {
    active.current = pageActive;
    if (pageActive && pending.current) {
      const next = pending.current;
      pending.current = null;
      void navigate(next.to, next.options);
    }
    return () => { active.current = false; };
  }, [pageActive, navigate]);
  return useCallback((to: To, options?: NavigateOptions) => {
    if (active.current) void navigate(to, options);
    else pending.current = { to, options };
  }, [navigate]);
}
