/* ═══ SG-V5 粒子引擎 · 标准版「生命奏章」招牌特效 ═══
   降级链：WebGPU(5万实例) → WebGL2(1.6万点) → Canvas2D(350光尘)
   无状态粒子（顶点着色器内计算位置，零 CPU 更新），
   形态由滚动章节驱动：0 散点序章 → 1 聚合五线谱 → 2 金色爆发
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MOBILE = Math.min(screen.width, screen.height) < 768 || /Mobi|Android/i.test(navigator.userAgent);
  var canvas = document.createElement('canvas');
  canvas.id = 'v5-particles';
  canvas.setAttribute('aria-hidden', 'true');

  var engine = 'none', raf = 0, running = false, started = false;
  var fpsBuf = [], degraded = false;
  window.__v5fps = { fps: 0, engine: 'init' };

  function isStd() {
    var sp = document.getElementById('sg-splash');
    var splashOn = sp && !sp.classList.contains('sg-splash-out') && getComputedStyle(sp).visibility !== 'hidden';
    var show = document.getElementById('sg-show');
    var showOn = show && getComputedStyle(show).display !== 'none' && !show.classList.contains('sg-show-out');
    return !splashOn && !showOn &&
           !document.body.classList.contains('youth-mode') &&
           !document.body.classList.contains('elder-mode') &&
           !document.body.classList.contains('elder-park');
  }
  function tip(msg) {
    var t = document.getElementById('v5-degrade-tip');
    if (!t) { t = document.createElement('div'); t.id = 'v5-degrade-tip'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 5000);
  }
  /* 滚动章节 → 目标形态（0 散点 / 1 五线谱 / 2 爆发） */
  var targetMode = 0, curMode = 0;
  function watchScroll() {
    var sec = document.querySelector('.view#view-home .section');
    var bel = document.querySelector('.view#view-home .belief');
    var tec = document.getElementById('tech-chips');
    function upd() {
      var y = scrollY + innerHeight * 0.5;
      if (tec && tec.getBoundingClientRect().top + scrollY < y) targetMode = 1.6;
      else if (bel && bel.getBoundingClientRect().top + scrollY < y) targetMode = 1.4;
      else if (sec && sec.getBoundingClientRect().top + scrollY < y) targetMode = 1;
      else targetMode = 0;
    }
    addEventListener('scroll', upd, { passive: true }); upd();
  }
  var mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener('pointermove', function (e) {
    mouse.tx = (e.clientX / innerWidth) * 2 - 1;
    mouse.ty = -((e.clientY / innerHeight) * 2 - 1);
  }, { passive: true });

  function fpsTick(dt) {
    fpsBuf.push(dt); if (fpsBuf.length > 50) fpsBuf.shift();
    var avg = fpsBuf.reduce(function (a, b) { return a + b; }, 0) / fpsBuf.length;
    window.__v5fps.fps = Math.round(1000 / avg); window.__v5fps.engine = engine;
    if (!degraded && fpsBuf.length >= 50 && avg > 22) {
      degraded = true;
      if (engine === 'webgpu' || engine === 'webgl2') { window.__v5Half = true; tip('已自动降低粒子密度以保持流畅'); }
    }
  }

  /* ── WebGPU 路径：实例化四边形点精灵，加色混合模拟辉光 ── */
  function tryWebGPU() {
    if (!navigator.gpu) return Promise.resolve(false);
    return navigator.gpu.requestAdapter().then(function (adapter) {
      if (!adapter) return false;
      return adapter.requestDevice().then(function (device) {
        var ctx = canvas.getContext('webgpu');
        if (!ctx) return false;
        var format = navigator.gpu.getPreferredCanvasFormat();
        ctx.configure({ device: device, format: format, alphaMode: 'premultiplied' });
        var N = MOBILE ? 10000 : 26000;
        var code = `
struct U{time:f32,mode:f32,mouse:vec2f,res:vec2f,aspect:f32,count:f32};
struct V{ @builtin(position) pos:vec4f, @location(0) uv:vec2f, @location(1) tint:f32 };
@group(0) @binding(0) var<uniform> u:U;
fn h(n:f32)->f32{return fract(sin(n*127.1)*43758.5453);}
fn basePos(i:f32,t:f32)->vec2f{
  var x=(h(i)-0.5)*2.0*u.aspect; var y=(h(i+17.0)-0.5)*2.0;
  x+=sin(t*0.05*h(i+3.0)+i)*0.06; y+=cos(t*0.04*h(i+7.0)+i*1.3)*0.05;
  return vec2f(x,y);}
fn staffPos(i:f32,t:f32)->vec2f{
  var line=floor(h(i+29.0)*5.0); var y=-0.55+line*0.28;
  var x=(h(i+31.0)-0.5)*2.0*u.aspect;
  y+=sin(x*2.4+t*0.6+h(i)*6.28)*0.028+(h(i+5.0)-0.5)*0.03;
  return vec2f(x,y);}
fn burstPos(i:f32,t:f32)->vec2f{
  var a=h(i+41.0)*6.2832; var sp=0.25+h(i+43.0)*0.75;
  var tt=fract(t*0.12*sp+h(i+47.0));
  var r=tt*1.5; return vec2f(cos(a)*r*u.aspect*0.6,sin(a)*r*0.8-0.1);}
@vertex fn vs(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32)->V{
  var o:V; var i=f32(ii); o.tint=h(i+13.0);
  if(i>=u.count){ o.pos=vec4f(2.0,2.0,0.0,1.0); o.uv=vec2f(0.0); return o; }
  var t=u.time;
  var p=basePos(i,t); var m0=clamp(u.mode,0.0,1.0); var m1=clamp(u.mode-1.0,0.0,1.0);
  p=mix(p,staffPos(i,t),m0); p=mix(p,burstPos(i,t),m1);
  var dm=p-u.mouse; var d=length(dm);
  if(d<0.4){ var ang=(1.0-d/0.4)*2.6; var s=sin(ang); var c=cos(ang);
    dm=vec2f(dm.x*c-dm.y*s,dm.x*s+dm.y*c); p=u.mouse+dm*(1.0+(0.4-d)*0.35); }
  var sz=mix(0.0016,0.0052,h(i+11.0)); sz*=1.0+m1*1.6;
  var corner=vec2f(f32(vi&1u)-0.5,f32(vi>>1u)-0.5)*2.0;
  o.uv=corner; o.pos=vec4f(p+corner*sz*vec2f(1.0,u.aspect),0.0,1.0);
  return o;}
@fragment fn fs(v:V)->@location(0) vec4f{
  var d=length(v.uv); var a=smoothstep(0.5,0.05,d);
  var gold=mix(vec3f(0.96,0.94,0.86),vec3f(0.85,0.70,0.45),v.tint);
  return vec4f(gold*a*0.85,a*0.85);}`;
        var mod = device.createShaderModule({ code: code });
        var pipe = device.createRenderPipeline({
          layout: 'auto',
          vertex: { module: mod, entryPoint: 'vs' },
          fragment: { module: mod, entryPoint: 'fs', targets: [{ format: format, blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } } }] },
          primitive: { topology: 'triangle-strip' }
        });
        var ubuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        var bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }] });
        engine = 'webgpu';
        var last = performance.now();
        function frame(now) {
          if (!running) return;
          var dt = now - last; last = now; fpsTick(dt);
          curMode += (targetMode - curMode) * 0.04;
          mouse.x += (mouse.tx - mouse.x) * 0.08; mouse.y += (mouse.ty - mouse.y) * 0.08;
          var dpr = Math.min(devicePixelRatio || 1, 2);
          var w = Math.floor(innerWidth * dpr), h = Math.floor(innerHeight * dpr);
          if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
          var count = (degraded ? N / 2 : N);
          device.queue.writeBuffer(ubuf, 0, new Float32Array([now / 1000, curMode, mouse.x, mouse.y, w, h, w / h, count]));
          var enc = device.createCommandEncoder();
          var pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(),
            loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' }] });
          pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.draw(4, N); pass.end();
          device.queue.submit([enc.finish()]);
          raf = requestAnimationFrame(frame);
        }
        window.__v5Half = false;
        return { start: function () { last = performance.now(); raf = requestAnimationFrame(frame); } };
      }).catch(function () { return false; });
    }).catch(function () { return false; });
  }

  /* ── WebGL2 路径：gl.POINTS，同逻辑 GLSL ── */
  function tryWebGL2() {
    var gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return false;
    var N = MOBILE ? 8000 : 16000;
    var vs = '#version 300 es\nprecision highp float;\nuniform float uT,uM,uC;uniform vec2 uMo,uR;\n' +
      'out vec2 vUv;out float vTint;\n' +
      'float h(float n){return fract(sin(n*127.1)*43758.5453);}\n' +
      'vec2 basePos(float i){float x=(h(i)-.5)*2.*(uR.x/uR.y);float y=(h(i+17.)-.5)*2.;' +
      'x+=sin(uT*.05*h(i+3.)+i)*.06;y+=cos(uT*.04*h(i+7.)+i*1.3)*.05;return vec2(x,y);}\n' +
      'vec2 staffPos(float i){float l=floor(h(i+29.)*5.);float y=-.55+l*.28;float x=(h(i+31.)-.5)*2.*(uR.x/uR.y);' +
      'y+=sin(x*2.4+uT*.6+h(i)*6.28)*.028+(h(i+5.)-.5)*.03;return vec2(x,y);}\n' +
      'vec2 burstPos(float i){float a=h(i+41.)*6.2832;float sp=.25+h(i+43.)*.75;' +
      'float t=fract(uT*.12*sp+h(i+47.));float r=t*1.5;return vec2(cos(a)*r*(uR.x/uR.y)*.6,sin(a)*r*.8-.1);}\n' +
      'void main(){float i=float(gl_VertexID);vTint=h(i+13.);\n' +
      'if(i>=uC){gl_Position=vec4(2.,2.,0.,1.);gl_PointSize=0.;return;}\n' +
      'vec2 p=basePos(i);float m0=clamp(uM,0.,1.);float m1=clamp(uM-1.,0.,1.);\n' +
      'p=mix(p,staffPos(i),m0);p=mix(p,burstPos(i),m1);\n' +
      'vec2 dm=p-uMo;float d=length(dm);\n' +
      'if(d<.4){float ang=(1.-d/.4)*2.6;float s=sin(ang);float c=cos(ang);' +
      'dm=vec2(dm.x*c-dm.y*s,dm.x*s+dm.y*c);p=uMo+dm*(1.+(0.4-d)*.35);}\n' +
      'gl_Position=vec4(p,0.,1.);\n' +
      'gl_PointSize=(1.5+h(i+11.)*3.5)*(1.+m1*1.6);\n' +
      'vUv=vec2(0.);}';
    var fs = '#version 300 es\nprecision highp float;in vec2 vUv;in float vTint;out vec4 o;\n' +
      'void main(){vec2 c=gl_PointCoord-.5;float d=length(c);float a=smoothstep(.5,.05,d);' +
      'vec3 gold=mix(vec3(.96,.94,.86),vec3(.85,.70,.45),vTint);o=vec4(gold*a*.85,a*.85);}';
    function sh(t, s) { var x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(x)); return null; } return x; }
    var v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return false;
    var pr = gl.createProgram(); gl.attachShader(pr, v); gl.attachShader(pr, f); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return false;
    gl.useProgram(pr);
    var uT = gl.getUniformLocation(pr, 'uT'), uM = gl.getUniformLocation(pr, 'uM'),
        uMo = gl.getUniformLocation(pr, 'uMo'), uR = gl.getUniformLocation(pr, 'uR'),
        uC = gl.getUniformLocation(pr, 'uC');
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    engine = 'webgl2';
    var last = performance.now();
    function frame(now) {
      if (!running) return;
      var dt = now - last; last = now; fpsTick(dt);
      curMode += (targetMode - curMode) * 0.04;
      mouse.x += (mouse.tx - mouse.x) * 0.08; mouse.y += (mouse.ty - mouse.y) * 0.08;
      var dpr = Math.min(devicePixelRatio || 1, 2);
      var w = Math.floor(innerWidth * dpr), h = Math.floor(innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uT, now / 1000); gl.uniform1f(uM, curMode);
      gl.uniform2f(uMo, mouse.x, mouse.y); gl.uniform2f(uR, w, h);
      gl.uniform1f(uC, degraded ? N / 2 : N);
      gl.drawArrays(gl.POINTS, 0, N);
      raf = requestAnimationFrame(frame);
    }
    return { start: function () { last = performance.now(); raf = requestAnimationFrame(frame); } };
  }

  /* ── Canvas 2D 兜底：流动光带 + 光尘 ── */
  function startCanvas2D() {
    var ctx = canvas.getContext('2d'); if (!ctx) return false;
    engine = 'canvas2d';
    var N = 350, ps = [];
    for (var i = 0; i < N; i++) ps.push({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 1.8, p: Math.random() * 6.28, l: Math.floor(Math.random() * 5) });
    var last = performance.now();
    function frame(now) {
      if (!running) return;
      var dt = now - last; last = now; fpsTick(dt);
      curMode += (targetMode - curMode) * 0.04;
      var dpr = Math.min(devicePixelRatio || 1, 2);
      var w = innerWidth, h = innerHeight;
      if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < N; i++) {
        var p = ps[i];
        p.p += 0.008;
        var tx, ty;
        if (curMode < 1) { tx = p.x * w + Math.sin(p.p) * 30; ty = p.y * h + Math.cos(p.p * 0.8) * 22; }
        else { tx = (0.06 + (i % 100) / 100 * 0.88) * w; ty = (0.24 + p.l * 0.13) * h + Math.sin(p.p + i) * 6; }
        var cx = p.cx === undefined ? tx : p.cx + (tx - p.cx) * 0.05;
        var cy = p.cy === undefined ? ty : p.cy + (ty - p.cy) * 0.05;
        p.cx = cx; p.cy = cy;
        var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, p.s * 3);
        g.addColorStop(0, 'rgba(232,206,150,.8)'); g.addColorStop(1, 'rgba(232,206,150,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, p.s * 3, 0, 6.2832); ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    }
    return { start: function () { last = performance.now(); raf = requestAnimationFrame(frame); } };
  }

  function boot() {
    if (started) return; started = true;
    document.body.appendChild(canvas);
    watchScroll();
    var runner = null;
    function setRunning(on) {
      if (on && !running && runner) { running = true; canvas.classList.add('on'); runner.start(); }
      else if (!on && running) { running = false; canvas.classList.remove('on'); cancelAnimationFrame(raf); }
    }
    function pick() {
      if (REDUCED) { engine = 'off(reduced-motion)'; window.__v5fps.engine = engine; return; }
      tryWebGPU().then(function (r) {
        if (r) { runner = r; setRunning(isStd()); return; }
        tip('当前设备不支持 WebGPU，已切换 WebGL2 粒子（密度 1/3）');
        var g = tryWebGL2();
        if (g) { runner = g; setRunning(isStd()); return; }
        tip('WebGPU/WebGL2 均不可用，已切换 Canvas 2D 简化光带');
        var c = startCanvas2D();
        if (c) { runner = c; setRunning(isStd()); }
      }).catch(function () {
        var g = tryWebGL2(); if (g) { runner = g; setRunning(isStd()); }
        else { var c = startCanvas2D(); if (c) { runner = c; setRunning(isStd()); } }
      });
    }
    pick();
    /* 模式切换时启停 */
    new MutationObserver(function () { if (runner) setRunning(isStd()); })
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && running) { running = false; cancelAnimationFrame(raf); }
      else if (!document.hidden && runner && isStd()) { running = true; runner.start(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
