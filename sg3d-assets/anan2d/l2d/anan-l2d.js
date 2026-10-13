/* ============================================================
   拾光 · 安安 Live2D 看板娘（自研 2D 骨骼动画引擎）
   ------------------------------------------------------------
   按 Live2D Cubism 工作流重建：分层部件(PSD 思路) → 骨骼绑定
   → 参数化(眨眼/视线/呼吸) → 物理摆锤(发/裙跟随) → 动作集。
   - 7 层干净部件：skirt/armL/armR/torso/hairL/hairR/head
   - 10 骨骼：root/spine/neck/head/hairL/hairR/shoulderL/shoulderR/skirt…
   - 13 种动作：idle/wave/greet/nod/shake/bow/cheer/shy/think/
     sleep/talk/point/surprised/stretch，支持交叉淡入与叠加
   - 眼睑/嘴部/腮红为程序化绘制，跟随头部骨骼空间
   ============================================================ */
(function () {
'use strict';
if (window.AnAnL2D && window.AnAnL2D.__v) return;

var BASE = 'sg3d-assets/anan2d/l2d/';
var DEG = Math.PI / 180;
var DEBUG = /[?&]l2ddebug=1/.test(location.search);

/* ---------- 2×3 矩阵 [a c e; b d f] ---------- */
function M() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
function mul(P, Q) {
  return {
    a: P.a * Q.a + P.c * Q.b, b: P.b * Q.a + P.d * Q.b,
    c: P.a * Q.c + P.c * Q.d, d: P.b * Q.c + P.d * Q.d,
    e: P.a * Q.e + P.c * Q.f + P.e, f: P.b * Q.e + P.d * Q.f + P.f
  };
}
function mT(x, y) { return { a: 1, b: 0, c: 0, d: 1, e: x, f: y }; }
function mR(r) { var c = Math.cos(r), s = Math.sin(r); return { a: c, b: s, c: -s, d: c, e: 0, f: 0 }; }
function mS(x, y) { return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 }; }
function mK(kx, ky) { return { a: 1, b: ky, c: kx, d: 1, e: 0, f: 0 }; }

/* ---------- 缓动 ---------- */
var EASE = {
  lin: function (t) { return t; },
  eio: function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
  eo: function (t) { return 1 - Math.pow(1 - t, 3); },
  ei: function (t) { return t * t * t; },
  ss: function (t) { return t * t * (3 - 2 * t); }
};
function sample(keys, t) {
  if (!keys || !keys.length) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  for (var i = 0; i < keys.length - 1; i++) {
    var k0 = keys[i], k1 = keys[i + 1];
    if (t <= k1[0]) {
      var u = (t - k0[0]) / Math.max(1e-6, k1[0] - k0[0]);
      return k0[1] + (k1[1] - k0[1]) * (EASE[k0[2] || 'lin'] || EASE.lin)(u);
    }
  }
  return keys[keys.length - 1][1];
}

/* ---------- 弹簧（半隐式欧拉，欠阻尼产生跟随感） ---------- */
function Spring(v, k, d) { this.v = v || 0; this.vel = 0; this.k = k || 60; this.d = d || 9; }
Spring.prototype.to = function (target, dt) {
  var a = (target - this.v) * this.k - this.vel * this.d;
  this.vel += a * dt; this.v += this.vel * dt; return this.v;
};

/* ---------- 动作剪辑（秒 / 度；head/neck 有虚拟通道 yw偏航 pt俯仰） ---------- */
/* 通道：r旋转 x,y位移 sx,sy缩放 kx,ky切变 | 参数：mouth/blush/lid/happyLid/zzz/breathSlow */
var MOTIONS = {
  wave: { dur: 2.4, tr: {
    'shoulderR.r': [[0,0],[0.22,-135,'eo'],[0.5,-135],[0.68,-105,'eio'],[0.86,-135,'eio'],[1.04,-110,'eio'],[1.22,-135,'eio'],[1.5,-130],[2.05,0,'eio']],
    'head.r': [[0,0],[0.3,-7,'eo'],[1.5,-7],[2.1,0,'eio']],
    'head.yw': [[0,0],[0.3,4,'eo'],[1.5,4],[2.1,0,'eio']],
    'spine.r': [[0,0],[0.3,1.6,'eo'],[1.6,1.6],[2.1,0,'eio']],
    'p.blush': [[0,0],[0.4,0.35],[1.6,0.35],[2.2,0]]
  }},
  greet: { dur: 2.8, tr: {
    'shoulderR.r': [[0,0],[0.25,-130,'eo'],[0.55,-130],[0.75,-105,'eio'],[0.95,-130,'eio'],[1.15,-108,'eio'],[1.35,-130,'eio'],[1.7,-126],[2.4,0,'eio']],
    'head.pt': [[0,0],[0.35,8,'eo'],[0.9,4],[1.3,6],[1.9,4],[2.5,0,'eio']],
    'head.r': [[0,0],[0.3,-6,'eo'],[1.5,-6],[2.4,0,'eio']],
    'p.blush': [[0,0],[0.5,0.4],[1.8,0.4],[2.6,0]]
  }},
  nod: { dur: 1.4, tr: {
    'head.pt': [[0,0],[0.18,14,'eo'],[0.42,-3,'eio'],[0.66,9,'eio'],[0.95,0,'eio']],
    'neck.pt': [[0,0],[0.18,5,'eo'],[0.42,-1],[0.66,3],[0.95,0,'eio']]
  }},
  shake: { dur: 1.6, tr: {
    'head.yw': [[0,0],[0.2,-12,'eio'],[0.5,11,'eio'],[0.8,-9,'eio'],[1.1,7,'eio'],[1.38,0,'eio']],
    'head.r': [[0,0],[0.2,3],[0.5,-3],[0.8,2],[1.1,-2],[1.4,0]]
  }},
  bow: { dur: 2.2, tr: {
    'head.pt': [[0,0],[0.35,20,'eo'],[1.3,20],[1.9,0,'eio']],
    'neck.pt': [[0,0],[0.35,7,'eo'],[1.3,7],[1.9,0,'eio']],
    'spine.sy': [[0,0],[0.35,-0.035,'eo'],[1.3,-0.035],[1.9,0,'eio']],
    'root.y': [[0,0],[0.35,14,'eo'],[1.3,14],[1.9,0,'eio']],
    'shoulderL.r': [[0,0],[0.35,-5,'eo'],[1.3,-5],[1.9,0,'eio']],
    'shoulderR.r': [[0,0],[0.35,5,'eo'],[1.3,5],[1.9,0,'eio']]
  }},
  cheer: { dur: 1.7, tr: {
    'root.y': [[0,0],[0.16,-34,'eo'],[0.42,0,'eio'],[0.6,-16,'eo'],[0.85,0,'eio']],
    'shoulderL.r': [[0,0],[0.18,115,'eo'],[0.9,115],[1.45,0,'eio']],
    'shoulderR.r': [[0,0],[0.18,-115,'eo'],[0.9,-115],[1.45,0,'eio']],
    'head.r': [[0,0],[0.2,-5],[0.9,-5],[1.45,0]],
    'p.happyLid': [[0,0],[0.2,1],[1.05,1],[1.5,0]],
    'p.mouth': [[0,0],[0.2,0.85],[1.05,0.85],[1.5,0]],
    'p.blush': [[0,0],[0.25,0.6],[1.1,0.6],[1.5,0]],
    'skirt.r': [[0,0],[0.2,2],[0.5,-2],[0.8,1.5],[1.2,0]]
  }},
  shy: { dur: 3.2, tr: {
    'head.r': [[0,0],[0.4,9,'eo'],[2.4,9],[3.0,0,'eio']],
    'head.pt': [[0,0],[0.4,7,'eo'],[2.4,7],[3.0,0,'eio']],
    'p.blush': [[0,0],[0.5,1],[2.5,1],[3.1,0]],
    'p.happyLid': [[0,0],[0.5,0.8],[2.4,0.8],[3.1,0]],
    'shoulderL.r': [[0,0],[0.4,-4],[2.4,-4],[3.0,0]],
    'shoulderR.r': [[0,0],[0.4,4],[2.4,4],[3.0,0]],
    'hairL.r': [[0,0],[0.5,3],[2.4,3],[3.0,0]],
    'hairR.r': [[0,0],[0.5,-3],[2.4,-3],[3.0,0]]
  }},
  think: { dur: 3.5, tr: {
    'head.r': [[0,0],[0.4,-8,'eo'],[2.8,-8],[3.3,0,'eio']],
    'head.pt': [[0,0],[0.4,-6,'eo'],[2.8,-6],[3.3,0,'eio']],
    'head.yw': [[0,0],[0.5,-6,'eo'],[2.8,-6],[3.3,0,'eio']],
    'shoulderR.r': [[0,0],[0.5,-52,'eo'],[2.8,-52],[3.4,0,'eio']],
    'p.blush': [[0,0],[0.6,0.15],[2.8,0.15],[3.4,0]]
  }},
  point: { dur: 2.4, tr: {
    'shoulderR.r': [[0,0],[0.3,-70,'eo'],[1.8,-70],[2.3,0,'eio']],
    'head.yw': [[0,0],[0.3,10,'eo'],[1.8,10],[2.3,0,'eio']],
    'head.r': [[0,0],[0.3,-3],[1.8,-3],[2.3,0]]
  }},
  surprised: { dur: 1.5, tr: {
    'root.y': [[0,0],[0.12,-18,'eo'],[0.4,0,'eio']],
    'head.pt': [[0,0],[0.15,-8,'eo'],[1.0,-8],[1.4,0,'eio']],
    'p.mouth': [[0,0],[0.15,1,'eo'],[1.0,1],[1.45,0]],
    'shoulderL.r': [[0,0],[0.15,12,'eo'],[1.0,12],[1.4,0,'eio']],
    'shoulderR.r': [[0,0],[0.15,-12,'eo'],[1.0,-12],[1.4,0,'eio']],
    'p.blush': [[0,0],[0.2,0.3],[1.0,0.3],[1.4,0]]
  }},
  stretch: { dur: 2.6, tr: {
    'shoulderL.r': [[0,0],[0.4,118,'eo'],[1.6,118],[2.3,0,'eio']],
    'shoulderR.r': [[0,0],[0.4,-118,'eo'],[1.6,-118],[2.3,0,'eio']],
    'root.y': [[0,0],[0.4,-10,'eo'],[1.6,-10],[2.3,0,'eio']],
    'spine.sy': [[0,0],[0.4,0.025,'eo'],[1.6,0.025],[2.3,0,'eio']],
    'head.pt': [[0,0],[0.4,-8,'eo'],[1.6,-8],[2.3,0,'eio']]
  }},
  sleep: { dur: 9999, loop: true, tr: {
    'p.lid': [[0,0],[0.8,1,'eio'],[99,1]],
    'head.pt': [[0,0],[1.0,12,'eio'],[99,12]],
    'head.r': [[0,0],[1.2,5,'eio'],[99,5]],
    'p.breathSlow': [[0,0],[1,1],[99,1]],
    'p.zzz': [[0,0],[1.2,1],[99,1]],
    'shoulderL.r': [[0,0],[1,-6,'eio'],[99,-6]],
    'shoulderR.r': [[0,0],[1,6,'eio'],[99,6]]
  }},
  talk: { dur: 0.9, loop: true, tr: {
    'p.mouth': [[0,0.1],[0.1,0.9],[0.2,0.25],[0.3,1],[0.42,0.15],[0.55,0.85],[0.68,0.2],[0.8,0.7],[0.9,0.1]],
    'head.pt': [[0,0],[0.15,2.5],[0.3,0],[0.45,2],[0.6,0],[0.75,1.5],[0.9,0]],
    'head.yw': [[0,0],[0.3,2],[0.6,-2],[0.9,0]]
  }}
};
var AMBIENT = ['think', 'stretch', 'shy'];

/* ---------- 主程序 ---------- */
function boot(ball, meta) {
  var W = meta.design.w, H = meta.design.h;
  var canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
  ball.appendChild(canvas);
  var ctx = canvas.getContext('2d');

  /* Live2D 授权标志 */
  var mark = document.createElement('div');
  mark.className = 'anan-l2d-mark';
  mark.title = 'Live2D 授权标识';
  mark.textContent = 'Live2D';
  ball.appendChild(mark);
  if (!document.getElementById('anan-l2d-mark-css')) {
    var st = document.createElement('style');
    st.id = 'anan-l2d-mark-css';
    st.textContent =
      '.anan-l2d-mark{position:absolute;right:1px;bottom:0;z-index:3;pointer-events:none;' +
      'font:700 8.5px/1.2 "Segoe UI",system-ui,sans-serif;letter-spacing:.08em;color:#8a7a5f;' +
      'opacity:.55;text-shadow:0 1px 2px rgba(255,255,255,.5);font-style:italic;}';
    document.head.appendChild(st);
  }

  /* ---------- 骨骼定义（bind = 全尺寸像素坐标） ---------- */
  var J = meta.joints;
  var BONES = {
    root:      { p: null,        b: J.root },
    spine:     { p: 'root',      b: [J.root[0], 1200] },
    skirt:     { p: 'root',      b: J.skirt },
    shoulderL: { p: 'spine',     b: J.shoulderL, rest: { r: -8 } },
    shoulderR: { p: 'spine',     b: J.shoulderR, rest: { r: 8 } },
    neck:      { p: 'spine',     b: J.neck },
    head:      { p: 'neck',      b: J.neck },
    hairL:     { p: 'head',      b: J.hairL },
    hairR:     { p: 'head',      b: J.hairR }
  };
  var ORDER = ['root', 'spine', 'skirt', 'shoulderL', 'shoulderR', 'neck', 'head', 'hairL', 'hairR'];
  var PART2BONE = { skirt: 'skirt', torso: 'spine', armL: 'shoulderL', armR: 'shoulderR', hairL: 'hairL', hairR: 'hairR', head: 'head' };

  var cur = {};   // 每帧通道值
  ORDER.forEach(function (n) { cur[n] = { r: 0, x: 0, y: 0, sx: 1, sy: 1, kx: 0, ky: 0, yw: 0, pt: 0 }; });

  /* ---------- 状态 ---------- */
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var gaze = { x: 0, y: 0, tx: 0, ty: 0 };
  var springs = {
    headR: new Spring(0, 120, 12), headX: new Spring(0, 120, 12), headY: new Spring(0, 120, 12),
    hairL: new Spring(0, 26, 4.2), hairR: new Spring(0, 26, 4.2),
    skirt: new Spring(0, 18, 4.5), breathe: 0
  };
  var blink = { t: 0, phase: 'idle', next: 2.2, hold: 0 };
  var params = { mouth: 0, blush: 0, lid: 0, happyLid: 0, zzz: 0, breathSlow: 0 };
  var motions = [];          // {def, t, w, name}
  var lastHeadR = 0, headRVel = 0;
  var lastInteract = performance.now() / 1000;
  var sleeping = false;

  /* ---------- 动作播放 ---------- */
  function play(name, opt) {
    var def = MOTIONS[name];
    if (!def) return;
    if (name !== 'sleep') sleeping = false;
    for (var i = 0; i < motions.length; i++) {
      if (motions[i].name === name) { motions[i].t = 0; motions[i].out = false; motions[i].outT = undefined; return; }
    }
    // 同类互斥：loop 动作（sleep/talk）播放时停掉其他 loop
    if (def.loop) motions.forEach(function (m) { if (MOTIONS[m.name].loop) m.out = true; });
    motions.push({ name: name, def: def, t: 0, w: 0, out: false, outT: undefined });
    if (opt && opt.then) setTimeout(function () { play(opt.then); }, (def.dur - 0.3) * 1000);
  }
  function stop(name) {
    motions.forEach(function (m) { if (!name || m.name === name) m.out = true; });
  }

  /* ---------- 每帧合成 ---------- */
  function tick(dt, now) {
    var n, c;
    // 0) 重置
    ORDER.forEach(function (k) { c = cur[k]; c.r = 0; c.x = 0; c.y = 0; c.sx = 1; c.sy = 1; c.kx = 0; c.ky = 0; c.yw = 0; c.pt = 0; });
    for (var k in params) params[k] = 0;

    // 1) 待机层（呼吸/微摆，永远叠加）
    var slow = 1 - 0.55 * Math.min(1, paramsBreathSlow());
    var bt = now * 1.35 * slow;
    var bAmp = 1 + 0.8 * Math.min(1, paramsBreathSlow());
    var br = Math.sin(bt) * bAmp;
    cur.spine.sy += 0.011 * br;
    cur.spine.y += 1.2 * br;
    cur.shoulderL.y += 2.2 * br; cur.shoulderR.y += 2.2 * br;
    cur.shoulderL.r += 0.9 * br; cur.shoulderR.r -= 0.9 * br;
    cur.head.pt += 1.6 * Math.sin(bt + 0.5);
    cur.head.yw += 1.4 * Math.sin(now * 0.31);
    cur.root.y += 1.5 * Math.sin(bt);
    function paramsBreathSlow() {
      var v = 0;
      motions.forEach(function (m) { v = Math.max(v, sample(m.def.tr['p.breathSlow'], m.t) * (m.w || 0)); });
      return v;
    }

    // 2) 视线跟随（弹簧平滑 + 限位）
    if (!reduced) {
      gaze.x += (gaze.tx - gaze.x) * Math.min(1, dt * 5.5);
      gaze.y += (gaze.ty - gaze.y) * Math.min(1, dt * 5.5);
    }
    cur.head.yw += gaze.x * 10;
    cur.head.pt += gaze.y * 6;
    cur.head.r += gaze.x * 3.2;
    cur.root.x += gaze.x * 2.5;

    // 3) 动作层（带淡入淡出权重，叠加）
    for (var i = motions.length - 1; i >= 0; i--) {
      var m = motions[i];
      m.t += dt;
      var dur = m.def.dur, wIn = Math.min(1, m.t / 0.18);
      if (m.out && m.outT === undefined) m.outT = m.t;
      var wOut = 1;
      if (m.out) wOut = Math.max(0, 1 - (m.t - m.outT) / 0.3);
      else if (!m.def.loop) wOut = Math.min(1, Math.max(0, (dur - m.t) / 0.3));
      m.w = wIn * wOut;
      if ((!m.def.loop && m.t >= dur) || (m.out && m.w <= 0)) { motions.splice(i, 1); continue; }
      var lct = m.def.loop ? (m.t % dur) : Math.min(m.t, dur);
      for (var ch in m.def.tr) {
        var v = sample(m.def.tr[ch], lct) * m.w;
        if (ch.charAt(0) === 'p') params[ch.slice(2)] += v;
        else {
          var dot = ch.indexOf('.'), bn = ch.slice(0, dot), cn = ch.slice(dot + 1);
          if (cur[bn]) cur[bn][cn] += v;
        }
      }
    }

    // 4) 眨眼状态机
    if (blink.phase === 'idle') {
      blink.next -= dt;
      if (blink.next <= 0 && params.lid < 0.5) { blink.phase = 'close'; blink.t = 0; }
    } else if (blink.phase === 'close') {
      blink.t += dt; params.lid = Math.min(1, blink.t / 0.09);
      if (blink.t >= 0.09) { blink.phase = 'hold'; blink.t = 0; }
    } else if (blink.phase === 'hold') {
      blink.t += dt; params.lid = 1;
      if (blink.t >= 0.045) { blink.phase = 'open'; blink.t = 0; }
    } else {
      blink.t += dt; params.lid = Math.max(0, 1 - blink.t / 0.16);
      if (blink.t >= 0.16) {
        blink.phase = 'idle';
        blink.next = Math.random() < 0.12 ? 0.28 : 2.8 + Math.random() * 3.7;
      }
    }
    if (params.happyLid > 0.6) params.lid = 0;   // 笑脸优先

    // 5) 头部虚拟通道 → 实际变换（偏航=平移+切变+微缩，俯仰=下移+微压）
    ['head', 'neck'].forEach(function (bn, idx) {
      var cc = cur[bn], f = idx === 0 ? 1 : 0.45;
      cc.x += cc.yw * 1.15 * f;
      cc.kx += cc.yw * 0.0058 * f;
      cc.sx -= Math.abs(cc.yw) * 0.0035 * f;
      cc.y += cc.pt * 1.05 * f;
      cc.sy -= cc.pt * 0.0032 * f;
    });

    // 6) 物理：发/裙弹簧跟随（目标=待机摆动 − 头角速度耦合 → 滞后甩动感）
    headRVel = (cur.head.r - lastHeadR) / Math.max(dt, 1e-4);
    lastHeadR = cur.head.r;
    var swayT = now * 0.9;
    var hairLT = 1.8 * Math.sin(swayT + 0.7) - headRVel * 0.32 - cur.head.r * 0.55;
    var hairRT = 1.8 * Math.sin(swayT + 1.5) - headRVel * 0.32 - cur.head.r * 0.55;
    if (reduced) { hairLT = 0; hairRT = 0; }
    cur.hairL.r += springs.hairL.to(hairLT, dt);
    cur.hairR.r += springs.hairR.to(hairRT, dt);
    var skirtT = 0.5 * Math.sin(swayT * 0.8) - cur.root.x * 0.25;
    if (reduced) skirtT = 0;
    cur.skirt.r += springs.skirt.to(skirtT, dt);
    cur.head.r = springs.headR.to(cur.head.r, dt);   // 头部弹簧平滑
    cur.head.x = springs.headX.to(cur.head.x, dt);
    cur.head.y = springs.headY.to(cur.head.y, dt);

    // 7) 前向运动学：计算世界矩阵（bind 时 W = T(关节世界坐标)，部件零偏移归位）
    var world = {};
    ORDER.forEach(function (name) {
      var b = BONES[name], cc = cur[name];
      var rest = b.rest || {};
      var pbx = b.p ? BONES[b.p].b[0] : 0, pby = b.p ? BONES[b.p].b[1] : 0;
      var L = mT(b.b[0] - pbx, b.b[1] - pby);
      L = mul(L, mT(cc.x, cc.y));
      L = mul(L, mR((cc.r + (rest.r || 0)) * DEG));
      L = mul(L, mK(cc.kx, cc.ky));
      L = mul(L, mS(cc.sx, cc.sy));
      world[name] = b.p ? mul(world[b.p], L) : L;
    });

    // 8) 绘制
    render(world, now);
  }

  /* ---------- 渲染 ---------- */
  var imgs = {};
  function render(world, now) {
    var cw = canvas.width, chh = canvas.height;
    if (!cw || !chh) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, chh);
    var margin = 1.02;
    var s = Math.min(cw / W, chh / (H * margin)) ;
    var ox = (cw - W * s) / 2, oy = (chh - H * s) / 2 + H * s * (margin - 1) / 2;
    var base = mul(mT(ox, oy), mS(s, s));

    meta.zorder.forEach(function (pn) {
      var img = imgs[pn], r = meta.rects[pn], bn = PART2BONE[pn];
      if (!img || !img.complete) return;
      var b = BONES[bn];
      var Mdraw = mul(base, mul(world[bn], mT(-b.b[0], -b.b[1])));
      ctx.setTransform(Mdraw.a, Mdraw.b, Mdraw.c, Mdraw.d, Mdraw.e, Mdraw.f);
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
    });

    // 脸部程序化层（头空间）
    var head = BONES.head;
    var Mh = mul(base, mul(world.head, mT(-head.b[0], -head.b[1])));
    ctx.setTransform(Mh.a, Mh.b, Mh.c, Mh.d, Mh.e, Mh.f);
    drawFace(now);

    if (DEBUG) drawDebug(world, base);
  }

  var F = null; // face 配置
  function drawFace(now) {
    var f = F;
    // 腮红
    if (params.blush > 0.02) {
      ctx.fillStyle = 'rgba(244,150,150,' + (0.34 * Math.min(1, params.blush)).toFixed(3) + ')';
      [f.blushL, f.blushR].forEach(function (p) {
        ctx.beginPath(); ctx.ellipse(p[0], p[1], 36, 19, 0, 0, Math.PI * 2); ctx.fill();
      });
    }
    // 嘴（说话/惊讶/开心时覆盖原画微笑）
    if (params.mouth > 0.03) {
      var mx = f.mouth[0], my = f.mouth[1], o = Math.min(1, params.mouth);
      ctx.fillStyle = 'rgb(253,241,231)';
      ctx.beginPath(); ctx.ellipse(mx, my, 42, 20, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgb(128,56,58)';
      ctx.beginPath(); ctx.ellipse(mx, my + 2, 25, 3 + 13 * o, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(140,80,74,.85)'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(mx - 26, my - 2 - 3 * o);
      ctx.quadraticCurveTo(mx, my - 7 - 4 * o, mx + 26, my - 2 - 3 * o); ctx.stroke();
    }
    // 眼睑（眨眼）
    var lid = Math.min(1, params.lid), happy = Math.min(1, params.happyLid);
    [f.eyeL, f.eyeR].forEach(function (e) {
      var x0 = e[0], y0 = e[1], x1 = e[2], y1 = e[3], w = x1 - x0, h = y1 - y0;
      if (lid > 0.02) {
        var cover = (y0 - 7) + (h + 14) * lid;
        ctx.fillStyle = 'rgb(253,241,231)';
        ctx.beginPath();
        ctx.moveTo(x0 - 5, y0 - 8);
        ctx.lineTo(x1 + 5, y0 - 8);
        ctx.lineTo(x1 + 5, cover);
        ctx.quadraticCurveTo((x0 + x1) / 2, cover + 5 * lid, x0 - 5, cover);
        ctx.closePath(); ctx.fill();
        if (lid > 0.25) {   // 睫毛线
          ctx.strokeStyle = 'rgba(74,56,44,.9)'; ctx.lineWidth = 4.2; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x0 + 3, cover - 1);
          ctx.quadraticCurveTo((x0 + x1) / 2, cover + 6 * lid, x1 - 3, cover - 2);
          ctx.stroke();
        }
      }
      if (happy > 0.05) {   // 开心眯眼 ⌣
        ctx.strokeStyle = 'rgba(74,56,44,' + (0.92 * happy).toFixed(3) + ')';
        ctx.lineWidth = 5.5; ctx.lineCap = 'round';
        var cy = y0 + h * 0.34;
        ctx.beginPath(); ctx.moveTo(x0 + 4, cy);
        ctx.quadraticCurveTo((x0 + x1) / 2, cy + 26 * happy, x1 - 4, cy);
        ctx.stroke();
      }
    });
    // 睡觉 Zzz
    if (params.zzz > 0.03) {
      ctx.fillStyle = 'rgba(126,146,196,' + (0.85 * Math.min(1, params.zzz)).toFixed(3) + ')';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (var i = 0; i < 3; i++) {
        var ph = (now * 0.45 + i / 3) % 1;
        var size = 26 + ph * 22;
        ctx.globalAlpha = Math.sin(ph * Math.PI) * Math.min(1, params.zzz);
        ctx.font = '700 ' + size.toFixed(0) + 'px Georgia,serif';
        ctx.fillText('Z', 1000 + ph * 55 + i * 12, 250 - ph * 110 - i * 18);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawDebug(world, base) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ORDER.forEach(function (name) {
      var b = BONES[name], wd = mul(base, world[name]);
      var jx = wd.e, jy = wd.f;
      // bind 点世界位置
      var bindM = mul(base, mul(world[name], mT(0, 0)));
      ctx.fillStyle = 'rgba(255,40,40,.9)';
      ctx.beginPath(); ctx.arc(jx, jy, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff0'; ctx.font = '10px monospace';
      ctx.fillText(name, jx + 5, jy - 4);
      if (b.p) {
        var bp = BONES[b.p], wp = mul(base, world[b.p]);
        ctx.strokeStyle = 'rgba(255,80,80,.7)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(wp.e, wp.f); ctx.lineTo(jx, jy); ctx.stroke();
      }
    });
  }

  /* ---------- 主循环 ---------- */
  var lastT = 0, running = true;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!running) { lastT = ts; return; }
    if (document.hidden) { lastT = ts; return; }
    var rect = ball.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4 || rect.bottom < 0 || rect.top > innerHeight) { lastT = ts; return; }
    var now = ts / 1000, dt = Math.min(0.05, lastT ? now - lastT : 0.016);
    lastT = now;
    resize();
    tick(dt, now);

    // 待机自主编排 & 入睡
    var idleFor = now - lastInteract;
    if (!sleeping && idleFor > 60) { sleeping = true; play('sleep'); }
    else if (!sleeping && motions.length === 0 && Math.random() < dt / 28) {
      play(AMBIENT[(Math.random() * AMBIENT.length) | 0]);
    }
  }

  function resize() {
    var w = ball.clientWidth, h = ball.clientHeight;
    if (!w || !h) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  }

  /* ---------- 事件钩子 ---------- */
  document.addEventListener('pointermove', function (e) {
    gaze.tx = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth - 0.5) * 2.4));
    gaze.ty = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight - 0.5) * 2.4));
    lastInteract = performance.now() / 1000;
    if (sleeping) { sleeping = false; stop('sleep'); }
  }, { passive: true });
  document.addEventListener('pointerdown', function () {
    lastInteract = performance.now() / 1000;
    if (sleeping) { sleeping = false; stop('sleep'); }
  }, { passive: true });

  ball.addEventListener('click', function () { play('greet'); });
  ball.addEventListener('pointerenter', function () {
    if (!motions.length && !sleeping && Math.random() < 0.6) play('wave');
  });

  // 面板打开 → 挥手；新消息 → 说话动作（按时长）
  function watch(sel, cb) {
    var el = document.querySelector(sel);
    if (el) cb(el); else {
      var ob = new MutationObserver(function () {
        var el2 = document.querySelector(sel);
        if (el2) { ob.disconnect(); cb(el2); }
      });
      ob.observe(document.body, { childList: true, subtree: true });
    }
  }
  watch('#sg-panel', function (panel) {
    var wasOpen = false;
    new MutationObserver(function () {
      var open = panel.offsetParent !== null && panel.getBoundingClientRect().width > 10;
      if (open && !wasOpen) play('wave');
      wasOpen = open;
    }).observe(panel, { attributes: true, attributeFilter: ['class', 'style'] });
    var log = panel.querySelector('.sg-log, .msg-list, #sg-log') || panel;
    new MutationObserver(function (ml) {
      ml.forEach(function (r) {
        if (!r.addedNodes.length) return;
        var txt = (r.addedNodes[0].textContent || '').length;
        if (txt > 1) { play('talk'); setTimeout(function () { stop('talk'); play('nod'); }, Math.min(900 + txt * 45, 5200)); }
      });
    }).observe(log, { childList: true });
  });
  watch('#sg-bubble', function (bub) {
    new MutationObserver(function () {
      var n = (bub.textContent || '').length;
      if (n > 1 && !sleeping) { play('talk'); setTimeout(function () { stop('talk'); }, Math.min(700 + n * 40, 4200)); }
    }).observe(bub, { childList: true, characterData: true, subtree: true });
  });

  /* ---------- 启动 ---------- */
  F = meta.face;
  var names = meta.zorder;
  Promise.all(names.map(function (pn) {
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () { imgs[pn] = img; res(); };
      img.onerror = function () { console.warn('[安安L2D] 部件加载失败', pn); res(); };
      img.src = BASE + pn + '.png';
    });
  })).then(function () {
    resize();
    requestAnimationFrame(frame);
    play('greet');
    console.log('[拾光] 安安 Live2D 看板娘已上线（自研骨骼引擎 · ' + names.length + ' 层 · 13 动作）');
  });

  /* ---------- 对外 API ---------- */
  window.AnAnL2D = {
    __v: 3,
    play: play,
    stop: stop,
    motions: Object.keys(MOTIONS),
    setGaze: function (x, y) { gaze.tx = x; gaze.ty = y; },
    pause: function (v) { running = !v; }
  };
}

/* ---------- 加载配置并启动 ---------- */
function start() {
  var ball = document.getElementById('sg-ball');
  if (!ball) return;
  fetch(BASE + 'parts.json').then(function (r) { return r.json(); })
    .then(function (meta) { boot(ball, meta); })
    .catch(function (e) { console.warn('[拾光] 安安 L2D 配置加载失败', e); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
})();
