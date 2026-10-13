/* ═══ SG-V6 核心：移动端汉堡菜单 / 模式切换全屏过渡 / 老年齿轮收纳 ═══ */
(function () {
  'use strict';
  function ready(fn) { if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn); }

  ready(function () {
    /* ─── 1. 移动端汉堡菜单 ─── */
    var nav = document.querySelector('.nav');
    if (nav && !document.getElementById('v6-burger')) {
      var burger = document.createElement('button');
      burger.className = 'v6-burger'; burger.id = 'v6-burger'; burger.type = 'button';
      burger.setAttribute('aria-label', '打开菜单'); burger.setAttribute('aria-expanded', 'false');
      burger.innerHTML = '<i></i><i></i><i></i>';
      var drop = document.createElement('div');
      drop.className = 'v6-navdrop'; drop.id = 'v6-navdrop';
      document.querySelectorAll('.nav .nav-links a').forEach(function (a) {
        var c = a.cloneNode(true); drop.appendChild(c);
      });
      document.body.appendChild(drop);
      nav.insertBefore(burger, nav.querySelector('.nav-right'));
      burger.addEventListener('click', function () {
        var open = drop.style.display === 'flex';
        drop.style.display = open ? 'none' : 'flex';
        burger.setAttribute('aria-expanded', String(!open));
      });
      drop.addEventListener('click', function (e) {
        if (e.target.closest('a')) { drop.style.display = 'none'; burger.setAttribute('aria-expanded', 'false'); }
      });
    }

    /* ─── 2. 模式切换全屏过渡：汇聚成涡旋 → 爆发重组 ─── */
    var tc = document.createElement('canvas');
    tc.id = 'v6-trans'; document.body.appendChild(tc);
    var tctx = tc.getContext('2d');
    var THEMES = {
      youth: { cols: ['#3EB96E', '#FF8FB3', '#FFD66B', '#7EC8F2'], bg: 'rgba(242,251,244,.94)' },
      normal: { cols: ['#C9A96A', '#E8CE96', '#8FA3CC', '#F4EFE3'], bg: 'rgba(10,14,26,.94)' },
      elder: { cols: ['#A67C52', '#E8B878', '#C46A1B', '#FFF3DC'], bg: 'rgba(250,247,242,.94)' }
    };
    function playTransition(theme) {
      var T = THEMES[theme] || THEMES.normal;
      var w = tc.width = innerWidth, h = tc.height = innerHeight;
      var N = 260, ps = [];
      for (var i = 0; i < N; i++) {
        ps.push({ x: Math.random() * w, y: Math.random() * h,
          c: T.cols[i % 4], r: 2 + Math.random() * 4, a: Math.random() * 6.28 });
      }
      var cx = w / 2, cy = h / 2, t0 = performance.now(), DUR = 1050;
      tc.classList.add('play');
      (function frame(now) {
        var k = Math.min(1, (now - t0) / DUR);
        tctx.clearRect(0, 0, w, h);
        tctx.fillStyle = T.bg;
        var cover = k < 0.5 ? k * 2 : 1; /* 0-0.5 淡入底色 */
        tctx.globalAlpha = cover; tctx.fillRect(0, 0, w, h);
        tctx.globalAlpha = 1;
        for (var i = 0; i < N; i++) {
          var p = ps[i];
          if (k < 0.5) { /* 汇聚成涡旋 */
            var kk = k / 0.5;
            var dx = cx - p.x, dy = cy - p.y;
            var swirl = kk * 2.2;
            p.x += dx * 0.075 + (-dy) * 0.012 * swirl;
            p.y += dy * 0.075 + (dx) * 0.012 * swirl;
          } else { /* 爆发散开重组 */
            var kk2 = (k - 0.5) / 0.5;
            p.a += 0.02;
            p.x += Math.cos(p.a) * kk2 * 26;
            p.y += Math.sin(p.a) * kk2 * 26;
          }
          var fade = k < 0.5 ? 1 : 1 - (k - 0.5) * 1.6;
          tctx.globalAlpha = Math.max(0, fade) * 0.9;
          tctx.fillStyle = p.c;
          tctx.beginPath(); tctx.arc(p.x, p.y, p.r, 0, 6.2832); tctx.fill();
        }
        if (k < 1) requestAnimationFrame(frame);
        else { tctx.clearRect(0, 0, w, h); tc.classList.remove('play'); }
      })(t0);
    }
    /* 捕获模式门点击，立即起过渡（现有入场流程在其下照常进行） */
    document.addEventListener('click', function (e) {
      var door = e.target && e.target.closest ? e.target.closest('.sp-world') : null;
      if (door) playTransition(door.dataset.mode || 'normal');
    }, true);

    /* ─── 3. 老年版：齿轮收纳设置 ─── */
    var t = 0;
    (function waitTools() {
      var tools = document.getElementById('sg-elder-tools');
      if (!tools && ++t < 40) return setTimeout(waitTools, 250);
      if (!tools) return;
      if (document.getElementById('v6-elder-gear')) return;
      var gear = document.createElement('button');
      gear.id = 'v6-elder-gear'; gear.type = 'button'; gear.textContent = '⚙';
      gear.setAttribute('aria-label', '显示设置开关');
      document.body.appendChild(gear);
      tools.classList.add('v6-folded');
      gear.addEventListener('click', function () {
        var folded = tools.classList.toggle('v6-folded');
        gear.classList.toggle('open', !folded);
      });
    })();
  });
})();
