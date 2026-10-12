/* =============================================================================
   shell.js · 共享外壳（侧栏 + 顶栏 + 图标）
   目的：每个页面只写自己的内容，导航只维护一份 —— 避免程序臃肿。
   用法（页面里只要两行空容器）：
     <div class="app" data-shell='{"surface":"personal","active":"home","crumb":"个人首页"}'>
       <aside class="sidebar" data-shell-sidebar></aside>
       <div class="main">
         <header class="topbar" data-shell-topbar></header>
         <main class="content">…本页内容…</main>
       </div>
     </div>
   ============================================================================= */
window.PROTO = (function () {
  'use strict';

  /* ---------- 图标：统一 1.7 描边，线性、无 emoji ---------- */
  var ICONS = {
    home: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    screening: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>',
    collect: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
    retrieval: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    alerts: '<path d="M10.3 4.3 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    profile: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    dashboard: '<path d="M4 19V9M10 19V5M16 19v-6M22 19H2"/>',
    cases: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M8 3v3M16 3v3M8 11h8M8 15h5"/>',
    agent: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M7.5 7.5 9.5 9.5M14.5 14.5l2 2M16.5 7.5l-2 2M9.5 14.5l-2 2"/><circle cx="12" cy="12" r="2.6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20.9 12.5A8.5 8.5 0 1 1 11.5 3.1a6.6 6.6 0 0 0 9.4 9.4Z"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    panelClose: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M16 10l-2 2 2 2"/>',
    panelOpen: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M14 10l2 2-2 2"/>',
    play: '<path d="M6 4l12 8-12 8V4Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M12 3v12M7 11l5 5 5-5M5 21h14"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4-2v-4Z"/>',
    check: '<path d="m5 13 4 4L19 7"/>',
    arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
    fileText: '<path d="M7 3h7l5 5v13H7Z"/><path d="M14 3v5h5M10 13h6M10 17h4"/>',
    activity: '<path d="M3 12h4l2.5-7 3 14 3-7h5"/>',
    sparkles: '<path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6Z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>',
    shield: '<path d="M12 3l7 3v6c0 5-3 7.5-7 9-4-1.5-7-4-7-9V6Z"/><path d="m9 12 2 2 4-4"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M21 4v4h-4M3 20v-4h4"/>'
  };

  function icon(name, size) {
    var body = ICONS[name] || '';
    return '<svg viewBox="0 0 24 24" width="' + (size || 16) + '" height="' + (size || 16) +
      '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      body + '</svg>';
  }

  /* ---------- 导航：一处维护 ----------
     个人端按评审意见合并入口：「心理筛查」与「多模态采集」原本是两个入口，
     其中原「心理筛查」实际只是量表作答，而量表不是项目重点。现在合并为一个
     「心理筛查」（对应 personal-collect.html，三模态采集为主），问卷降级为
     该页里的辅助功能。 */
  var NAV = {
    personal: [
      { label: '工作空间', items: [
        { id: 'home', text: '个人首页', href: 'personal-home.html', icon: 'home' },
        { id: 'collect', text: '心理筛查', href: 'personal-collect.html', icon: 'screening' }
      ] },
      { label: '智能分析', items: [
        { id: 'retrieval', text: '检索与分析', href: 'personal-retrieval.html', icon: 'retrieval' }
      ] },
      { label: '健康管理', items: [
        { id: 'alerts', text: '预警中心', href: 'personal-alerts.html', icon: 'alerts', count: 2 },
        { id: 'profile', text: '我的档案', href: 'personal-profile.html', icon: 'profile' }
      ] }
    ],
    admin: [
      { label: '总览', items: [
        { id: 'dashboard', text: '数据概览', href: 'admin-dashboard.html', icon: 'dashboard' },
        { id: 'screenings', text: '筛查管理', href: 'admin-screenings.html', icon: 'screening' },
        { id: 'collect', text: '采集审阅', href: 'admin-collect.html', icon: 'collect' }
      ] },
      { label: '研判', items: [
        { id: 'retrieval', text: '检索与分析', href: 'admin-retrieval.html', icon: 'retrieval' },
        { id: 'alerts', text: '预警管理', href: 'admin-alerts.html', icon: 'alerts', count: 9 },
        { id: 'cases', text: '案例管理', href: 'admin-cases.html', icon: 'cases' },
        { id: 'agent', text: '预警研判台', href: 'admin-agent.html', icon: 'agent' }
      ] }
    ]
  };

  /* 沿用真实演示账号：顶栏取 JWT 里的 username，角色为「个人用户 / 管理员」，
     头像首字母与现有前端一致（username.slice(0,1).toUpperCase()）。 */
  var USERS = {
    personal: { name: 'xiaoyu', role: '个人用户', initial: 'X' },
    admin: { name: 'admin', role: '管理员', initial: 'A' }
  };

  /* ---------- 渲染 ---------- */
  function sidebarHTML(cfg) {
    var groups = (NAV[cfg.surface] || []).map(function (g) {
      var items = g.items.map(function (it) {
        var active = it.id === cfg.active;
        return '<a class="nav-link" href="' + it.href + '"' + (active ? ' aria-current="page"' : '') + '>' +
          icon(it.icon) + '<span class="nav-link__text">' + it.text + '</span>' +
          (it.count ? '<span class="nav-link__count">' + it.count + '</span>' : '') + '</a>';
      }).join('');
      return '<div class="nav__group"><div class="nav__label">' + g.label + '</div>' + items + '</div>';
    }).join('');

    return '' +
      '<div class="brand">' +
        '<span class="brand__mark" aria-hidden="true">' + icon('activity', 16) + '</span>' +
        '<span class="brand__text">' +
          '<span class="brand__name">心理筛查预警</span>' +
          '<span class="brand__sub">' + (cfg.surface === 'admin' ? '咨询师工作空间' : '个人健康空间') + ' · 原型</span>' +
        '</span>' +
      '</div>' +
      '<nav class="nav" aria-label="' + (cfg.surface === 'admin' ? '管理端' : '个人端') + '导航">' + groups + '</nav>' +
      '<div class="sidebar__foot">' +
        '<span class="sidebar__foot-text">' + (cfg.surface === 'admin' ? '数据仅用于人工复核，不作诊断' : '每一次记录，都是对自己的关心') + '</span>' +
        '<button class="iconbtn" type="button" data-collapse aria-expanded="true" aria-label="折叠侧栏" title="折叠侧栏">' +
          '<span data-icon="panel-close">' + icon('panelClose') + '</span>' +
          '<span data-icon="panel-open" hidden>' + icon('panelOpen') + '</span>' +
        '</button>' +
      '</div>';
  }

  function topbarHTML(cfg) {
    var u = USERS[cfg.surface] || USERS.personal;
    var crumb = cfg.crumb || '';
    return '' +
      '<button class="iconbtn topbar__menu" type="button" data-menu aria-label="打开导航" aria-expanded="false">' +
        icon('menu') + '</button>' +
      '<nav class="crumbs" aria-label="面包屑"><span class="crumbs__now">' + crumb + '</span></nav>' +
      '<span class="topbar__spacer"></span>' +
      (cfg.topAction || '') +
      '<button class="iconbtn" type="button" data-mode-toggle aria-label="切换为深色模式" aria-pressed="false" title="切换为深色模式">' +
        '<span data-icon="sun">' + icon('sun') + '</span>' +
        '<span data-icon="moon" hidden>' + icon('moon') + '</span>' +
      '</button>' +
      '<span class="topbar__divider" aria-hidden="true"></span>' +
      '<button class="userbtn" type="button" aria-haspopup="menu" aria-expanded="false">' +
        '<span class="avatar" aria-hidden="true">' + u.initial + '</span>' +
        '<span><span class="userbtn__name">' + u.name + '</span><br>' +
        '<span class="userbtn__role">' + u.role + '</span></span>' +
        icon('chevron', 14) +
      '</button>';
  }

  function render() {
    document.querySelectorAll('.app[data-shell]').forEach(function (app) {
      var cfg = {};
      try { cfg = JSON.parse(app.getAttribute('data-shell')); } catch (e) {}
      var sidebar = app.querySelector('[data-shell-sidebar]');
      var topbar = app.querySelector('[data-shell-topbar]');
      if (sidebar) sidebar.innerHTML = sidebarHTML(cfg);
      if (topbar) topbar.innerHTML = topbarHTML(cfg);
      app.setAttribute('data-collapsed', cfg.collapsed ? 'true' : 'false');
    });
  }

  render();
  return { icon: icon, render: render, NAV: NAV };
})();
