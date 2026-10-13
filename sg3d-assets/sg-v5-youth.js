/* ═══ SG-V5 · 青年版「拾光花园」：玉兰花 hero + 能量收集游戏 ═══
   依赖站点既有真实状态：localStorage['sg-youth-energy']、
   SG3DMagnolia.addEnergy()、SG().openCourse()。全部真实数据，无写死数字。 */
(function () {
  'use strict';
  var BUILT = false;

  function energy() { try { return parseInt(localStorage.getItem('sg-youth-energy') || '0', 10) || 0; } catch (e) { return 0; } }

  /* ── 玉兰花 hero 注入 ── */
  function buildHero() {
    if (BUILT) return;
    var inner = document.querySelector('#ypanel-garden .yp-inner');
    if (!inner) return;
    BUILT = true;
    var hero = document.createElement('div');
    hero.className = 'mag-hero'; hero.id = 'mag-hero';
    /* 三层视差花瓣 */
    var depths = [{ c: 'px-back', d: 0.05, n: 6 }, { c: 'px-mid', d: 0.12, n: 5 }, { c: 'px-front', d: 0.22, n: 4 }];
    depths.forEach(function (L) {
      var lay = document.createElement('div');
      lay.className = 'mag-px ' + L.c; lay.dataset.depth = L.d;
      for (var i = 0; i < L.n; i++) {
        var p = document.createElement('i');
        var s = 10 + Math.random() * 22;
        p.style.width = s + 'px'; p.style.height = (s * 0.72) + 'px';
        p.style.left = (4 + Math.random() * 90) + '%'; p.style.top = (4 + Math.random() * 88) + '%';
        p.style.animationDelay = (-Math.random() * 7).toFixed(2) + 's';
        lay.appendChild(p);
      }
      hero.appendChild(lay);
    });
    /* 标题组（顶部） */
    var head = document.createElement('div'); head.className = 'mag-head';
    head.innerHTML = '<div class="mag-kicker">SPRING · 拾光花园</div>' +
      '<h2 class="mag-title">玉兰花下，慢慢长大</h2>' +
      '<p class="mag-sub">点一点花朵周围发光的能量球，能量会飞进左上角的小球里；<br>攒够能量，玉兰会一朵一朵开给你看。</p>';
    hero.appendChild(head);
    /* 3D 玉兰主体 = 站点既有 GLB 拆分零件模型场景（.yg-stage 整体迁入 hero 作为场景层） */
    var stage = inner.querySelector('.yg-stage');
    if (stage) hero.insertBefore(stage, hero.firstChild);

    inner.insertBefore(hero, inner.firstChild);
    bindParallax(hero);
    seedHeroOrbs(hero);
    paintBloomStage();
  }

  /* ── 三层视差：鼠标 + 陀螺仪 ── */
  function bindParallax(hero) {
    var layers = hero.querySelectorAll('.mag-px');
    var wrap = hero.querySelector('.mag-flower-w');
    function move(nx, ny) {
      layers.forEach(function (l) {
        var d = parseFloat(l.dataset.depth);
        l.style.transform = 'translate3d(' + (nx * d * 60) + 'px,' + (ny * d * 40) + 'px,0)';
      });
      if (wrap) wrap.style.translate = (nx * 10) + 'px ' + (ny * 7) + 'px';
    }
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      move(((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2);
    });
    hero.addEventListener('pointerleave', function () { move(0, 0); });
    addEventListener('deviceorientation', function (e) {
      if (e.gamma == null) return;
      move(Math.max(-1, Math.min(1, e.gamma / 30)), Math.max(-1, Math.min(1, (e.beta - 45) / 30)));
    }, { passive: true });
  }

  /* ── hero 内能量球：围绕花朵漂浮，可点击收集 ── */
  var ORB_SPOTS = [[16, 30], [84, 26], [12, 58], [88, 56], [50, 84], [26, 82]];
  function seedHeroOrbs(hero) {
    ORB_SPOTS.forEach(function (sp, i) {
      var o = document.createElement('span');
      o.className = 'yg-orb2d mag-orb';
      o.style.left = sp[0] + '%'; o.style.top = sp[1] + '%';
      o.style.setProperty('--dx', (i % 2 ? -9 : 9) + 'px');
      o.style.setProperty('--dy', ((i % 3) - 1) * 10 + 'px');
      o.style.setProperty('--f', (4.6 + i * 0.5) + 's');
      o.style.animationDelay = (-Math.random() * 5).toFixed(2) + 's';
      o.title = '能量球 · 点我收集';
      hero.appendChild(o);
    });
  }

  /* ── 能量阈值 → 开花阶段（视觉成长与收集进度绑定） ── */
  function paintBloomStage() {
    var hero = document.getElementById('mag-hero'); if (!hero) return;
    var n = energy();
    hero.classList.toggle('stg1', n >= 50);
    hero.classList.toggle('stg2', n >= 150);
    hero.classList.toggle('stg3', n >= 300);
  }

  /* ── 能量收集：光点 → 贝塞尔飞向计数器 → 数字滚动 +N ── */
  function flyToHud(fromX, fromY, gain) {
    var hud = document.getElementById('ym-energy');
    var oldN = energy();
    if (!hud) { commit(gain, oldN); return; }
    var hr = hud.getBoundingClientRect();
    var tx = hr.left + hr.width / 2, ty = hr.top + hr.height / 2;
    var dot = document.createElement('span'); dot.className = 'v5-fly';
    dot.style.left = (fromX - 9) + 'px'; dot.style.top = (fromY - 9) + 'px';
    document.body.appendChild(dot);
    var midX = (fromX + tx) / 2, midY = Math.min(fromY, ty) - 90; /* 弧线顶点 */
    var anim = dot.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: 'translate(' + (midX - fromX) + 'px,' + (midY - fromY) + 'px) scale(.85)', opacity: 1, offset: 0.55 },
      { transform: 'translate(' + (tx - fromX) + 'px,' + (ty - fromY) + 'px) scale(.4)', opacity: .9 }
    ], { duration: 620, easing: 'cubic-bezier(.22,1,.36,1)' });
    anim.onfinish = function () {
      dot.remove(); commit(gain, oldN);
      var tag = document.createElement('span'); tag.className = 'v5-fly-num'; tag.textContent = '+' + gain + 'g';
      tag.style.left = (tx - 12) + 'px'; tag.style.top = (ty - 26) + 'px';
      document.body.appendChild(tag);
      tag.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-30px)', opacity: 0 }],
        { duration: 900, easing: 'ease-out' }).onfinish = function () { tag.remove(); };
    };
  }
  function commit(gain, oldN) {
    try { if (window.SG3DMagnolia && SG3DMagnolia.addEnergy) SG3DMagnolia.addEnergy(gain, true); } catch (e) {}
    rollNumber(oldN, oldN + gain);
    paintBloomStage();
  }
  /* 数字滚动动画（真实值来自 localStorage，动画仅为呈现） */
  function rollNumber(from, to) {
    var el = document.getElementById('ym-energy-num'); if (!el) return;
    var t0 = performance.now(), dur = 480;
    (function step(t) {
      var k = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
      else el.textContent = energy(); /* 以存储为最终真值 */
    })(t0);
  }
  function bindOrbs() {
    document.addEventListener('click', function (ev) {
      var o = ev.target && ev.target.closest ? ev.target.closest('.yg-orb2d') : null;
      if (!o || o.dataset.v5busy) return;
      o.dataset.v5busy = '1';
      setTimeout(function () { delete o.dataset.v5busy; }, 600);
      var gain = 2 + Math.floor(Math.random() * 4); /* 每球 2~5g */
      flyToHud(ev.clientX, ev.clientY, gain);
      /* hero 内的球：压缩回弹 → 隐藏 → 14~22s 原地重生 */
      if (o.classList.contains('mag-orb')) {
        o.style.transition = 'transform .18s cubic-bezier(.34,1.56,.64,1)';
        o.style.transform = 'scale(.4)';
        setTimeout(function () { o.style.visibility = 'hidden'; o.style.transform = ''; }, 240);
        setTimeout(function () { o.style.visibility = ''; }, 14000 + Math.random() * 8000);
      }
    }, true);
  }

  function boot() {
    var tries = 0;
    (function wait() {
      var ready = document.querySelector('#ypanel-garden .yp-inner');
      if (ready) { buildHero(); bindOrbs(); return; }
      if (++tries < 40) setTimeout(wait, 250);
    })();
    /* 进入青少年视图时补建（视图后渲染场景） */
    addEventListener('viewchange', function (e) {
      if ((e && e.detail) === 'youth') { buildHero(); paintBloomStage(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
