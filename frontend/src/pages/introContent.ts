/* 「作品简介」与四个章节的导航项与屏幕定义。
   登录是独立的第 1 屏（不在导航里），其后是作品简介与四个章节。 */

export const navItems = [
  { id: "top", label: "作品简介" },
  { id: "tech", label: "核心技术" },
  { id: "assess", label: "状态评估" },
  { id: "alert", label: "预警处置" },
  { id: "privacy", label: "隐私安全" },
];

/* 整屏翻页：6 屏 = 登录 + 作品简介 + 四个章节（右侧页码点用） */
export const screens = [{ id: "login", label: "登录" }, ...navItems];
