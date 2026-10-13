/* ============================================================
   拾光 · 安安 Live2D 级看板娘运行时 v2（PixiJS 网格变形引擎）
   ------------------------------------------------------------
   流水线产物驱动：SAM 分层 + LaMa 补图 的图层集
   - 每层 PIXI.Mesh 细分网格（面部/发际/嘴角加密），顶点 LBS 绑定虚拟骨骼树
   - 骨骼树：root→spine→{shoulderL/R→elbow}→neck→head→{hairSideL/R 三段链}
             root→skirt 两段链
   - 九轴头部：yaw/pitch 连续参数 → 头组图层视差形变（depth 系数分层）
   - 三级视线：瞳孔(快/大) → 头(中) → 身(慢/小)，rebound 弹簧驱动
   - 物理：rebound SpringSystem（发梢/裙摆链式弹簧，跟随滞后）
   - 表情：参数集 300ms 渐变（normal/happy/sad/shy/angry/surprised）
   - 口型：摄像头 MediaPipe blendshape / 麦克风 Analyser / 动作驱动
   - 驱动链自动降级：摄像头 → 指针 → 模拟
   ============================================================ */
(function () {
'use strict';
if (window.AnAnL2D2 && window.AnAnL2D2.__v) return;
var DEG = Math.PI / 180;
var BASE = window.ANAN_L2D_BASE || 'sg3d-assets/anan2d/l2d/';

/* ---------- 2D 仿射矩阵 ---------- */
function M() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
function mul(P, Q) {
  return { a: P.a * Q.a + P.c * Q.b, b: P.b * Q.a + P.d * Q.b,
           c: P.a * Q.c + P.c * Q.d, d: P.b * Q.c + P.d * Q.d,
           e: P.a * Q.e + P.c * Q.f + P.e, f: P.b * Q.e + P.d * Q.f + P.f };
}
function mT(x, y) { return { a: 1, b: 0, c: 0, d: 1, e: x, f: y }; }
function mR(r) { var c = Math.cos(r), s = Math.sin(r); return { a: c, b: s, c: -s, d: c, e: 0, f: 0 }; }
function applyM(m, x, y) { return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; }
function invM(m) {
  var det = m.a * m.d - m.b * m.c;
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det,
           e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det };
}

/* ---------- 缓动 & 采样 ---------- */
var EASE = { lin: function (t) { return t; }, eio: function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
  eo: function (t) { return 1 - Math.pow(1 - t, 3); }, ei: function (t) { return t * t * t; } };
function sample(keys, t) {
  if (!keys || !keys.length) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  for (var i = 0; i < keys.length - 1; i++) {
    var k0 = keys[i], k1 = keys[i + 1];
    if (t <= k1[0]) { var u = (t - k0[0]) / Math.max(1e-6, k1[0] - k0[0]);
      return k0[1] + (k1[1] - k0[1]) * (EASE[k0[2] || 'lin'])(u); }
  }
  return keys[keys.length - 1][1];
}

/* ============ 默认调参集（阶段四闭环会重写 tuning.json） ============ */
var TUNE = {
  hairK: 28, hairD: 5.2, hairFollow: 0.34, hairSway: 1.9,
  skirtK: 16, skirtD: 4.5, skirtSway: 0.5,
  headK: 130, headD: 13,
  gazeEyeGain: 1.0, gazeHeadGain: 0.42, gazeBodyGain: 0.16,
  breathAmp: 0.011, breathRate: 1.35,
  blinkMin: 2.6, blinkMax: 6.2, blinkDouble: 0.12,
  yawCompress: 0.011, yawShift: 4.2, pitchShift: 3.0, pitchCompress: 0.007,
  mouthMapGamma: 0.8, mouthMax: 1.0
};
var TUNE_PRESETS = {
  A: { hairK: 28, hairD: 5.2, skirtK: 16, skirtD: 4.5 },   // 均衡
  B: { hairK: 45, hairD: 7.5, skirtK: 26, skirtD: 6.5 },   // 硬朗（少回弹）
  C: { hairK: 16, hairD: 3.4, skirtK: 10, skirtD: 3.0 }    // 柔软（多飘动）
};

/* ============ 表情参数集（300ms 渐变） ============ */
var EXPRESSIONS = {
  normal:    {},
  happy:     { eyeSmile: 0.85, mouthSmile: 0.85, blush: 0.55, browRaise: 2.5 },
  sad:       { browTilt: 17, mouthSmile: -0.45, eyeOpen: 0.86, headPt: 5, blush: 0.1 },
  shy:       { blush: 1.0, headYw: 7, headPt: 4, eyeOpen: 0.82, mouthSmile: 0.35 },
  angry:     { browTilt: -19, mouthSmile: -0.5, eyeOpen: 0.9, headPt: 2 },
  surprised: { mouthOpen: 0.92, browRaise: 6, eyeOpen: 1.14, headPt: -3 }
};

/* ============ 动作剪辑（沿用上版动作库语义，作用于骨骼通道） ============ */
var MOTIONS = {
  wave: { dur: 2.4, tr: {
    'shoulderR.r': [[0,0],[0.22,-135,'eo'],[0.5,-135],[0.68,-105,'eio'],[0.86,-135,'eio'],[1.04,-110,'eio'],[1.22,-135,'eio'],[1.5,-130],[2.05,0,'eio']],
    'elbowR.r': [[0,0],[0.22,-14,'eo'],[1.5,-14],[2.05,0,'eio']],
    'head.r': [[0,0],[0.3,-7,'eo'],[1.5,-7],[2.1,0,'eio']],
    'head.yw': [[0,0],[0.3,4,'eo'],[1.5,4],[2.1,0,'eio']],
    'p.blush': [[0,0],[0.4,0.35],[1.6,0.35],[2.2,0]] }},
  greet: { dur: 2.8, tr: {
    'shoulderR.r': [[0,0],[0.25,-130,'eo'],[0.55,-130],[0.75,-105,'eio'],[0.95,-130,'eio'],[1.15,-108,'eio'],[1.35,-130,'eio'],[1.7,-126],[2.4,0,'eio']],
    'head.pt': [[0,0],[0.35,8,'eo'],[0.9,4],[1.3,6],[1.9,4],[2.5,0,'eio']],
    'head.r': [[0,0],[0.3,-6,'eo'],[1.5,-6],[2.4,0,'eio']],
    'p.blush': [[0,0],[0.5,0.4],[1.8,0.4],[2.6,0]] }},
  nod: { dur: 1.4, tr: {
    'head.pt': [[0,0],[0.18,14,'eo'],[0.42,-3,'eio'],[0.66,9,'eio'],[0.95,0,'eio']],
    'neck.pt': [[0,0],[0.18,5,'eo'],[0.42,-1],[0.66,3],[0.95,0,'eio']] }},
  shake: { dur: 1.6, tr: {
    'head.yw': [[0,0],[0.2,-12,'eio'],[0.5,11,'eio'],[0.8,-9,'eio'],[1.1,7,'eio'],[1.38,0,'eio']],
    'head.r': [[0,0],[0.2,3],[0.5,-3],[0.8,2],[1.1,-2],[1.4,0]] }},
  bow: { dur: 2.2, tr: {
    'head.pt': [[0,0],[0.35,20,'eo'],[1.3,20],[1.9,0,'eio']],
    'neck.pt': [[0,0],[0.35,7,'eo'],[1.3,7],[1.9,0,'eio']],
    'spine.sy': [[0,0],[0.35,-0.03,'eo'],[1.3,-0.03],[1.9,0,'eio']],
    'root.y': [[0,0],[0.35,14,'eo'],[1.3,14],[1.9,0,'eio']],
    'shoulderL.r': [[0,0],[0.35,-5,'eo'],[1.3,-5],[1.9,0,'eio']],
    'shoulderR.r': [[0,0],[0.35,5,'eo'],[1.3,5],[1.9,0,'eio']] }},
  cheer: { dur: 1.7, tr: {
    'root.y': [[0,0],[0.16,-34,'eo'],[0.42,0,'eio'],[0.6,-16,'eo'],[0.85,0,'eio']],
    'shoulderL.r': [[0,0],[0.18,112,'eo'],[0.9,112],[1.45,0,'eio']],
    'shoulderR.r': [[0,0],[0.18,-112,'eo'],[0.9,-112],[1.45,0,'eio']],
    'head.r': [[0,0],[0.2,-5],[0.9,-5],[1.45,0]],
    'p.eyeSmile': [[0,0],[0.2,1],[1.05,1],[1.5,0]],
    'p.mouthOpen': [[0,0],[0.2,0.8],[1.05,0.8],[1.5,0]],
    'p.blush': [[0,0],[0.25,0.6],[1.1,0.6],[1.5,0]],
    'skirtTop.r': [[0,0],[0.2,1.6],[0.5,-1.6],[0.8,1.2],[1.2,0]] }},
  shy: { dur: 3.2, expr: 'shy', tr: {
    'head.r': [[0,0],[0.4,9,'eo'],[2.4,9],[3.0,0,'eio']],
    'head.pt': [[0,0],[0.4,7,'eo'],[2.4,7],[3.0,0,'eio']],
    'shoulderL.r': [[0,0],[0.4,-4],[2.4,-4],[3.0,0]],
    'shoulderR.r': [[0,0],[0.4,4],[2.4,4],[3.0,0]] }},
  think: { dur: 3.5, tr: {
    'head.r': [[0,0],[0.4,-8,'eo'],[2.8,-8],[3.3,0,'eio']],
    'head.pt': [[0,0],[0.4,-6,'eo'],[2.8,-6],[3.3,0,'eio']],
    'head.yw': [[0,0],[0.5,-6,'eo'],[2.8,-6],[3.3,0,'eio']],
    'shoulderR.r': [[0,0],[0.5,-52,'eo'],[2.8,-52],[3.4,0,'eio']],
    'elbowR.r': [[0,0],[0.5,-30,'eo'],[2.8,-30],[3.4,0,'eio']] }},
  point: { dur: 2.4, tr: {
    'shoulderR.r': [[0,0],[0.3,-70,'eo'],[1.8,-70],[2.3,0,'eio']],
    'head.yw': [[0,0],[0.3,10,'eo'],[1.8,10],[2.3,0,'eio']],
    'head.r': [[0,0],[0.3,-3],[1.8,-3],[2.3,0]] }},
  surprised: { dur: 1.5, expr: 'surprised', tr: {
    'root.y': [[0,0],[0.12,-18,'eo'],[0.4,0,'eio']],
    'head.pt': [[0,0],[0.15,-8,'eo'],[1.0,-8],[1.4,0,'eio']],
    'shoulderL.r': [[0,0],[0.15,12,'eo'],[1.0,12],[1.4,0,'eio']],
    'shoulderR.r': [[0,0],[0.15,-12,'eo'],[1.0,-12],[1.4,0,'eio']] }},
  stretch: { dur: 2.6, tr: {
    'shoulderL.r': [[0,0],[0.4,115,'eo'],[1.6,115],[2.3,0,'eio']],
    'shoulderR.r': [[0,0],[0.4,-115,'eo'],[1.6,-115],[2.3,0,'eio']],
    'root.y': [[0,0],[0.4,-10,'eo'],[1.6,-10],[2.3,0,'eio']],
    'spine.sy': [[0,0],[0.4,0.02,'eo'],[1.6,0.02],[2.3,0,'eio']],
    'head.pt': [[0,0],[0.4,-8,'eo'],[1.6,-8],[2.3,0,'eio']] }},
  sleep: { dur: 9999, loop: true, expr: null, tr: {
    'p.lid': [[0,0],[0.8,1,'eio'],[9999,1]],
    'head.pt': [[0,0],[1.0,12,'eio'],[9999,12]],
    'head.r': [[0,0],[1.2,5,'eio'],[9999,5]],
    'p.breathSlow': [[0,0],[1,1],[9999,1]],
    'p.zzz': [[0,0],[1.2,1],[9999,1]],
    'shoulderL.r': [[0,0],[1,-6,'eio'],[9999,-6]],
    'shoulderR.r': [[0,0],[1,6,'eio'],[9999,6]] }},
  talk: { dur: 0.9, loop: true, tr: {
    'p.mouthOpen': [[0,0.1],[0.1,0.9],[0.2,0.25],[0.3,1],[0.42,0.15],[0.55,0.85],[0.68,0.2],[0.8,0.7],[0.9,0.1]],
    'head.pt': [[0,0],[0.15,2.5],[0.3,0],[0.45,2],[0.6,0],[0.75,1.5],[0.9,0]],
    'head.yw': [[0,0],[0.3,2],[0.6,-2],[0.9,0]] }}
};
var AMBIENT = ['think', 'stretch', 'shy'];

/* ==================================================================
   引擎主体
   ================================================================== */
function boot(container, meta, joints, tuneOverride) {
  var W = meta.design.w, H = meta.design.h;
  var T = TUNE;
  if (tuneOverride) for (var tk in tuneOverride) T[tk] = tuneOverride[tk];

  var app = new PIXI.Application({
    backgroundAlpha: 0, antialias: true, autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2), resizeTo: container
  });
  container.appendChild(app.view);
  app.view.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';

  var stage = new PIXI.Container();
  app.stage.addChild(stage);

  /* ---------- 骨骼定义 ---------- */
  var J = joints.joints, F = joints.face;
  var eyeC = [(F.eyeL[0] + F.eyeR[0]) / 2, (F.eyeL[1] + F.eyeR[1]) / 2];
  var BONES = {
    root:      { p: null,    b: J.root },
    spine:     { p: 'root',  b: J.spine },
    skirtTop:  { p: 'root',  b: J.skirt },
    skirtMid:  { p: 'skirtTop', b: [J.skirt[0], J.skirt[1] + (meta.layers.skirt ? meta.layers.skirt.h * 0.45 : 400)] },
    shoulderL: { p: 'spine', b: J.shoulderL, rest: { r: -8 } },
    elbowL:    { p: 'shoulderL', b: [J.shoulderL[0] - 190, J.shoulderL[1] + 300] },
    shoulderR: { p: 'spine', b: J.shoulderR, rest: { r: 8 } },
    elbowR:    { p: 'shoulderR', b: [J.shoulderR[0] + 190, J.shoulderR[1] + 300] },
    neck:      { p: 'spine', b: J.neck },
    head:      { p: 'neck',  b: J.head },
    hairSideL1:{ p: 'head',  b: J.hairSideL },
    hairSideL2:{ p: 'hairSideL1', b: [J.hairSideL[0] - 8, J.hairSideL[1] + 170] },
    hairSideL3:{ p: 'hairSideL2', b: [J.hairSideL[0] - 14, J.hairSideL[1] + 340] },
    hairSideR1:{ p: 'head',  b: J.hairSideR },
    hairSideR2:{ p: 'hairSideR1', b: [J.hairSideR[0] + 8, J.hairSideR[1] + 170] },
    hairSideR3:{ p: 'hairSideR2', b: [J.hairSideR[0] + 14, J.hairSideR[1] + 340] }
  };
  var ORDER = ['root','spine','skirtTop','skirtMid','shoulderL','elbowL','shoulderR','elbowR',
               'neck','head','hairSideL1','hairSideL2','hairSideL3','hairSideR1','hairSideR2','hairSideR3'];

  /* ---------- 层 → 骨骼权重规则 ----------
     chain: [bones]，顶点按 y（或 x）在锚点间平滑分权；headGroup: 参与九轴视差 */
  var LAYER_BIND = {
    skirt:     { chain: ['skirtTop', 'skirtMid'], axis: 'y' },
    armL:      { chain: ['shoulderL', 'elbowL'], axis: 'dist' },
    armR:      { chain: ['shoulderR', 'elbowR'], axis: 'dist' },
    torso:     { chain: ['spine'], axis: 'y' },
    faceBase:  { chain: ['head'], headGroup: true, depth: 1.0 },
    eyeL:      { chain: ['head'], headGroup: true, depth: 0.8, eye: 'L' },
    eyeR:      { chain: ['head'], headGroup: true, depth: 0.8, eye: 'R' },
    pupilL:    { chain: ['head'], headGroup: true, depth: 0.62, pupil: 'L' },
    pupilR:    { chain: ['head'], headGroup: true, depth: 0.62, pupil: 'R' },
    browL:     { chain: ['head'], headGroup: true, depth: 0.9, brow: 'L' },
    browR:     { chain: ['head'], headGroup: true, depth: 0.9, brow: 'R' },
    mouth:     { chain: ['head'], headGroup: true, depth: 0.85, mouth: true },
    hairFront: { chain: ['head'], headGroup: true, depth: 1.12 },
    hairpin:   { chain: ['head'], headGroup: true, depth: 1.12 },
    hairSideL: { chain: ['hairSideL1', 'hairSideL2', 'hairSideL3'], axis: 'y', headGroup: true, depth: 1.05 },
    hairSideR: { chain: ['hairSideR1', 'hairSideR2', 'hairSideR3'], axis: 'y', headGroup: true, depth: 1.05 }
  };

  /* ---------- 网格构建 ---------- */
  var meshes = {};   // name → {mesh, basePos:Float32Array, weights:[{b,w}...] per vert, geom}
  function gridFor(name, rect) {
    // 面部/发际/嘴角加密
    var dense = /faceBase|eye|brow|mouth|hairFront/.test(name);
    var nx = dense ? 10 : 6, ny = dense ? 10 : (/hairSide|skirt/.test(name) ? 12 : 7);
    return [nx, ny];
  }
  function buildLayer(name) {
    var r = meta.layers[name];
    if (!r) return null;
    var tex = PIXI.Texture.from(BASE + 'layers/' + name + '.png');
    var cfg = LAYER_BIND[name] || { chain: ['root'] };
    var g = gridFor(name, r), nx = g[0], ny = g[1];
    var nvx = (nx + 1) * (ny + 1);
    var pos = new Float32Array(nvx * 2), uvs = new Float32Array(nvx * 2);
    var idx = [];
    for (var j = 0; j <= ny; j++) for (var i = 0; i <= nx; i++) {
      var k = j * (nx + 1) + i;
      pos[k * 2] = r.x + r.w * i / nx; pos[k * 2 + 1] = r.y + r.h * j / ny;
      uvs[k * 2] = i / nx; uvs[k * 2 + 1] = j / ny;
      if (j < ny && i < nx) {
        var a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    // 顶点权重：沿链轴在两相邻骨间平滑过渡
    var weights = new Array(nvx);
    var chain = cfg.chain.map(function (bn) { return BONES[bn].b; });
    for (var v = 0; v < nvx; v++) {
      var x = pos[v * 2], y = pos[v * 2 + 1];
      var ws = [];
      if (chain.length === 1) ws = [{ b: cfg.chain[0], w: 1 }];
      else {
        // 轴参数 t：y 轴或到链首点距离
        var t;
        if (cfg.axis === 'dist') {
          var dx = x - chain[0][0], dy = y - chain[0][1];
          t = Math.sqrt(dx * dx + dy * dy);
        } else t = y;
        // 各段锚点参数
        var anchors = chain.map(function (b2) {
          if (cfg.axis === 'dist') { var ddx = b2[0] - chain[0][0], ddy = b2[1] - chain[0][1]; return Math.sqrt(ddx * ddx + ddy * ddy); }
          return b2[1];
        });
        var a0 = anchors[0], aN = anchors[anchors.length - 1];
        var tn = Math.max(0, Math.min(1, (t - a0) / Math.max(1e-6, aN - a0)));
        var ft = tn * (chain.length - 1), seg = Math.min(chain.length - 2, Math.floor(ft)), f = ft - seg;
        var sm = f * f * (3 - 2 * f);
        ws.push({ b: cfg.chain[seg], w: 1 - sm });
        ws.push({ b: cfg.chain[seg + 1], w: sm });
      }
      weights[v] = ws;
    }
    var geom = new PIXI.Geometry()
      .addAttribute('aVertexPosition', pos, 2)
      .addAttribute('aTextureCoord', uvs, 2)
      .addIndex(idx);
    var mesh = new PIXI.Mesh(geom, new PIXI.MeshMaterial(tex));
    return { mesh: mesh, geom: geom, base: pos.slice(), weights: weights, cfg: cfg, rect: r };
  }

  meta.zorder.forEach(function (n) {
    var L = buildLayer(n);
    if (L) { meshes[n] = L; stage.addChild(L.mesh); }
  });
  // 口腔内层（嘴后暗色底板，开口时可见）
  if (meta.layers.mouth) {
    var mr = meta.layers.mouth;
    var cv = document.createElement('canvas'); cv.width = cv.height = 64;
    var c2 = cv.getContext('2d');
    var gr = c2.createRadialGradient(32, 30, 4, 32, 32, 30);
    gr.addColorStop(0, 'rgba(122,52,54,1)'); gr.addColorStop(1, 'rgba(122,52,54,0)');
    c2.fillStyle = gr; c2.fillRect(0, 0, 64, 64);
    var inner = new PIXI.Sprite(PIXI.Texture.from(cv));
    inner.anchor.set(0.5);
    inner.position.set(mr.x + mr.w / 2, mr.y + mr.h / 2);
    inner.width = mr.w * 1.5; inner.height = mr.h * 1.9;
    inner.alpha = 0;
    stage.addChildAt(inner, stage.getChildIndex(meshes.mouth.mesh));
    meshes.__innerMouth = { sprite: inner, rect: mr };
  }

  /* ---------- 物理弹簧（rebound） ---------- */
  var springSystem = new rebound.SpringSystem();
  function mkSpring(k, d) {
    var s = springSystem.createSpring(k, d);
    s.setCurrentValue(0); return s;
  }
  var springs = {
    headYw: mkSpring(120, 12), headPt: mkSpring(120, 12), headR: mkSpring(110, 12),
    eyeX: mkSpring(180, 14), eyeY: mkSpring(180, 14),
    bodyX: mkSpring(60, 9),
    hairL1: mkSpring(T.hairK, T.hairD), hairL2: mkSpring(T.hairK * 0.8, T.hairD * 0.9), hairL3: mkSpring(T.hairK * 0.6, T.hairD * 0.8),
    hairR1: mkSpring(T.hairK, T.hairD), hairR2: mkSpring(T.hairK * 0.8, T.hairD * 0.9), hairR3: mkSpring(T.hairK * 0.6, T.hairD * 0.8),
    skirtM: mkSpring(T.skirtK, T.skirtD)
  };

  /* ---------- 状态 ---------- */
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var gaze = { x: 0, y: 0 };
  var exprCur = {}, exprFrom = {}, exprTo = {}, exprT = 1;   // 300ms 渐变
  var EXPR_KEYS = ['eyeSmile', 'mouthSmile', 'blush', 'browRaise', 'browTilt', 'eyeOpen', 'headYw', 'headPt', 'mouthOpen'];
  EXPR_KEYS.forEach(function (k) { exprCur[k] = 0; exprFrom[k] = 0; exprTo[k] = 0; });
  exprCur.eyeOpen = 1; exprFrom.eyeOpen = 1; exprTo.eyeOpen = 1;   // eyeOpen 基准为 1
  var blinkT = 0, blinkPhase = 0, blinkNext = 2.0, lidV = 0;
  var mouthOpenV = 0, mouthDriveV = 0;   // 驱动链口型
  var motions = [];
  var lastInteract = -999, sleeping = false;
  var driverMode = 'sim';                 // cam | pointer | sim
  var cam = { on: false, yw: 0, pt: 0, r: 0, mouth: 0, blinkL: 0, blinkR: 0 };

  /* ---------- 表情 ---------- */
  function setExpr(name) {
    var e = EXPRESSIONS[name] || {};
    EXPR_KEYS.forEach(function (k) {
      exprFrom[k] = exprCur[k];
      exprTo[k] = (k === 'eyeOpen') ? (e[k] !== undefined ? e[k] : 1) : (e[k] || 0);
    });
    exprT = 0;
  }
  function tickExpr(dt) {
    if (exprT >= 1) return;
    exprT = Math.min(1, exprT + dt / 0.3);   // 300ms
    var u = exprT * exprT * (3 - 2 * exprT);
    EXPR_KEYS.forEach(function (k) { exprCur[k] = exprFrom[k] + (exprTo[k] - exprFrom[k]) * u; });
  }

  /* ---------- 动作 ---------- */
  function play(name, opts) {
    var def = MOTIONS[name]; if (!def) return;
    if (name !== 'sleep') sleeping = false;
    for (var i = 0; i < motions.length; i++)
      if (motions[i].name === name) { motions[i].t = 0; motions[i].out = false; motions[i].outT = undefined; return; }
    if (def.loop) motions.forEach(function (m) { if (MOTIONS[m.name].loop) m.out = true; });
    if (def.expr !== undefined && def.expr) setExpr(def.expr);
    motions.push({ name: name, def: def, t: 0, w: 0, out: false, outT: undefined });
  }
  function stop(name) { motions.forEach(function (m) { if (!name || m.name === name) m.out = true; }); }

  /* ---------- 每帧通道值 ---------- */
  var cur = {};
  ORDER.forEach(function (n) { cur[n] = { r: 0, x: 0, y: 0, sy: 0, yw: 0, pt: 0 }; });
  var P = {};  // 参数：lid/eyeSmile/blush/mouthOpen/zzz/breathSlow…

  function tick(dt, now) {
    ORDER.forEach(function (n) { var c = cur[n]; c.r = 0; c.x = 0; c.y = 0; c.sy = 0; c.yw = 0; c.pt = 0; });
    for (var k in P) P[k] = 0;
    tickExpr(dt);

    // ── 待机：呼吸 + 微动作 ──
    var bSlow = 1 - 0.55 * clamp01(P.breathSlow || 0);
    // （动作层在后面写入 P.breathSlow，本帧用上一帧值即可；先算动作再呼吸会顺序颠倒，故呼吸采样用运动表直接查）
    var bsAmp = 1;
    motions.forEach(function (m) { var v = sample(m.def.tr['p.breathSlow'], m.t) * (m.w || 0); bsAmp += 0.8 * clamp01(v); bSlow -= 0.55 * clamp01(v); });
    var bt = now * T.breathRate * Math.max(0.3, bSlow);
    var br = Math.sin(bt) * bsAmp;
    cur.spine.sy += T.breathAmp * br;
    cur.spine.y += 1.4 * br;
    cur.shoulderL.y += 2.4 * br; cur.shoulderR.y += 2.4 * br;
    cur.head.pt += 1.7 * Math.sin(bt + 0.5);
    cur.root.y += 1.6 * Math.sin(bt);
    cur.head.yw += 1.5 * Math.sin(now * 0.3);
    cur.head.r += 0.8 * Math.sin(now * 0.23 + 1);

    // ── 驱动链：三级视线 ──
    var gy = 0, gp = 0, gr2 = 0;
    if (cam.on) { gy = cam.yw; gp = cam.pt; gr2 = cam.r; }
    else { gy = gaze.x * 26; gp = gaze.y * 16; }
    springs.eyeX.setEndValue(clamp(gy, -30, 30));
    springs.eyeY.setEndValue(clamp(gp, -18, 18));
    springs.headYw.setEndValue(gy * T.gazeHeadGain);
    springs.headPt.setEndValue(gp * T.gazeHeadGain);
    springs.headR.setEndValue(gr2 + gy * 0.09);
    springs.bodyX.setEndValue(gy * T.gazeBodyGain);
    var eyeV = springs.eyeX.getCurrentValue(), eyeVp = springs.eyeY.getCurrentValue();
    cur.head.yw += springs.headYw.getCurrentValue();
    cur.head.pt += springs.headPt.getCurrentValue();
    cur.head.r += springs.headR.getCurrentValue();
    cur.root.x += springs.bodyX.getCurrentValue();
    cur.head.yw += exprCur.headYw || 0;   // 表情自带头姿
    cur.head.pt += exprCur.headPt || 0;

    // ── 动作层 ──
    for (var mi = motions.length - 1; mi >= 0; mi--) {
      var m = motions[mi]; m.t += dt;
      var dur = m.def.dur, wIn = Math.min(1, m.t / 0.18);
      if (m.out && m.outT === undefined) m.outT = m.t;
      var wOut = 1;
      if (m.out) wOut = Math.max(0, 1 - (m.t - m.outT) / 0.3);
      else if (!m.def.loop) wOut = Math.min(1, Math.max(0, (dur - m.t) / 0.3));
      m.w = wIn * wOut;
      if ((!m.def.loop && m.t >= dur) || (m.out && m.w <= 0)) { motions.splice(mi, 1); continue; }
      var lct = m.def.loop ? (m.t % dur) : Math.min(m.t, dur);
      for (var ch in m.def.tr) {
        var v = sample(m.def.tr[ch], lct) * m.w;
        if (ch.charAt(0) === 'p') P[ch.slice(2)] = (P[ch.slice(2)] || 0) + v;
        else {
          var dot = ch.indexOf('.'), bn = ch.slice(0, dot), cn = ch.slice(dot + 1);
          if (cur[bn] && cur[bn][cn] !== undefined) cur[bn][cn] += v;
        }
      }
    }

    // ── 眨眼（摄像头眨眼优先，否则编排） ──
    if (cam.on) {
      lidV = Math.max(cam.blinkL, cam.blinkR);
    } else {
      if (blinkPhase === 0) {
        blinkNext -= dt;
        if (blinkNext <= 0 && (P.lid || 0) < 0.5) { blinkPhase = 1; blinkT = 0; }
      } else if (blinkPhase === 1) { blinkT += dt; lidV = Math.min(1, blinkT / 0.09); if (blinkT >= 0.09) { blinkPhase = 2; blinkT = 0; } }
      else if (blinkPhase === 2) { blinkT += dt; lidV = 1; if (blinkT >= 0.045) { blinkPhase = 3; blinkT = 0; } }
      else {
        blinkT += dt; lidV = Math.max(0, 1 - blinkT / 0.16);
        if (blinkT >= 0.16) { blinkPhase = 0; lidV = 0; blinkNext = Math.random() < T.blinkDouble ? 0.3 : T.blinkMin + Math.random() * (T.blinkMax - T.blinkMin); }
      }
    }
    if ((P.lid || 0) > lidV) lidV = Math.min(1, P.lid);

    // ── 口型：驱动链 or 动作 ──
    var mo = Math.max(P.mouthOpen || 0, mouthDriveV);
    mouthOpenV += (mo - mouthOpenV) * Math.min(1, dt * 18);

    // ── 物理：发链/裙链目标值 = 待机摆动 − 头部角速度耦合 ──
    var swayT = now * 0.9;
    var hr = cur.head.r + springs.headYw.getCurrentValue() * 0.4;
    var t1 = T.hairSway * Math.sin(swayT + 0.7) - hr * 0.55;
    var t2 = T.hairSway * Math.sin(swayT + 1.5) - hr * 0.55;
    if (reduced || cam.on) { t1 = -hr * 0.5; t2 = -hr * 0.5; }
    springs.hairL1.setEndValue(t1); springs.hairL2.setEndValue(springs.hairL1.getCurrentValue() * 1.35);
    springs.hairL3.setEndValue(springs.hairL2.getCurrentValue() * 1.4);
    springs.hairR1.setEndValue(t2); springs.hairR2.setEndValue(springs.hairR1.getCurrentValue() * 1.35);
    springs.hairR3.setEndValue(springs.hairR2.getCurrentValue() * 1.4);
    springs.skirtM.setEndValue(reduced ? 0 : T.skirtSway * Math.sin(swayT * 0.8) - cur.root.x * 0.22);
    cur.hairSideL1.r += springs.hairL1.getCurrentValue();
    cur.hairSideL2.r += springs.hairL2.getCurrentValue();
    cur.hairSideL3.r += springs.hairL3.getCurrentValue();
    cur.hairSideR1.r += springs.hairR1.getCurrentValue();
    cur.hairSideR2.r += springs.hairR2.getCurrentValue();
    cur.hairSideR3.r += springs.hairR3.getCurrentValue();
    cur.skirtMid.r += springs.skirtM.getCurrentValue();

    // ── FK：世界矩阵；skinM = W∘T(−bind) 为顶点蒙皮矩阵 ──
    var world = {};
    skinM = {};
    ORDER.forEach(function (name) {
      var b = BONES[name], c2 = cur[name], rest = b.rest || {};
      var pbx = b.p ? BONES[b.p].b[0] : 0, pby = b.p ? BONES[b.p].b[1] : 0;
      var L = mT(b.b[0] - pbx + c2.x, b.b[1] - pby + c2.y + c2.pt * 1.05);
      L = mul(L, mR((c2.r + (rest.r || 0)) * DEG));
      L = mul(L, mS(1, 1 + c2.sy));
      world[name] = b.p ? mul(world[b.p], L) : L;
      skinM[name] = mul(world[name], mT(-b.b[0], -b.b[1]));
    });

    // ── 顶点变形 ──
    var ywDeg = cur.head.yw, ptDeg = cur.head.pt;
    for (var name2 in meshes) {
      if (name2 === '__innerMouth') continue;
      var L2 = meshes[name2], g2 = L2.geom;
      var buf = g2.getBuffer('aVertexPosition');
      var arr = buf.data, base = L2.base, ws2 = L2.weights, cfg = L2.cfg, rc = L2.rect;
      for (var v = 0; v < ws2.length; v++) {
        var bx = base[v * 2], by = base[v * 2 + 1];
        var acc = [0, 0], wl = ws2[v];
        for (var wi = 0; wi < wl.length; wi++) {
          var pw = applyM(skinM[wl[wi].b], bx, by);
          acc[0] += pw[0] * wl[wi].w; acc[1] += pw[1] * wl[wi].w;
        }
        var fx = acc[0], fy = acc[1];
        // 九轴视差：头组按 depth 压缩+平移
        if (cfg.headGroup) {
          var dp = cfg.depth || 1;
          fx += (fx - J.head[0]) * -Math.abs(ywDeg) * T.yawCompress * dp * 0.1 + ywDeg * T.yawShift * dp * 0.14;
          fy += (fy - J.head[1]) * -Math.abs(ptDeg) * T.pitchCompress * dp * 0.1 + ptDeg * T.pitchShift * dp * 0.12;
        }
        arr[v * 2] = fx; arr[v * 2 + 1] = fy;
      }
      buf.update();
    }
    applyFace(now);
    stageTransform();
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* ---------- 面部参数渲染（眨眼/嘴/腮红） ---------- */
  var blushSprite = null;
  function makeBlush() {
    if (!F.blushL) return;
    var cv = document.createElement('canvas'); cv.width = cv.height = 64;
    var c2 = cv.getContext('2d');
    var gr = c2.createRadialGradient(32, 32, 4, 32, 32, 30);
    gr.addColorStop(0, 'rgba(244,150,150,.9)'); gr.addColorStop(1, 'rgba(244,150,150,0)');
    c2.fillStyle = gr; c2.fillRect(0, 0, 64, 64);
    blushSprite = new PIXI.Sprite(PIXI.Texture.from(cv));
    blushSprite.anchor.set(0.5);
    // 腮红应在眼嘴之上、侧发之下
    if (meshes.hairSideL) stage.addChildAt(blushSprite, stage.getChildIndex(meshes.hairSideL.mesh));
    else stage.addChild(blushSprite);
  }
  makeBlush();

  var skinM = {};   // tick() 每帧写入
  function applyFace(now) {
    // 眨眼：眼/瞳层顶点自上而下压向当前眼中心
    var eyeSmileV = clamp01((exprCur.eyeSmile || 0) + (P.eyeSmile || 0));
    var open = clamp01(1 - lidV) * (1 - eyeSmileV * 0.85) * exprCur.eyeOpen;
    ['L', 'R'].forEach(function (side) {
      var eb = F['eye' + side + 'Box'];
      var cNow = applyM(skinM.head, (eb[0] + eb[2]) / 2, (eb[1] + eb[3]) / 2);
      var cEx = applyM(skinM.head, eb[0], eb[3]);
      var half = Math.max(4, Math.abs(cEx[1] - cNow[1]));
      ['eye', 'pupil'].forEach(function (kind) {
        var nm = kind + side, L2 = meshes[nm];
        if (!L2) return;
        var buf = L2.geom.getBuffer('aVertexPosition'), arr = buf.data, base2 = L2.base;
        for (var v = 0; v < arr.length / 2; v++) {
          var topness = clamp01((eb[3] - base2[v * 2 + 1]) / Math.max(1, eb[3] - eb[1])); // 0底 1顶
          arr[v * 2 + 1] = cNow[1] + (arr[v * 2 + 1] - cNow[1]) * (1 - (1 - open) * topness);
          if (kind === 'pupil') {
            arr[v * 2] += eyePupilOffX(); arr[v * 2 + 1] += eyePupilOffY();
          }
        }
        buf.update();
        L2.mesh.alpha = (kind === 'pupil' && lidV > 0.85) ? 0 : 1;
      });
    });
    // 嘴：开口 → 嘴层下唇下拉 + 口腔层淡入；微笑 → 嘴角上移
    var mo = clamp01(mouthOpenV) * T.mouthMax;
    var mL = meshes.mouth;
    if (mL) {
      var mb = F.mouthBox;
      var buf2 = mL.geom.getBuffer('aVertexPosition'), arr2 = buf2.data, base3 = mL.base;
      var mh = mb[3] - mb[1], mcx = (mb[0] + mb[2]) / 2;
      for (var v2 = 0; v2 < arr2.length / 2; v2++) {
        var yy0 = base3[v2 * 2 + 1];
        var down = clamp01((yy0 - mcy) / mh) * mo * mh * 0.75;
        var up = clamp01((mcy - yy0) / mh) * mo * mh * 0.12;
        var xx0 = base3[v2 * 2];
        var edge = clamp01(Math.abs(xx0 - mcx) / ((mb[2] - mb[0]) / 2));
        arr2[v2 * 2 + 1] += down - up - (exprCur.mouthSmile || 0) * edge * mh * 0.5;
      }
      buf2.update();
    }
    if (meshes.__innerMouth) {
      var im2 = meshes.__innerMouth.sprite;
      im2.alpha = mo * 0.95;
      im2.scale.y = 0.2 + mo * 0.9;
    }
    // 眉：raise/tilt
    ['L', 'R'].forEach(function (side2) {
      var nm = 'brow' + side2, L3 = meshes[nm];
      if (!L3) return;
      var buf3 = L3.geom.getBuffer('aVertexPosition'), arr3 = buf3.data, base4 = L3.base;
      var bcx = L3.rect.x + L3.rect.w / 2, bw2 = L3.rect.w / 2;
      var tilt = (exprCur.browTilt || 0) * (side2 === 'L' ? 1 : -1);
      for (var v3 = 0; v3 < arr3.length / 2; v3++) {
        var rel = (base4[v3 * 2] - bcx) / Math.max(1, bw2);
        var inner = side2 === 'L' ? rel : -rel;
        arr3[v3 * 2 + 1] -= (exprCur.browRaise || 0) * 1.5;
        arr3[v3 * 2 + 1] -= tilt * inner * 0.9;
      }
      buf3.update();
    });
    // 腮红
    if (blushSprite) {
      var bl = clamp01((exprCur.blush || 0) + (P.blush || 0));
      var bc = [(F.blushL[0] + F.blushR[0]) / 2, (F.blushL[1] + F.blushR[1]) / 2];
      var bp = applyM(skinM.head, bc[0], bc[1]);
      blushSprite.position.set(bp[0], bp[1] + 4);
      blushSprite.width = Math.abs(F.blushR[0] - F.blushL[0]) * 1.5;
      blushSprite.height = 60;
      blushSprite.alpha = bl * 0.55;
      blushSprite.visible = bl > 0.02;
    }
    // Zzz
    if (P.zzz > 0.02) drawZzz(now, P.zzz);
    else if (zzzSprite) zzzSprite.visible = false;
  }
  function eyePupilOffX() { return springs.eyeX.getCurrentValue() * 0.55; }
  function eyePupilOffY() { return springs.eyeY.getCurrentValue() * 0.4; }

  var zzzSprite = null;
  function drawZzz(now, w2) {
    if (!zzzSprite) {
      var cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
      var c2 = cv.getContext('2d');
      c2.font = '700 90px Georgia,serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
      c2.fillStyle = 'rgba(126,146,196,.9)'; c2.fillText('Z', 64, 64);
      zzzSprite = new PIXI.Sprite(PIXI.Texture.from(cv));
      zzzSprite.anchor.set(0.5);
      stage.addChild(zzzSprite);
    }
    zzzSprite.visible = true;
    var ph = (now * 0.5) % 1;
    zzzSprite.alpha = Math.sin(ph * Math.PI) * 0.85 * w2;
    var sc = 0.3 + ph * 0.35;
    zzzSprite.scale.set(sc);
    var hm = skinM.head, p0 = applyM(hm, J.head[0] + 230, J.head[1] - 260);
    zzzSprite.position.set(p0[0] + ph * 40, p0[1] - ph * 70);
  }

  /* ---------- 视图适配 ---------- */
  function stageTransform() {
    var cw = app.renderer.width / app.renderer.resolution, ch2 = app.renderer.height / app.renderer.resolution;
    var s = Math.min(cw / (W * 0.62), ch2 / (H * 1.0));
    stage.scale.set(s);
    stage.position.set(cw / 2 - (W / 2) * s, ch2 / 2 - (H / 2) * s);
  }

  /* ---------- 驱动链：摄像头 → 指针 → 模拟 ---------- */
  function setupDrivers() {
    var mpActive = false;
    document.addEventListener('pointermove', function (e) {
      if (cam.on) return;
      driverMode = 'pointer';
      gaze.x = clamp((e.clientX / window.innerWidth - 0.5) * 2.4, -1, 1);
      gaze.y = clamp((e.clientY / window.innerHeight - 0.5) * 2.4, -1, 1);
      lastInteract = performance.now() / 1000;
      if (sleeping) { sleeping = false; stop('sleep'); }
    }, { passive: true });
    document.addEventListener('pointerdown', function () {
      lastInteract = performance.now() / 1000;
      if (sleeping) { sleeping = false; stop('sleep'); }
    }, { passive: true });
    // 模拟驱动：无交互时的缓慢游走
    setInterval(function () {
      var idleFor = performance.now() / 1000 - lastInteract;
      if (!cam.on && idleFor > 25) {
        driverMode = 'sim';
        var t = performance.now() / 1000;
        gaze.x = Math.sin(t * 0.21) * 0.35; gaze.y = Math.sin(t * 0.17 + 2) * 0.25;
      }
    }, 500);
  }
  setupDrivers();

  /* 摄像头面捕（用户主动开启） */
  function enableCamera() {
    var vision, landmarker, video, running = true;
    return Promise.resolve().then(function () {
      return import(BASE + 'vendor/vision_bundle.mjs');
    }).then(function (v) {
      vision = v;
      return vision.FilesetResolver.forVisionTasks(BASE + 'vendor');
    }).then(function (files) {
      return vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: BASE + 'vendor/face_landmarker.task' },
        runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true
      });
    }).then(function (lm) {
      landmarker = lm;
      return navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    }).then(function (stream) {
      video = document.createElement('video');
      video.srcObject = stream; video.muted = true; video.playsInline = true;
      return video.play();
    }).then(function () {
      cam.on = true; driverMode = 'cam';
      (function loop() {
        if (!running) return;
        if (video.readyState >= 2) {
          var res = landmarker.detectForVideo(video, performance.now());
          if (res.faceLandmarks && res.faceLandmarks.length) {
            if (res.facialTransformationMatrixes && res.facialTransformationMatrixes.length) {
              var md = res.facialTransformationMatrixes[0].data;
              cam.yw = clamp(Math.atan2(md[8], md[10]) / DEG * 1.2, -40, 40);
              cam.pt = clamp(-Math.asin(clamp(md[9], -1, 1)) / DEG * 1.1, -30, 30);
              cam.r = clamp(Math.atan2(md[1], md[5]) / DEG, -25, 25);
            }
            if (res.faceBlendshapes && res.faceBlendshapes.length) {
              var bs = {}; res.faceBlendshapes[0].categories.forEach(function (c2) { bs[c2.categoryName] = c2.score; });
              cam.mouth = Math.pow(clamp01(bs.jawOpen || 0), T.mouthMapGamma);
              cam.blinkL = clamp01((bs.eyeBlinkLeft || 0) * 1.15);
              cam.blinkR = clamp01((bs.eyeBlinkRight || 0) * 1.15);
            }
          }
        }
        requestAnimationFrame(loop);
      })();
      return true;
    }).catch(function (e) {
      console.warn('[安安L2D] 摄像头面捕不可用，保持指针/模拟驱动', e);
      return false;
    });
  }

  /* 麦克风口型 */
  function attachAnalyser(an) {
    var buf = new Uint8Array(an.frequencyBinCount);
    (function loop() {
      an.getByteTimeDomainData(buf);
      var sum = 0;
      for (var i = 0; i < buf.length; i++) { var d2 = (buf[i] - 128) / 128; sum += d2 * d2; }
      var rms = Math.sqrt(sum / buf.length);
      mouthDriveV = Math.pow(clamp01(rms * 5.5), T.mouthMapGamma);
      requestAnimationFrame(loop);
    })();
    return true;
  }
  function enableMic() {
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var ac = new (window.AudioContext || window.webkitAudioContext)();
      var srcNode = ac.createMediaStreamSource(stream);
      var an = ac.createAnalyser(); an.fftSize = 512;
      srcNode.connect(an);
      return attachAnalyser(an);
    }).catch(function () { return false; });
  }

  /* ---------- 主循环 ---------- */
  var lastT = 0, fpsBuf = [];
  app.ticker.add(function () {
    var now = app.ticker.lastTime / 1000;
    var dt = Math.min(0.05, lastT ? now - lastT : 0.016);
    lastT = now;
    if (document.hidden) return;
    var r = container.getBoundingClientRect();
    if (r.width < 4 || r.bottom < 0 || r.top > innerHeight) return;
    springSystem.loop(now * 1000);
    tick(dt, now);
    fpsBuf.push(dt); if (fpsBuf.length > 240) fpsBuf.shift();
    // 自主编排
    var idleFor = now - lastInteract;
    if (!sleeping && idleFor > 60) { sleeping = true; play('sleep'); }
    else if (!sleeping && motions.length === 0 && Math.random() < dt / 30) {
      play(AMBIENT[(Math.random() * AMBIENT.length) | 0]);
    }
  });

  /* ---------- 对外 API ---------- */
  window.AnAnL2D2 = {
    __v: 2,
    play: play, stop: stop, setExpr: setExpr,
    exprs: Object.keys(EXPRESSIONS), motions: Object.keys(MOTIONS),
    enableCamera: enableCamera, enableMic: enableMic,
    setGaze: function (x, y) { gaze.x = x; gaze.y = y; driverMode = 'pointer'; },
    setMouth: function (v) { mouthDriveV = clamp01(v); },
    setTune: function (o) { for (var k2 in o) T[k2] = o[k2]; },
    getTune: function () { return JSON.parse(JSON.stringify(T)); },
    attachAnalyser: attachAnalyser,
    state: function () {
      return { lid: lidV, mouth: mouthOpenV, fps: window.AnAnL2D2 ? window.AnAnL2D2.fps() : 0,
               yaw: springs.headYw.getCurrentValue(), pitch: springs.headPt.getCurrentValue(),
               eyeX: springs.eyeX.getCurrentValue(), bodyX: springs.bodyX.getCurrentValue(),
               expr: JSON.parse(JSON.stringify(exprCur)), driver: driverMode, motions: motions.map(function (m2) { return m2.name; }) };
    },
    fps: function () {
      if (!fpsBuf.length) return 0;
      var s2 = 0; fpsBuf.forEach(function (d3) { s2 += d3; });
      return Math.round(10 * fpsBuf.length / s2) / 10;
    },
    driver: function () { return driverMode; }
  };
}

/* ---------- 启动 ---------- */
function start() {
  var container = document.getElementById('anan-l2d-stage') || document.getElementById('sg-ball');
  if (!container) return;
  Promise.all([
    fetch(BASE + 'layers/layers.json').then(function (r) { return r.json(); }),
    fetch(BASE + 'layers/joints.json').then(function (r) { return r.json(); })
  ]).then(function (rs) {
    boot(container, rs[0], rs[1], null);
    play0();
    console.log('[拾光] 安安 Live2D 引擎 v2 已上线（PixiJS 网格 · SAM 分层）');
  }).catch(function (e) { console.warn('[拾光] L2D v2 启动失败', e); });
  function play0() { if (window.AnAnL2D2) window.AnAnL2D2.play('greet'); }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
})();
