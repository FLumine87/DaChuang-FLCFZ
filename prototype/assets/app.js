/* 原型最小交互：主题、侧栏折叠、抽屉、分段控件。
   不做页面转场动画（重复 200 次后会被感知为卡顿）。 */
(function () {
  var root = document.documentElement;
  var app = document.querySelector('.app'); /* 仅用于主题/折叠的初始探测；换页后由 bindPage 重新取 */

  /* ---------- 主题：首绘前应用，避免闪一下 ---------- */
  function applyMode(mode) {
    root.setAttribute('data-mode', mode);
    try {
      localStorage.setItem('proto-mode', mode);
    } catch (e) {}
    document.querySelectorAll('[data-mode-toggle]').forEach(function (btn) {
      var dark = mode === 'dark';
      btn.setAttribute('aria-pressed', String(dark));
      btn.setAttribute('aria-label', dark ? '切换为浅色模式' : '切换为深色模式');
      btn.setAttribute('title', btn.getAttribute('aria-label'));
      btn.querySelectorAll('[data-icon]').forEach(function (ic) {
        ic.hidden = ic.getAttribute('data-icon') !== (dark ? 'moon' : 'sun');
      });
    });
  }
  document.querySelectorAll('[data-mode-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      applyMode(root.getAttribute('data-mode') === 'dark' ? 'light' : 'dark');
    });
  });
  /* 与页面 <head> 内联脚本一致：#light / #dark 强制模式优先，其次是本机存储，
     最后兜底为 light。默认浅色：不再跟随系统 prefers-color-scheme——本机开着深色时
     评审/截图会被强制成深色，与“站内默认浅色”的产品决定冲突。
     想切成深色：点右上角主题按钮（会写入 localStorage 的 proto-mode），
     或在地址里加 #dark 强制。 */
  function forcedMode() {
    var m = /(^|[,#])(light|dark)([,#]|$)/.exec(location.hash || '');
    return m && m[2];
  }
  var stored = null;
  try {
    stored = localStorage.getItem('proto-mode');
  } catch (e) {}
  applyMode(forcedMode() || stored || 'light');

  /* =========================================================================
     页面级交互的绑定
     注意：这一段必须能「重复执行」。多文件版是每个 HTML 一次加载，但单文件版
     是同一个文档里反复换页 —— 换页后 .app 是新的元素，必须重新绑定。
     之前把绑定写在 IIFE 顶层，导致单文件版换页后交互全失效（文件加载时
     页面上还没有 .app，appendChild 直接抛 null），手机端表现为抽屉打不开。
     ========================================================================= */
  function bindPage() {
    var app = document.querySelector('.app'); /* 仅用于主题/折叠的初始探测；换页后由 bindPage 重新取 */
    if (!app || app.getAttribute('data-bound') === 'true') return; /* 同一元素只绑一次 */
    app.setAttribute('data-bound', 'true');

    /* ---------- 侧栏折叠（桌面） ---------- */
    var collapseBtn = app.querySelector('[data-collapse]');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', function () {
        var next = app.getAttribute('data-collapsed') !== 'true';
        app.setAttribute('data-collapsed', String(next));
        collapseBtn.setAttribute('aria-expanded', String(!next));
        collapseBtn.setAttribute('aria-label', next ? '展开侧栏' : '折叠侧栏');
        collapseBtn.setAttribute('title', collapseBtn.getAttribute('aria-label'));
        collapseBtn.querySelectorAll('[data-icon]').forEach(function (ic) {
          ic.hidden = ic.getAttribute('data-icon') !== (next ? 'panel-open' : 'panel-close');
        });
      });
    }

    /* ---------- 移动端抽屉 ----------
       之前只有「汉堡打开」一条路：没有遮罩、点外部不关、换页也不重置。
       结果手机上抽屉一开就盖住全屏，且再无关闭方式，看起来像「展不开」。
       这里补齐遮罩点击、Esc、以及切页时自动收起。 */
    var scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.hidden = true;
    scrim.setAttribute('aria-hidden', 'true');
    app.appendChild(scrim);

    function setDrawer(open) {
      app.setAttribute('data-mobile-open', String(!!open));
      scrim.hidden = !open;
      var btn = app.querySelector('[data-menu]');
      if (btn) btn.setAttribute('aria-expanded', String(!!open));
    }
    var menuBtn = app.querySelector('[data-menu]');
    if (menuBtn) {
      menuBtn.addEventListener('click', function () {
        setDrawer(app.getAttribute('data-mobile-open') !== 'true');
      });
    }
    scrim.addEventListener('click', function () { setDrawer(false); });
    /* 点任意导航项后收起 */
    app.addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('.nav-link')) setDrawer(false);
    });
    setDrawer(false); /* 换页/重新渲染时重置，避免状态残留 */

    /* 供单文件版路由在换页前调用 */
    window.PROTO_SET_DRAWER = setDrawer;
  }
  window.PROTO_BIND_PAGE = bindPage;

  /* Esc 只需在 document 上绑一次 */
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && window.PROTO_SET_DRAWER) window.PROTO_SET_DRAWER(false);
  });

  /* ---------- 分段控件：组内互斥（每次换页都要重新绑） ---------- */
  function bindChips() {
    document.querySelectorAll('[data-chipgroup]').forEach(function (group) {
      if (group.getAttribute('data-bound') === 'true') return;
      group.setAttribute('data-bound', 'true');
      group.addEventListener('click', function (ev) {
        var chip = ev.target.closest('.chip');
        if (!chip || !group.contains(chip)) return;
        group.querySelectorAll('.chip').forEach(function (c) {
          c.setAttribute('aria-pressed', String(c === chip));
        });
      });
    });
  }

  /* 统一入口：初次加载与单文件版换页后都调它 */
  window.PROTO_REBIND = function () {
    bindPage();
    bindChips();
  };

  bindPage();
  bindChips();
})();
