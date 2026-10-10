/* 原型最小交互：主题、侧栏折叠、抽屉、分段控件。
   不做页面转场动画（重复 200 次后会被感知为卡顿）。 */
(function () {
  var root = document.documentElement;
  var app = document.querySelector('.app');

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
  /* 与页面 <head> 内联脚本一致：#light / #dark 强制模式优先，其次本机存储，
     最后跟随系统。否则这里会把内联脚本已经设好的模式覆盖掉（截图与评审时尤其明显）。 */
  function forcedMode() {
    var m = /(^|[,#])(light|dark)([,#]|$)/.exec(location.hash || '');
    return m && m[2];
  }
  var stored = null;
  try {
    stored = localStorage.getItem('proto-mode');
  } catch (e) {}
  applyMode(forcedMode() || stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  /* ---------- 侧栏折叠（桌面）/ 抽屉（移动） ---------- */
  var collapseBtn = document.querySelector('[data-collapse]');
  if (collapseBtn && app) {
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
  var menuBtn = document.querySelector('[data-menu]');
  if (menuBtn && app) {
    menuBtn.addEventListener('click', function () {
      var next = app.getAttribute('data-mobile-open') !== 'true';
      app.setAttribute('data-mobile-open', String(next));
      menuBtn.setAttribute('aria-expanded', String(next));
    });
  }

  /* ---------- 分段控件：组内互斥 ---------- */
  document.querySelectorAll('[data-chipgroup]').forEach(function (group) {
    group.addEventListener('click', function (ev) {
      var chip = ev.target.closest('.chip');
      if (!chip || !group.contains(chip)) return;
      group.querySelectorAll('.chip').forEach(function (c) {
        c.setAttribute('aria-pressed', String(c === chip));
      });
    });
  });
})();
