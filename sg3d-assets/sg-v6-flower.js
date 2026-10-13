/* ═══ SG-V6 · 青年版：课程气泡流 + 生长进度（3D 玉兰本体 = 既有 GLB 零件模型，
   由 sg3d-magnolia2 按 doneCourses 驱动 8 级生长，本模块只做气泡与标识） ═══ */
(function () {
  'use strict';
  function doneMap() {
    try { return (window.SG && SG.doneRef) ? (typeof SG.doneRef === 'function' ? SG.doneRef() : SG.doneRef) : {}; } catch (e) { return {}; }
  }
  function bubbles() {
    var hero = document.getElementById('mag-hero');
    if (!hero || hero.__bubbles) return; hero.__bubbles = true;
    var teen = [];
    try { teen = (window.SG && SG.Courses && SG.Courses.teen) || []; } catch (e) {}
    var spots = [[7, 30], [74, 24], [4, 56], [76, 52], [12, 78], [70, 76]]; /* 花左右错落 */
    function render() {
      var dc = doneMap();
      hero.querySelectorAll('.mag-bub').forEach(function (b) { b.remove(); });
      var shown = 0;
      teen.forEach(function (c, i) {
        var isDone = !!dc[c.title];
        var prevDone = i === 0 || !!dc[teen[i - 1].title];
        if (!isDone && !prevDone) return;      /* 按序：前一课完成才浮现 */
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'mag-bub' + (isDone ? ' done' : '');
        b.innerHTML = '<span class="mb-n">' + (isDone ? '✓' : (i + 1)) + '</span>' +
          '<span><span class="mb-t">' + c.title.replace(/^第.课：/, '') + '</span><br>' +
          '<span class="mb-m">' + (c.meta || '') + '</span></span>';
        var sp = spots[i % spots.length];
        b.style.left = sp[0] + '%'; b.style.top = sp[1] + '%';
        b.style.animationDelay = (-(i * 1.7)) + 's';
        b.addEventListener('click', function () { try { SG.openCourse && SG.openCourse(c); } catch (e) {} });
        hero.appendChild(b);
        /* 依次淡入；新课程在完成上一课后延迟浮现 */
        setTimeout(function () { b.classList.add('show'); }, isDone ? 400 + shown * 900 : 600 + shown * 1200);
        shown++;
      });
      /* 生长进度标识（与 GLB 零件生长同源：doneCourses） */
      var tag = hero.querySelector('.mag-stage-tag') || (function () {
        var t = document.createElement('div'); t.className = 'mag-stage-tag'; hero.appendChild(t); return t;
      })();
      var names = ['花苞', '初绽', '半开', '盛放', '满树花'];
      var stg = Math.min(4, teen.filter(function (c) { return !!dc[c.title]; }).length);
      tag.textContent = '玉兰生长 · ' + names[stg] + '（' + stg + '/4）';
    }
    render();
    setInterval(render, 3000); /* 轻量同步完成态（真实数据源轮询） */
  }
  var bt = 0;
  (function waitBubbles() {
    if (document.getElementById('mag-hero') && window.SG) { bubbles(); return; }
    if (++bt < 60) setTimeout(waitBubbles, 300);
  })();
  addEventListener('viewchange', function (e) { if ((e && e.detail) === 'youth') setTimeout(bubbles, 400); });
})();
