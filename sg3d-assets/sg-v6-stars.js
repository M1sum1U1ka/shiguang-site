/* ═══ SG-V6 · 标准版 3D 星座空间（Three.js 天球星幕） ═══
   真实星座连线：猎户 / 大熊(北斗) / 仙后 / 天蝎 / 天琴 / 双子；
   恒星 shader 顶点相位随机闪烁；缓慢镜头漂移 + 鼠标视差。 */
import * as THREE from 'three';

(function () {
  'use strict';
  var inited = false, renderer, scene, camera, starPts, t0 = performance.now();
  var mx = 0, my = 0;

  /* 星座数据（相对坐标单位盒，映射到天球） */
  var CONSTELLATIONS = [
    { c: [0.9, 0.55], s: 0.24, pts: [[0,1],[0.9,0.95],[0.55,0.5],[0.45,0.45],[0.35,0.4],[0.35,0],[0.62,0.05]],
      edges: [[0,2],[1,3],[2,3],[3,4],[2,5],[3,6]] },                                                    /* 猎户 */
    { c: [0.12, 0.3], s: 0.2, pts: [[0,0],[0.25,0.12],[0.45,0.2],[0.6,0.3],[0.75,0.55],[0.78,0.8],[0.55,0.75]],
      edges: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,3]] },                                              /* 大熊·北斗 */
    { c: [0.45, 0.82], s: 0.16, pts: [[0,0.2],[0.25,0.55],[0.5,0.1],[0.75,0.6],[1,0.35]],
      edges: [[0,1],[1,2],[2,3],[3,4]] },                                                                /* 仙后 W */
    { c: [0.75, 0.15], s: 0.22, pts: [[0.1,0.9],[0.35,0.95],[0.55,0.85],[0.62,0.6],[0.6,0.4],[0.72,0.25],[0.85,0.12],[0.95,0.2]],
      edges: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7]] },                                              /* 天蝎 */
    { c: [0.3, 0.62], s: 0.13, pts: [[0,0.6],[0.2,0.8],[0.4,0.75],[0.35,0.45],[0.15,0.4]],
      edges: [[0,1],[1,2],[2,3],[3,4],[4,0]] },                                                          /* 天琴 */
    { c: [0.6, 0.4], s: 0.18, pts: [[0.1,0.9],[0.35,0.88],[0.12,0.5],[0.37,0.48],[0.05,0.1],[0.3,0.08]],
      edges: [[0,2],[1,3],[2,4],[3,5],[0,1]] }                                                           /* 双子 */
  ];

  function build() {
    if (inited) return; inited = true;
    var canvas = document.createElement('canvas');
    canvas.id = 'v6-stars'; canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
    camera.position.set(0, 0, 60);
    /* 背景星野（随机 + 相位闪烁） */
    var N = /Mobi|Android/i.test(navigator.userAgent) ? 700 : 1500;
    var pos = [], phase = [], freq = [], size = [], tint = [];
    function pushStar(x, y, z, s, warm) {
      pos.push(x, y, z);
      phase.push(Math.random() * 6.28); freq.push(0.4 + Math.random() * 1.8);
      size.push(s); tint.push(warm);
    }
    for (var i = 0; i < N; i++) {
      var th = Math.random() * 6.2832, ph = Math.acos(Math.random() * 2 - 1), r = 55 + Math.random() * 30;
      pushStar(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th) - 20,
        0.5 + Math.random() * 1.6, Math.random() < 0.25 ? 1 : 0);
    }
    var linePos = [];
    CONSTELLATIONS.forEach(function (con) {
      var cx = (con.c[0] - 0.5) * 90, cy = (0.5 - con.c[1]) * 55, cz = -14;
      var world = con.pts.map(function (p) { return [cx + (p[0] - 0.5) * con.s * 90, cy + (p[1] - 0.5) * con.s * 60, cz]; });
      world.forEach(function (p) { pushStar(p[0], p[1], p[2], 2.6, 1); });
      con.edges.forEach(function (e) { linePos.push.apply(linePos, world[e[0]]); linePos.push.apply(linePos, world[e[1]]); });
    });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
    g.setAttribute('aFreq', new THREE.Float32BufferAttribute(freq, 1));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 1));
    var mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 }, uPx: { value: Math.min(devicePixelRatio, 2) } },
      vertexShader: 'attribute float aPhase;attribute float aFreq;attribute float aSize;attribute float aTint;' +
        'uniform float uT;uniform float uPx;varying float vA;varying float vT;' +
        'void main(){float tw=0.55+0.45*sin(uT*aFreq+aPhase);vA=tw;vT=aTint;' +
        'vec4 mv=modelViewMatrix*vec4(position,1.0);' +
        'gl_PointSize=aSize*uPx*(0.7+0.5*tw)*3.2;' +
        'gl_Position=projectionMatrix*mv;}',
      fragmentShader: 'varying float vA;varying float vT;' +
        'void main(){vec2 c=gl_PointCoord-0.5;float d=length(c);float a=smoothstep(0.5,0.06,d)*vA;' +
        'vec3 col=mix(vec3(0.82,0.87,1.0),vec3(1.0,0.9,0.72),vT);' +
        'gl_FragColor=vec4(col*a,a);}'
    });
    starPts = new THREE.Points(g, mat); scene.add(starPts);
    /* 星座连线（淡金） */
    var lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
      color: 0xC9A96A, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })));
    addEventListener('pointermove', function (e) {
      mx = (e.clientX / innerWidth - 0.5); my = (e.clientY / innerHeight - 0.5);
    }, { passive: true });
    function resize() {
      renderer.setSize(innerWidth, innerHeight);
      camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    }
    resize(); addEventListener('resize', resize);
    function running() {
      return !document.body.classList.contains('youth-mode') &&
             !document.body.classList.contains('elder-mode') &&
             !document.body.classList.contains('elder-park') && !document.hidden;
    }
    (function frame(now) {
      requestAnimationFrame(frame);
      if (!running()) { canvas.classList.remove('on'); return; }
      canvas.classList.add('on');
      starPts.material.uniforms.uT.value = (now - t0) / 1000;
      /* 缓慢漂移 + 鼠标视差 */
      camera.position.x += ((mx * 6) - camera.position.x) * 0.02;
      camera.position.y += ((-my * 4) - camera.position.y) * 0.02;
      camera.lookAt(0, 0, -10);
      scene.rotation.y = now * 0.000008;
      renderer.render(scene, camera);
    })(t0);
  }
  function boot() {
    var t = 0;
    (function wait() {
      if (document.body) { build(); return; }
      if (++t < 60) setTimeout(wait, 300);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
