/* ═══ SG-V5 · 老年版「暖阳咖啡」：大字开关 + 底部大按钮栏 ═══ */
(function () {
  'use strict';
  function ready(fn) { if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn); }

  ready(function () {
    /* ── 大字模式开关（加入 v4 工具条，默认关闭，持久化） ── */
    function addBigBtn() {
      var tools = document.getElementById('sg-elder-tools');
      if (!tools || document.getElementById('sgV4Big')) return;
      var b = document.createElement('button');
      b.type = 'button'; b.id = 'sgV4Big'; b.textContent = '🔠 大字模式';
      tools.appendChild(b);
      function sync() { b.classList.toggle('on', document.body.classList.contains('elder-big')); }
      try { if (localStorage.getItem('sg-elder-big') === '1') document.body.classList.add('elder-big'); } catch (e) {}
      b.addEventListener('click', function () {
        document.body.classList.toggle('elder-big');
        try { localStorage.setItem('sg-elder-big', document.body.classList.contains('elder-big') ? '1' : '0'); } catch (e) {}
        sync();
      });
      sync();
    }
    addBigBtn();
    /* v4 工具条由 defer/内联脚本创建，兜底轮询 */
    var t = 0; (function waitTools() { if (!document.getElementById('sg-elder-tools') && ++t < 40) setTimeout(waitTools, 250); else addBigBtn(); })();

    /* ── 底部固定大按钮栏：首页 / 课堂 / 暖阳乐园 ── */
    if (!document.getElementById('v5-elder-tabbar')) {
      var bar = document.createElement('nav');
      bar.id = 'v5-elder-tabbar'; bar.setAttribute('aria-label', '快捷导航');
      bar.innerHTML =
        '<button type="button" data-goto="home">🏠 首页</button>' +
        '<button type="button" data-goto="learn">📖 课堂</button>' +
        '<button type="button" id="v5-tab-park">🌳 暖阳乐园</button>';
      document.body.appendChild(bar);
      bar.querySelector('#v5-tab-park').addEventListener('click', function () {
        var entry = document.getElementById('sg-park-entry') || document.getElementById('elderEntry');
        if (entry) entry.click();
      });
      /* 当前页高亮 */
      addEventListener('viewchange', function (e) {
        var name = (e && e.detail) || 'home';
        bar.querySelectorAll('button[data-goto]').forEach(function (b) {
          b.classList.toggle('on', b.dataset.goto === name);
        });
      });
    }
  });
})();
