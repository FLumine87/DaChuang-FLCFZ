import { Suspense, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { UNSAFE_LocationContext as LocationContext, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { PageActivityContext, usePageActive } from '../services/pageActivity';

/** 访问后保留组件及异步任务；隐藏页仍使用自己的路由参数。 */
export function RetainedView({ active, children }: { active: boolean; children: ReactNode }) {
  const parentActive = usePageActive();
  const visible = active && parentActive;
  const context = useContext(LocationContext);
  const [visited, setVisited] = useState(active);
  const [savedContext, setSavedContext] = useState(context);
  if (active && !visited) setVisited(true);
  if (visible && savedContext !== context) setSavedContext(context);
  if (!visited && !active) return null;
  return (
    <div className="workspace-view" hidden={!visible} style={visible ? undefined : { display: 'none' }}
      data-workspace-active={visible} data-workspace-route={context.location.pathname}>
      <PageActivityContext.Provider value={visible}>
        <LocationContext.Provider value={visible ? context : savedContext}>
          <Suspense fallback={<p className="p-4 text-sm text-slate-500">正在加载…</p>}>
            {children}
          </Suspense>
        </LocationContext.Provider>
      </PageActivityContext.Provider>
    </div>
  );
}

export default function RetainedWorkspace({ groupShells = false }: { groupShells?: boolean }) {
  const outlet = useOutlet();
  const location = useLocation();
  const context = useContext(LocationContext);
  const navigate = useNavigate();
  // 最外层按外壳分组，使首次引导与工作台之间切换也不销毁工作台。
  const path = groupShells && location.pathname.startsWith('/admin/') ? '/admin'
    : groupShells && location.pathname.startsWith('/personal/')
      && !location.pathname.startsWith('/personal/first/') && location.pathname !== '/personal/welcome'
      ? '/personal' : location.pathname;
  type Entry = { path: string; outlet: ReactNode; context: typeof context };
  const [cache, setCache] = useState(() => ({
    location, path, restoreSearch: '',
    entries: [{ path, outlet, context }] as Entry[],
  }));
  if (cache.location !== location || cache.path !== path) {
    const previous = cache.entries.find((entry) => entry.path === path);
    // 从侧栏返回不带参数的地址时，恢复离开前的标签页/量表；显式参数仍优先。
    const restoreSearch = cache.path !== path && !location.search
      && previous?.context.location.pathname === location.pathname
      ? previous?.context.location.search ?? '' : '';
    const entry = { path, outlet,
      context: restoreSearch ? { ...context, location: { ...location, search: restoreSearch } } : context };
    setCache({ location, path, restoreSearch,
      entries: [...cache.entries.filter((item) => item.path !== entry.path), entry] });
  }
  useLayoutEffect(() => {
    if (cache.restoreSearch) {
      navigate({ pathname: location.pathname, search: cache.restoreSearch, hash: location.hash },
        { replace: true, state: location.state });
    }
  }, [cache.restoreSearch, location.pathname, location.hash, location.state, navigate]);

  return <>
    {cache.entries.map((entry) => (
      <LocationContext.Provider key={entry.path} value={entry.context}>
        <RetainedView active={entry.path === path}>
          {entry.outlet}
        </RetainedView>
      </LocationContext.Provider>
    ))}
  </>;
}
