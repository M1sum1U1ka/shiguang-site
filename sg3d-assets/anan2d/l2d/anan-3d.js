/* ============================================================
   拾光 · 安安 3D 数字人看板娘（Tripo 绑骨模型 + 程序化动画引擎）
   ------------------------------------------------------------
   - 模型：anan-3d-web.glb（80k 面 / 1024 贴图 / 41 骨 / 无变形键 → 表情程序化）
   - 骨骼驱动：世界轴旋转 Δ × bind 姿态（每帧从 bind 重建，零漂移）
   - 表情系统：头姿 + 眼睑贴花(眨眼) + 嘴部贴花(开合/微笑) + 腮红精灵，300ms 渐变
   - 动作库：wave/greet/nod/shake/bow/cheer/shy/think/point/surprised/stretch/sleep/talk
   - 交互：指针三级视线（眼→头→身）；开面板=挥手；新消息=说话；久置=睡觉
   ============================================================ */
(function () {
'use strict';

var MODEL_URL = 'sg3d-assets/models/anan-3d-web.glb';
var DEG = Math.PI / 180;

/* 眼部/嘴部锚点（来自 Blender 面部测量，glTF 坐标系：x 同 blender，y=z_bl，z=−y_bl） */
var FACE = {
  eyeL:  [0.148, 0.882, 0.024],   // 她的左眼（画面右侧）
  eyeR:  [0.148, 0.879, -0.024],
  eyeW: 0.040, eyeH: 0.024,
  mouth: [0.150, 0.843, 0.000],
  mouthW: 0.028, mouthH: 0.012,
  blushL: [0.140, 0.862, 0.052],
  blushR: [0.140, 0.862, -0.052]
};

/* ---------- 动作剪辑（世界轴：rx 俯仰 / ry 偏航 / rz 侧滚，单位度） ---------- */
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
var MOTIONS = {
  wave: { dur: 2.4, tr: {
    'R_Upperarm.rz': [[0,0],[0.22,-166,'eo'],[0.5,-166],[0.68,-150,'eio'],[0.86,-166,'eio'],[1.04,-152,'eio'],[1.22,-166,'eio'],[1.5,-162],[2.05,0,'eio']],
    'R_Forearm.rz': [[0,0],[0.22,-28,'eo'],[1.5,-28],[2.05,0,'eio']],
    'R_Forearm.ry': [[0,0],[0.3,-18],[0.68,18,'eio'],[1.04,-16,'eio'],[1.4,14,'eio'],[1.8,0,'eio']],
    'Head.rz': [[0,0],[0.3,-6,'eo'],[1.5,-6],[2.1,0,'eio']],
    'p.blush': [[0,0],[0.4,0.4],[1.6,0.4],[2.2,0]] }},
  greet: { dur: 2.8, tr: {
    'R_Upperarm.rz': [[0,0],[0.25,-162,'eo'],[0.55,-162],[0.75,-148,'eio'],[0.95,-162,'eio'],[1.15,-150,'eio'],[1.35,-162,'eio'],[1.7,-158],[2.4,0,'eio']],
    'R_Forearm.rz': [[0,0],[0.25,-26,'eo'],[1.7,-26],[2.4,0,'eio']],
    'Head.rx': [[0,0],[0.35,7,'eo'],[0.9,3],[1.3,5],[1.9,3],[2.5,0,'eio']],
    'Head.rz': [[0,0],[0.3,-5,'eo'],[1.5,-5],[2.4,0,'eio']],
    'p.blush': [[0,0],[0.5,0.4],[1.8,0.4],[2.6,0]] }},
  nod: { dur: 1.4, tr: {
    'Head.rx': [[0,0],[0.18,14,'eo'],[0.42,-3,'eio'],[0.66,9,'eio'],[0.95,0,'eio']],
    'NeckTwist01.rx': [[0,0],[0.18,5,'eo'],[0.42,-1],[0.66,3],[0.95,0,'eio']] }},
  shake: { dur: 1.6, tr: {
    'Head.ry': [[0,0],[0.2,-13,'eio'],[0.5,12,'eio'],[0.8,-10,'eio'],[1.1,8,'eio'],[1.38,0,'eio']],
    'Head.rz': [[0,0],[0.2,3],[0.5,-3],[0.8,2],[1.1,-2],[1.4,0]] }},
  bow: { dur: 2.2, tr: {
    'Head.rx': [[0,0],[0.35,18,'eo'],[1.3,18],[1.9,0,'eio']],
    'Spine02.rx': [[0,0],[0.35,10,'eo'],[1.3,10],[1.9,0,'eio']],
    'Waist.rx': [[0,0],[0.35,6,'eo'],[1.3,6],[1.9,0,'eio']] }},
  cheer: { dur: 1.7, tr: {
    'Root.y': [[0,0],[0.16,0.05,'eo'],[0.42,0,'eio'],[0.6,0.03,'eo'],[0.85,0,'eio']],
    'L_Upperarm.rz': [[0,0],[0.18,190,'eo'],[0.9,190],[1.45,0,'eio']],
    'R_Upperarm.rz': [[0,0],[0.18,-190,'eo'],[0.9,-190],[1.45,0,'eio']],
    'L_Forearm.rz': [[0,0],[0.18,6,'eo'],[0.9,6],[1.45,0,'eio']],
    'R_Forearm.rz': [[0,0],[0.18,-6,'eo'],[0.9,-6],[1.45,0,'eio']],
    'Head.rz': [[0,0],[0.2,-5],[0.9,-5],[1.45,0]],
    'p.eyeSmile': [[0,0],[0.2,1],[1.05,1],[1.5,0]],
    'p.mouthOpen': [[0,0],[0.2,0.8],[1.05,0.8],[1.5,0]],
    'p.blush': [[0,0],[0.25,0.6],[1.1,0.6],[1.5,0]] }},
  shy: { dur: 3.2, expr: 'shy', tr: {
    'Head.rz': [[0,0],[0.4,8,'eo'],[2.4,8],[3.0,0,'eio']],
    'Head.rx': [[0,0],[0.4,5,'eo'],[2.4,5],[3.0,0,'eio']],
    'Head.ry': [[0,0],[0.4,8,'eo'],[2.4,8],[3.0,0,'eio']],
    'L_Upperarm.rz': [[0,0],[0.4,4],[2.4,4],[3.0,0]],
    'R_Upperarm.rz': [[0,0],[0.4,-4],[2.4,-4],[3.0,0]] }},
  think: { dur: 3.5, tr: {
    'Head.rz': [[0,0],[0.4,-8,'eo'],[2.8,-8],[3.3,0,'eio']],
    'Head.rx': [[0,0],[0.4,-6,'eo'],[2.8,-6],[3.3,0,'eio']],
    'R_Upperarm.rz': [[0,0],[0.5,-47,'eo'],[2.8,-47],[3.4,0,'eio']],
    'R_Forearm.rz': [[0,0],[0.5,-88,'eo'],[2.8,-88],[3.4,0,'eio']] }},
  point: { dur: 2.4, tr: {
    'R_Upperarm.rz': [[0,0],[0.3,-62,'eo'],[1.8,-62],[2.3,0,'eio']],
    'R_Forearm.rz': [[0,0],[0.3,-8,'eo'],[1.8,-8],[2.3,0,'eio']],
    'Head.ry': [[0,0],[0.3,10,'eo'],[1.8,10],[2.3,0,'eio']] }},
  surprised: { dur: 1.5, expr: 'surprised', tr: {
    'Root.y': [[0,0],[0.12,0.025,'eo'],[0.4,0,'eio']],
    'Head.rx': [[0,0],[0.15,-7,'eo'],[1.0,-7],[1.4,0,'eio']],
    'L_Upperarm.rz': [[0,0],[0.15,14,'eo'],[1.0,14],[1.4,0,'eio']],
    'R_Upperarm.rz': [[0,0],[0.15,-14,'eo'],[1.0,-14],[1.4,0,'eio']] }},
  stretch: { dur: 2.6, tr: {
    'L_Upperarm.rz': [[0,0],[0.4,190,'eo'],[1.6,190],[2.3,0,'eio']],
    'R_Upperarm.rz': [[0,0],[0.4,-190,'eo'],[1.6,-190],[2.3,0,'eio']],
    'Spine02.rx': [[0,0],[0.4,-5,'eo'],[1.6,-5],[2.3,0,'eio']],
    'Head.rx': [[0,0],[0.4,-8,'eo'],[1.6,-8],[2.3,0,'eio']] }},
  sleep: { dur: 9999, loop: true, tr: {
    'p.lid': [[0,0],[0.8,1,'eio'],[9999,1]],
    'Head.rx': [[0,0],[1.0,10,'eio'],[9999,10]],
    'Head.rz': [[0,0],[1.2,4,'eio'],[9999,4]],
    'p.breathSlow': [[0,0],[1,1],[9999,1]],
    'p.zzz': [[0,0],[1.2,1],[9999,1]],
    'L_Upperarm.rz': [[0,0],[1,4,'eio'],[9999,4]],
    'R_Upperarm.rz': [[0,0],[1,-4,'eio'],[9999,-4]] }},
  talk: { dur: 0.9, loop: true, tr: {
    'p.mouthOpen': [[0,0.1],[0.1,0.9],[0.2,0.25],[0.3,1],[0.42,0.15],[0.55,0.85],[0.68,0.2],[0.8,0.7],[0.9,0.1]],
    'Head.rx': [[0,0],[0.15,2],[0.3,0],[0.45,1.6],[0.6,0],[0.75,1.2],[0.9,0]],
    'Head.ry': [[0,0],[0.3,2],[0.6,-2],[0.9,0]] }}
};
var AMBIENT = ['think', 'stretch', 'shy'];

/* 表情参数集（300ms 渐变） */
var EXPRESSIONS = {
  normal:    {},
  happy:     { eyeSmile: 0.85, mouthSmile: 0.9, blush: 0.55, headRz: -4 },
  sad:       { browHint: 1, mouthSmile: -0.5, eyeOpen: 0.86, headRx: 5, blush: 0.1 },
  shy:       { blush: 1.0, headRy: 7, headRx: 4, eyeOpen: 0.82, mouthSmile: 0.35 },
  angry:     { browHint: -1, mouthSmile: -0.5, eyeOpen: 0.88, headRx: 2 },
  surprised: { mouthOpen: 0.9, eyeOpen: 1.12, headRx: -3 }
};
var EXPR_KEYS = ['eyeSmile', 'mouthSmile', 'blush', 'eyeOpen', 'headRx', 'headRy', 'headRz', 'mouthOpen', 'browHint'];

function boot(THREE, GLTFLoader, container) {
  /* ---------- 渲染基础 ---------- */
  var renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
  container.appendChild(renderer.domElement);
  var scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0xd8c9b2, 0.9));
  var key = new THREE.DirectionalLight(0xfff0d8, 0.85); key.position.set(1.8, 3.0, 1.6); scene.add(key);
  var fill = new THREE.DirectionalLight(0xfff2e2, 0.4); fill.position.set(-1.2, 1.0, 2.6); scene.add(fill);
  var rim = new THREE.DirectionalLight(0xffe9c8, 0.7); rim.position.set(0.4, 1.8, -2.2); scene.add(rim);
  var cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 播放/表情状态（boot 作用域，API 在模型就绪前即可安全调用） ---------- */
  var motions = [], sleeping = false;
  var exprCur = {}, exprFrom = {}, exprTo = {}, exprT = 1;
  EXPR_KEYS.forEach(function (k) { exprCur[k] = 0; exprFrom[k] = 0; exprTo[k] = 0; });
  exprCur.eyeOpen = 1; exprFrom.eyeOpen = 1; exprTo.eyeOpen = 1;
  function setExpr(name) {
    var e = EXPRESSIONS[name] || {};
    EXPR_KEYS.forEach(function (k) {
      exprFrom[k] = exprCur[k];
      exprTo[k] = (k === 'eyeOpen') ? (e[k] !== undefined ? e[k] : 1) : (e[k] || 0);
    });
    exprT = 0;
  }
  function play(name) {
    var def = MOTIONS[name]; if (!def) return;
    if (name !== 'sleep') sleeping = false;
    for (var i = 0; i < motions.length; i++)
      if (motions[i].name === name) { motions[i].t = 0; motions[i].out = false; motions[i].outT = undefined; return; }
    if (def.loop) motions.forEach(function (m) { if (MOTIONS[m.name].loop) m.out = true; });
    if (def.expr) setExpr(def.expr);
    motions.push({ name: name, def: def, t: 0, w: 0, out: false, outT: undefined });
  }
  function stop(name) { motions.forEach(function (m) { if (!name || m.name === name) m.out = true; }); }

  new GLTFLoader().load(MODEL_URL, function (gltf) { ready(gltf); }, undefined, function (e) {
    console.warn('[拾光] 安安 3D 模型加载失败', e);
  });

  function ready(gltf) {
    var model = gltf.scene;
    model.rotation.y = -Math.PI / 2;          // 模型面向 +X → 转正朝镜头
    scene.add(model);
    model.updateMatrixWorld(true);

    /* ---------- 相机适配（按包围盒） ---------- */
    var bb = new THREE.Box3().setFromObject(model);
    var size = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
    function layout() {
      var w = container.clientWidth || 148, h = container.clientHeight || 186;
      renderer.setSize(w, h, false);
      var asp = w / h;
      var vh = size.y * 1.06;
      cam.left = -vh * asp / 2; cam.right = vh * asp / 2;
      cam.top = vh / 2; cam.bottom = -vh / 2;
      cam.position.set(ctr.x, ctr.y, bb.max.z + 2);
      cam.lookAt(ctr.x, ctr.y, ctr.z);
      cam.updateProjectionMatrix();
    }
    layout(); window.addEventListener('resize', layout);

    /* ---------- 骨骼表 + bind 姿态 ---------- */
    var bones = {}, bindLocalQ = {}, bindWorldQ = {}, bindLocalP = {}, boneOrder = [];
    model.traverse(function (o) { if (o.isBone) bones[o.name] = o; });
    // 按层级排序（父先子后）
    (function walk(o) { if (o.isBone) boneOrder.push(o.name); o.children.forEach(walk); })(model);
    boneOrder.forEach(function (n) {
      bindLocalQ[n] = bones[n].quaternion.clone();
      bindLocalP[n] = bones[n].position.clone();
      bindWorldQ[n] = bones[n].getWorldQuaternion(new THREE.Quaternion());
    });
    var armWorldQ = new THREE.Quaternion();   // 模型根世界四元数
    model.getWorldQuaternion(armWorldQ);
    // 骨骼树根节点（Armature 对象）的世界四元数 —— FK 级联基座
    var armObjWorldQ = bones.Root && bones.Root.parent
      ? bones.Root.parent.getWorldQuaternion(new THREE.Quaternion())
      : armWorldQ.clone();

    /* ---------- 程序化贴花（眼睑/嘴/腮红，Head 骨为父） ---------- */
    var headBone = bones.Head;
    var headInv = new THREE.Matrix4();
    var headWQ = new THREE.Quaternion();
    headBone.updateWorldMatrix(true, false);
    headInv.copy(headBone.matrixWorld).invert();
    headBone.getWorldQuaternion(headWQ);
    var headWQInv = headWQ.clone().invert();
    function placeOnHead(modelLocalPos, w, h, tex) {
      var geo = new THREE.PlaneGeometry(w, h);
      var mat = new THREE.MeshBasicMaterial({ map: tex || null, transparent: true, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false });
      var m = new THREE.Mesh(geo, mat);
      m.renderOrder = 10;
      headBone.add(m);
      // 模型局部坐标 → 世界（经模型 −90°Y 旋转）→ 头部局部
      var wp = model.localToWorld(new THREE.Vector3().copy(modelLocalPos));
      var lp = wp.applyMatrix4(headInv);
      m.position.copy(lp);
      m.quaternion.copy(headWQInv);   // 面向镜头（世界 +Z）
      return m;
    }
    function canvasTex(draw, w, h) {
      var cv = document.createElement('canvas'); cv.width = w || 128; cv.height = h || 128;
      draw(cv.getContext('2d'), cv.width, cv.height);
      var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }
    // 眼睑：肤色圆角盖片（边缘羽化） + 下缘睫毛线；原点置顶边便于 scaleY 闭合
    function lidTexture() {
      return canvasTex(function (c, w, h) {
        c.clearRect(0, 0, w, h);
        var g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, 'rgba(236,220,205,0)');     // 顶缘全透明渐入
        g.addColorStop(0.25, 'rgba(236,220,205,1)');
        g.addColorStop(1, 'rgba(228,208,192,1)');
        c.fillStyle = g;
        c.beginPath();
        if (c.roundRect) c.roundRect(0, 0, w, h, w * 0.45); else c.rect(0, 0, w, h);
        c.fill();
        // 左右缘羽化
        var gx = c.createLinearGradient(0, 0, w, 0);
        gx.addColorStop(0, 'rgba(0,0,0,1)'); gx.addColorStop(0.18, 'rgba(0,0,0,0)');
        gx.addColorStop(0.82, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)');
        c.globalCompositeOperation = 'destination-out';
        c.fillStyle = gx; c.fillRect(0, 0, w, h);
        c.globalCompositeOperation = 'source-over';
        c.strokeStyle = '#5b4a3c'; c.lineWidth = w * 0.07; c.lineCap = 'round';
        c.beginPath(); c.moveTo(w * 0.1, h * 0.94);
        c.quadraticCurveTo(w * 0.5, h * 1.02, w * 0.9, h * 0.92); c.stroke();
      });
    }
    var lidTex = lidTexture();
    var lids = {};
    ['L', 'R'].forEach(function (s) {
      var p = new THREE.Vector3().fromArray(FACE['eye' + s]);
      var lid = placeOnHead(p, FACE.eyeW, FACE.eyeH, lidTex);
      lid.geometry.translate(0, -FACE.eyeH / 2, 0);   // 顶边为轴
      lid.scale.y = 0.02;
      lids[s] = lid;
    });
    // 嘴：三态（闭口微笑 / 半开 / 全开）运行时重绘
    var mouthState = { open: 0, smile: 0 };
    var mouthCanvas = document.createElement('canvas'); mouthCanvas.width = 128; mouthCanvas.height = 64;
    var mouthTex = new THREE.CanvasTexture(mouthCanvas); mouthTex.colorSpace = THREE.SRGBColorSpace;
    function drawMouth() {
      var c = mouthCanvas.getContext('2d'), w = 128, h = 64;
      c.clearRect(0, 0, w, h);
      var o = mouthState.open, sm = mouthState.smile;
      if (o > 0.06) {
        c.fillStyle = 'rgb(122,52,54)';
        c.beginPath(); c.ellipse(w / 2, h * 0.46, w * 0.30, h * (0.10 + 0.34 * o), 0, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#8c5049'; c.lineWidth = 3;
        c.beginPath(); c.moveTo(w * 0.18, h * 0.36 - sm * 8);
        c.quadraticCurveTo(w / 2, h * 0.24 - sm * 12, w * 0.82, h * 0.36 - sm * 8); c.stroke();
      } else if (Math.abs(sm) > 0.08) {
        c.strokeStyle = 'rgba(140,80,73,.9)'; c.lineWidth = 3.2; c.lineCap = 'round';
        c.beginPath(); c.moveTo(w * 0.24, h * 0.42 - sm * 10);
        c.quadraticCurveTo(w / 2, h * (0.42 + 0.30 * sm) - sm * 10, w * 0.76, h * 0.42 - sm * 10);
        c.stroke();
      }
      mouthTex.needsUpdate = true;
    }
    drawMouth();
    var mouth = placeOnHead(new THREE.Vector3().fromArray(FACE.mouth), FACE.mouthW, FACE.mouthH, mouthTex);
    // 腮红精灵
    var blushTex = canvasTex(function (c, w, h) {
      var g = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(244,148,148,.85)'); g.addColorStop(1, 'rgba(244,148,148,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    var blushes = ['blushL', 'blushR'].map(function (k) {
      var m = placeOnHead(new THREE.Vector3().fromArray(FACE[k]), 0.030, 0.016, blushTex);
      m.material.opacity = 0; return m;
    });
    // Zzz DOM
    var zzz = null;

    /* ---------- 肢体扭转骨跟随（蒙皮权重分摊在 Twist 骨上，主骨转它必须同步） ---------- */
    var FOLLOW = {
      L_Upperarm: ['L_UpperarmTwist01', 'L_UpperarmTwist02'],
      R_Upperarm: ['R_UpperarmTwist01', 'R_UpperarmTwist02'],
      L_Forearm: ['L_ForearmTwist01', 'L_ForearmTwist02'],
      R_Forearm: ['R_ForearmTwist01', 'R_ForearmTwist02'],
      L_Thigh: ['L_ThighTwist01', 'L_ThighTwist02'],
      R_Thigh: ['R_ThighTwist01', 'R_ThighTwist02'],
      L_Calf: ['L_CalfTwist01', 'L_CalfTwist02'],
      R_Calf: ['R_CalfTwist01', 'R_CalfTwist02']
    };

    /* ---------- 每帧 ---------- */
    var gaze = { x: 0, y: 0, cx: 0, cy: 0 };
    var P = {};
    var blinkT = 0, blinkPhase = 0, blinkNext = 2.2, lidV = 0;
    var mouthOpenV = 0, lastInteract = 0;
    var smileV = 0;
    var qTmp = new THREE.Quaternion(), qD = new THREE.Quaternion(), eul = new THREE.Euler();
    var clock = new THREE.Clock();
    var tickErrCount = 0;

    function tick() {
     try {
      var dt = Math.min(0.05, clock.getDelta());
      var now = clock.elapsedTime;
      for (var k in P) P[k] = 0;
      // 垂手静息姿态（bind 是 T-pose，每帧先落回垂手再叠加动作）
      P.L_Upperarm = { rz: -80 }; P.R_Upperarm = { rz: 80 };
      P.L_Forearm = { rz: -8 }; P.R_Forearm = { rz: 8 };
      // 表情渐变
      if (exprT < 1) {
        exprT = Math.min(1, exprT + dt / 0.3);
        var u = exprT * exprT * (3 - 2 * exprT);
        EXPR_KEYS.forEach(function (k2) { exprCur[k2] = exprFrom[k2] + (exprTo[k2] - exprFrom[k2]) * u; });
      }
      // 动作层
      for (var mi = motions.length - 1; mi >= 0; mi--) {
        var m = motions[mi]; m.t += dt;
        var dur = m.def.dur, wIn = Math.min(1, m.t / 0.18);
        if (m.out && m.outT === undefined) m.outT = m.t;
        var wOut = 1;
        if (m.out) wOut = Math.max(0, 1 - (m.t - m.outT) / 0.3);
        else if (!m.def.loop) wOut = Math.min(1, Math.max(0, (dur - m.t) / 0.3));
        m.w = wIn * wOut;
        if ((!m.def.loop && m.t >= dur) || (m.out && m.w <= 0)) { motions.splice(mi, 1); continue; }
        var lct = m.def.loop ? Math.min(m.t, 9999) : Math.min(m.t, dur);
        if (m.def.loop && dur < 100) lct = m.t % dur;
        for (var ch in m.def.tr) {
          var v = sample(m.def.tr[ch], lct) * m.w;
          if (ch.charAt(0) === 'p') P[ch.slice(2)] = (P[ch.slice(2)] || 0) + v;
          else {
            var dot = ch.indexOf('.'), bn = ch.slice(0, dot), cn = ch.slice(dot + 1);
            (P[bn] = P[bn] || {})[cn] = (P[bn] && P[bn][cn] || 0) + v;
          }
        }
      }
      // 呼吸 & 待机微动（胸腔 + 手臂随呼吸轻摆 + 重心缓慢转移，站姿活起来）
      var bSlow = 1 - 0.55 * Math.min(1, P.breathSlow || 0);
      var bt = now * 1.35 * Math.max(0.3, bSlow);
      var br = Math.sin(bt);
      P.Spine02 = P.Spine02 || {}; P.Spine02.rx = (P.Spine02.rx || 0) + br * 1.6;
      P.Head = P.Head || {};
      P.Head.rx = (P.Head.rx || 0) + Math.sin(bt + 0.5) * 1.8;
      P.Head.ry = (P.Head.ry || 0) + Math.sin(now * 0.31) * 2.2;
      P.Head.rz = (P.Head.rz || 0) + Math.sin(now * 0.23) * 1.0;
      P.L_Upperarm.rz += br * 1.8 + Math.sin(now * 0.37 + 1.1) * 2.6;
      P.R_Upperarm.rz -= br * 1.8 + Math.sin(now * 0.43 + 2.3) * 2.6;
      P.L_Forearm.rz -= Math.sin(now * 0.29) * 1.5;
      P.R_Forearm.rz += Math.sin(now * 0.33 + 0.7) * 1.5;
      P.Waist = P.Waist || {}; P.Waist.rz = (P.Waist.rz || 0) + Math.sin(now * 0.19) * 1.3;
      // 视线：指针 → 头/颈
      gaze.cx += (gaze.x - gaze.cx) * Math.min(1, dt * 5.5);
      gaze.cy += (gaze.y - gaze.cy) * Math.min(1, dt * 5.5);
      if (!reduced) {
        P.Head.ry += gaze.cx * 22; P.Head.rx += gaze.cy * 10; P.Head.rz += gaze.cx * 3;
        P.NeckTwist01 = P.NeckTwist01 || {};
        P.NeckTwist01.ry = (P.NeckTwist01.ry || 0) + gaze.cx * 10;
        P.Waist = P.Waist || {}; P.Waist.ry = (P.Waist.ry || 0) + gaze.cx * 4;
      }
      // 表情头姿
      P.Head.rx += exprCur.headRx || 0; P.Head.ry += exprCur.headRy || 0; P.Head.rz += exprCur.headRz || 0;

      // 扭转骨同步：主骨通道值全量带给 Twist 骨（否则视觉只转一半）
      for (var lead in FOLLOW) {
        var lc = P[lead];
        if (!lc) continue;
        FOLLOW[lead].forEach(function (tw) {
          if (!bones[tw]) return;
          var tc = P[tw] = P[tw] || {};
          tc.rx = (tc.rx || 0) + (lc.rx || 0);
          tc.ry = (tc.ry || 0) + (lc.ry || 0);
          tc.rz = (tc.rz || 0) + (lc.rz || 0);
        });
      }

      // 眨眼
      if (blinkPhase === 0) { blinkNext -= dt; if (blinkNext <= 0 && (P.lid || 0) < 0.5) { blinkPhase = 1; blinkT = 0; } }
      else if (blinkPhase === 1) { blinkT += dt; lidV = Math.min(1, blinkT / 0.09); if (blinkT >= 0.09) { blinkPhase = 2; blinkT = 0; } }
      else if (blinkPhase === 2) { blinkT += dt; lidV = 1; if (blinkT >= 0.05) { blinkPhase = 3; blinkT = 0; } }
      else { blinkT += dt; lidV = Math.max(0, 1 - blinkT / 0.16);
        if (blinkT >= 0.16) { blinkPhase = 0; lidV = 0; blinkNext = Math.random() < 0.12 ? 0.3 : 2.6 + Math.random() * 3.6; } }
      if ((P.lid || 0) > lidV) lidV = Math.min(1, P.lid);
      // 眼睑闭合量 = 眨眼 ∪ 笑眼 ∪ 表情眯眼（0=睁开藏起，1=闭合盖住）
      var eyeSmile = Math.min(1, (exprCur.eyeSmile || 0) + (P.eyeSmile || 0));
      var lidAmt = Math.max(lidV, eyeSmile * 0.85, 1 - exprCur.eyeOpen);
      lidAmt = Math.max(0.02, Math.min(1, lidAmt));
      lids.L.scale.y = lidAmt; lids.R.scale.y = lidAmt;
      // 嘴
      mouthOpenV += (Math.max(P.mouthOpen || 0, exprCur.mouthOpen || 0) - mouthOpenV) * Math.min(1, dt * 16);
      var sm = (exprCur.mouthSmile || 0);
      if (Math.abs(mouthState.open - mouthOpenV) > 0.02 || Math.abs(smileV - sm) > 0.03) {
        mouthState.open = mouthOpenV; smileV = sm; drawMouth();
      }
      // 腮红
      var bl = Math.min(1, (exprCur.blush || 0) + (P.blush || 0));
      blushes.forEach(function (b2) { b2.material.opacity = bl * 0.6; });
      // Zzz
      if ((P.zzz || 0) > 0.05) {
        if (!zzz) {
          zzz = document.createElement('div');
          zzz.style.cssText = 'position:absolute;left:62%;top:6%;font:700 22px Georgia,serif;color:rgba(126,146,196,.9);pointer-events:none;text-shadow:0 1px 2px rgba(255,255,255,.5);';
          zzz.textContent = 'Z';
          container.appendChild(zzz);
        }
        var ph = (now * 0.5) % 1;
        zzz.style.opacity = (Math.sin(ph * Math.PI) * 0.85).toFixed(2);
        zzz.style.transform = 'translate(' + (ph * 14) + 'px,' + (-ph * 26) + 'px) scale(' + (0.7 + ph * 0.6) + ')';
      } else if (zzz) { zzz.remove(); zzz = null; }

      // ── 骨骼：世界轴 Δ 共轭进各骨 bind 局部系，沿骨骼链自然级联（父动子随） ──
      var animWQ = { __base: armObjWorldQ };
      for (var bi = 0; bi < boneOrder.length; bi++) {
        var bn2 = boneOrder[bi], bone = bones[bn2];
        bone.position.copy(bindLocalP[bn2]);
        var parent = bone.parent;
        var pAnim = (parent && parent.isBone && animWQ[parent.name]) ? animWQ[parent.name] : armObjWorldQ;
        var chs = P[bn2];
        if (!chs) {
          bone.quaternion.copy(bindLocalQ[bn2]);
          animWQ[bn2] = pAnim.clone().multiply(bindLocalQ[bn2]);
          continue;
        }
        eul.set((chs.rx || 0) * DEG, (chs.ry || 0) * DEG, (chs.rz || 0) * DEG, 'XYZ');
        qD.setFromEuler(eul);                                  // 世界轴增量
        // Δ_local = B⁻¹ · Δ_world · B（共轭进 bind 局部系）
        qTmp.copy(bindWorldQ[bn2]).invert().multiply(qD).multiply(bindWorldQ[bn2]);
        bone.quaternion.copy(bindLocalQ[bn2]).multiply(qTmp);  // 局部 = bind ∘ Δ_local
        animWQ[bn2] = pAnim.clone().multiply(bone.quaternion); // 子骨继承父级联
      }
      // 根部位移（跳起等）
      if (P.Root && P.Root.y && bones.Root) bones.Root.position.y += P.Root.y;

      renderer.render(scene, cam);
      // 自主编排
      var idleFor = now - lastInteract;
      if (!sleeping && idleFor > 60) { sleeping = true; play('sleep'); }
      else if (!sleeping && motions.length === 0 && Math.random() < dt / 18) {
        play(AMBIENT[(Math.random() * AMBIENT.length) | 0]);
      }
     } catch (e) {
      if (++tickErrCount < 4) console.warn('[安安3D] 单帧异常已吞掉', e);
     }
    }
    renderer.setAnimationLoop(tick);

    /* ---------- 事件钩子 ---------- */
    document.addEventListener('pointermove', function (e) {
      gaze.x = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth - 0.5) * 2.4));
      gaze.y = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight - 0.5) * 2.4));
      lastInteract = clock.elapsedTime;
      if (sleeping) { sleeping = false; stop('sleep'); }
    }, { passive: true });
    document.addEventListener('pointerdown', function () {
      lastInteract = clock.elapsedTime;
      if (sleeping) { sleeping = false; stop('sleep'); }
    }, { passive: true });
    container.addEventListener('click', function () { play('greet'); });
    function watch(sel, cb) {
      var el = document.querySelector(sel);
      if (el) cb(el);
      else new MutationObserver(function () {
        var el2 = document.querySelector(sel);
        if (el2) { this.disconnect(); cb(el2); }
      }).observe(document.body, { childList: true, subtree: true });
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
        ml.forEach(function (r2) {
          if (!r2.addedNodes.length) return;
          var n = (r2.addedNodes[0].textContent || '').length;
          if (n > 1) { play('talk'); setTimeout(function () { stop('talk'); play('nod'); }, Math.min(900 + n * 45, 5200)); }
        });
      }).observe(log, { childList: true });
    });
    watch('#sg-bubble', function (bub) {
      new MutationObserver(function () {
        var n = (bub.textContent || '').length;
        if (n > 1 && !sleeping) { play('talk'); setTimeout(function () { stop('talk'); }, Math.min(700 + n * 40, 4200)); }
      }).observe(bub, { childList: true, characterData: true, subtree: true });
    });

    play('greet');
    console.log('[拾光] 安安 3D 数字人已上线（Tripo 绑骨 · 程序化表情动作）');
    _bones = bones; _P = P; _motions = motions;
    window.AnAn3D._parts = { lids: lids, mouth: mouth, blushes: blushes };
    modelReady = true;
  }

  var modelReady = false, _bones = null, _P = null, _motions = null;
  window.AnAn3D = {
    __v: 3,
    play: function (n) { if (modelReady) play(n); },
    setExpr: function (n) { if (modelReady) setExpr(n); },
    _dbg: function (bn) {
      if (!modelReady) return { ready: false };
      var b = _bones[bn];
      var out = { ready: true, has: !!b,
               q: b ? b.quaternion.toArray().map(function (v) { return +v.toFixed(3); }) : null,
               cheerR: _P.R_Upperarm || null, head: _P.Head || null,
               motions: _motions.map(function (m) { return m.name + '@' + m.t.toFixed(2); }) };
      if (b) {
        var THREE_V = b.getWorldPosition(new (b.position.constructor)());
        out.wpos = [+THREE_V.x.toFixed(4), +THREE_V.y.toFixed(4), +THREE_V.z.toFixed(4)];
        var kid = b.children.find(function (c) { return c.isBone; });
        if (kid) {
          var kv = kid.getWorldPosition(new (b.position.constructor)());
          out.child = kid.name;
          out.childWpos = [+kv.x.toFixed(4), +kv.y.toFixed(4), +kv.z.toFixed(4)];
          out.dir = [+(kv.x - THREE_V.x).toFixed(3), +(kv.y - THREE_V.y).toFixed(3), +(kv.z - THREE_V.z).toFixed(3)];
        }
      }
      return out;
    },
    motions: Object.keys(MOTIONS), exprs: Object.keys(EXPRESSIONS)
  };
}

/* ---------- 启动：复用站点 importmap 的 three/gltfloader ---------- */
function start() {
  var ball = document.getElementById('sg-ball') || document.getElementById('anan-3d-stage');
  if (!ball) return;
  Promise.all([import('three'), import('gltfloader')]).then(function (ms) {
    boot(ms[0], ms[1].GLTFLoader, ball);
  }).catch(function (e) { console.warn('[拾光] three 加载失败', e); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
})();
