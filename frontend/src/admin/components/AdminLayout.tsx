import AppShell from '../../components/AppShell';

/* 管理端外壳：同个人端，只声明模式。团队 main 那版手写深色侧栏整段丢弃，
   深浅色与设计令牌统一交给 AppShell + index.css 管理。 */
export default function AdminLayout() {
  return <AppShell mode="admin" />;
}
