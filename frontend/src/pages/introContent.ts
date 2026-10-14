/* 主页的导航项与屏幕定义（平台简介 + 四个章节）。
   登录已剥离为独立页面 /login，不再占用滑动序列的一屏。 */

export const navItems = [
  { id: "top", label: "平台简介" },
  { id: "tech", label: "核心技术" },
  { id: "assess", label: "状态评估" },
  { id: "alert", label: "预警处置" },
  { id: "privacy", label: "隐私安全" },
];

/* 整屏翻页：5 屏（平台简介 + 四个章节），右侧页码点用 */
export const screens = [...navItems];
