/* 첫 화면(히어로) — 지게차 그림 + 소음·진동 컨투어
 * 오른쪽: 구동 모터 회전수(RPM)를 올리며 잰 것처럼 만든 「가상」 캠벨 선도(Campbell diagram).
 *         가로 = 주파수(Hz), 세로 = RPM — 이 도구의 Spectrum Map 과 같은 방향. 비스듬한 선이 오더(N × RPM ÷ 60).
 * 왼쪽:  전동 지게차(좌석 아래 배터리 · 앞 차축 옆 구동 모터) — 모터 · 기어박스의 가속도 센서 둘레 소음 등고선(가상).
 * 오더 · 공진 값은 제출자가 「임의로 지정해도 좋다」고 해서 정한 가상 값입니다(2026-09-30 답변).
 * 실제 시험값이 아니라 아래 식으로 만든 그림입니다. 분석 기능(js/script.js)과는 서로 건드리지 않습니다.
 * 순수 함수는 node 테스트에서 불러 씁니다(test/logic.test.mjs).
 */
(function (root) {
  'use strict';

  // 이 도구 Spectrum Map 과 같은 색 띠(js/script.js 의 amplitudeColor 와 같은 값)
  var STOPS = [[0, [27, 42, 149]], [0.18, [22, 107, 194]], [0.36, [16, 164, 160]], [0.55, [84, 197, 104]], [0.72, [216, 223, 57]], [0.86, [247, 165, 27]], [1, [214, 47, 39]]];

  var MODEL = {
    rpmMin: 800, rpmMax: 2800,
    fMin: 0, fMax: 250,
    // 오더(차수)와 기본 진폭 — 임의로 정한 가상 값(2차가 가장 크다고 둠)
    orders: [{ k: 1, a: 0.35 }, { k: 2, a: 1.0 }, { k: 4, a: 0.45 }, { k: 6, a: 0.22 }],
    // 구조 공진(마스트 · 프레임 · 캐빈 패널) — 오더가 이 주파수를 지날 때 커진다
    resonances: [{ f: 48, bw: 7, gain: 3.2 }, { f: 118, bw: 10, gain: 2.4 }, { f: 196, bw: 14, gain: 1.6 }],
    lineWidthHz: 3.2,
    floor: 0.012,
    dbFloor: -38, dbTop: 12, levels: 12,
  };

  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

  // N차 오더 주파수 = N × RPM ÷ 60 (도구의 계산식과 같음)
  function orderFrequency(k, rpm) { return k * rpm / 60; }

  // 공진 증폭 배율: 1 + Σ gain · exp(-((f - f0)/bw)²)
  function resonanceGain(f, model) {
    var m = model || MODEL, g = 1;
    for (var i = 0; i < m.resonances.length; i++) {
      var r = m.resonances[i], u = (f - r.f) / r.bw;
      g += r.gain * Math.exp(-u * u);
    }
    return g;
  }

  // 한 오더의 진폭(선형): 기본 진폭 × RPM 에 따라 조금 커짐 × 공진 배율
  function orderAmplitude(k, rpm, model) {
    var m = model || MODEL, o = null;
    for (var i = 0; i < m.orders.length; i++) if (m.orders[i].k === k) o = m.orders[i];
    if (!o) return 0;
    var span = (rpm - m.rpmMin) / (m.rpmMax - m.rpmMin);
    return o.a * (0.55 + 0.45 * span) * resonanceGain(orderFrequency(k, rpm), m);
  }

  // 가상 스펙트럼 진폭 A(RPM, f) — 오더 선 + 공진 띠 + 바닥 소음
  function spectrumAt(rpm, f, model) {
    var m = model || MODEL, span0 = (rpm - m.rpmMin) / (m.rpmMax - m.rpmMin);
    // 바닥 소음: RPM 이 오를수록, 낮은 주파수일수록 조금 크다(광대역)
    var sum = m.floor * (1 + 0.18 * Math.sin(f * 0.21) * Math.cos(rpm * 0.0031)) * (1 + 1.6 * span0) * (1 + 2.2 * Math.exp(-f / 55));
    for (var i = 0; i < m.orders.length; i++) {
      var k = m.orders[i].k, u = (f - orderFrequency(k, rpm)) / m.lineWidthHz;
      if (u > -6 && u < 6) sum += orderAmplitude(k, rpm, m) * Math.exp(-u * u);
    }
    // 공진 띠(수평으로 옅게) — RPM 이 높을수록 조금 진하게
    var span = (rpm - m.rpmMin) / (m.rpmMax - m.rpmMin);
    sum += m.floor * 2.2 * (resonanceGain(f, m) - 1) * (0.5 + 0.5 * span);
    return sum;
  }

  function toDb(a) { return 20 * Math.log10(Math.max(a, 1e-9)); }

  // dB → 0..1 (띠 수 levels 로 계단화하면 등고선 띠가 됨)
  function levelOf(db, model, stepped) {
    var m = model || MODEL, t = clamp01((db - m.dbFloor) / (m.dbTop - m.dbFloor));
    if (stepped) t = Math.min(m.levels - 1, Math.floor(t * m.levels)) / (m.levels - 1);
    return t;
  }

  function colorAt(t) {
    t = clamp01(t);
    for (var i = 1; i < STOPS.length; i++) if (t <= STOPS[i][0]) {
      var p0 = STOPS[i - 1][0], c0 = STOPS[i - 1][1], p1 = STOPS[i][0], c1 = STOPS[i][1], u = (t - p0) / (p1 - p0);
      return [Math.round(c0[0] + (c1[0] - c0[0]) * u), Math.round(c0[1] + (c1[1] - c0[1]) * u), Math.round(c0[2] + (c1[2] - c0[2]) * u)];
    }
    return STOPS[STOPS.length - 1][1].slice();
  }

  // 지금 RPM 에서 가장 큰 오더(읽음표에 씀)
  function dominantOrder(rpm, model) {
    var m = model || MODEL, best = null;
    for (var i = 0; i < m.orders.length; i++) {
      var k = m.orders[i].k, f = orderFrequency(k, rpm);
      if (f > m.fMax) continue;
      var a = orderAmplitude(k, rpm, m);
      if (!best || a > best.a) best = { k: k, f: f, a: a };
    }
    return best;
  }

  // 커서가 오가는 RPM: 0..1 위상 → 삼각파(올렸다 내렸다), 끝에서 부드럽게
  function sweepRpm(phase, model) {
    var m = model || MODEL, p = phase - Math.floor(phase);
    var tri = p < 0.5 ? p * 2 : 2 - p * 2;
    var s = 0.5 - 0.5 * Math.cos(Math.PI * tri);
    return m.rpmMin + (m.rpmMax - m.rpmMin) * (0.04 + 0.92 * s);
  }

  // 왼쪽 소음 등고선의 띠: 안쪽일수록 큰 소리(색 띠 위쪽), 바깥으로 갈수록 옅게
  function noiseRings(size, count) {
    var n = count || 8, out = [];
    for (var i = 0; i < n; i++) {
      var t = 0.95 - i * (0.9 / (n - 1));
      out.push({ r: size * 0.085 * Math.pow(1.33, i), t: t, fill: +(0.2 + 0.25 * (1 - i / n)).toFixed(3), stroke: +(0.85 - 0.6 * i / n).toFixed(3) });
    }
    return out;
  }

  function fmtInt(n) { return Math.round(n).toLocaleString('ko-KR'); }

  var api = { MODEL: MODEL, STOPS: STOPS, orderFrequency: orderFrequency, resonanceGain: resonanceGain, orderAmplitude: orderAmplitude, spectrumAt: spectrumAt, toDb: toDb, levelOf: levelOf, colorAt: colorAt, dominantOrder: dominantOrder, sweepRpm: sweepRpm, noiseRings: noiseRings };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HeroContour = api;

  if (typeof document === 'undefined') return;

  // ───────────── 화면 ─────────────
  function start() {
    var wrap = document.getElementById('heroVisual');
    var canvas = document.getElementById('heroCanvas');
    if (!wrap || !canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var forklift = document.getElementById('heroForklift');
    var body = document.getElementById('heroForkliftBody');
    var sensor = document.getElementById('heroSensor');
    var ripples = document.querySelectorAll('#heroForklift .hero-ripple');
    var readout = document.getElementById('heroReadout');
    var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

    var base = document.createElement('canvas');
    var geo = null, W = 0, H = 0, dpr = 1;
    var visible = true, raf = 0, last = 0, phase = 0.18, lastDraw = 0;

    // 오른쪽 그래프 영역(캔버스 CSS 픽셀)
    function layout() {
      var r = wrap.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      var narrow = W < 520;
      var left = Math.round(W * (narrow ? 0.40 : 0.42));
      var right = W - (narrow ? 40 : 52);
      var top = narrow ? 10 : 14, bottom = H - (narrow ? 30 : 36);
      geo = { left: left, right: right, top: top, bottom: bottom, narrow: narrow };
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      base.width = W * dpr; base.height = H * dpr;
      renderBase();
    }

    function xOfF(f) { return geo.left + (f - MODEL.fMin) / (MODEL.fMax - MODEL.fMin) * (geo.right - geo.left); }
    function yOfRpm(r) { return geo.bottom - (r - MODEL.rpmMin) / (MODEL.rpmMax - MODEL.rpmMin) * (geo.bottom - geo.top); }

    // 센서 위치(캔버스 좌표) — SVG 의 센서 점에서 읽는다
    function sensorPoint() {
      if (!sensor) return { x: W * 0.3, y: H * 0.62 };
      var a = sensor.getBoundingClientRect(), c = canvas.getBoundingClientRect();
      return { x: a.left + a.width / 2 - c.left, y: a.top + a.height / 2 - c.top };
    }

    function renderBase() {
      var b = base.getContext('2d');
      var pw = Math.round((geo.right - geo.left) * dpr), ph = Math.round((geo.bottom - geo.top) * dpr);
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.clearRect(0, 0, base.width, base.height);

      // ① 왼쪽: 구동 모터 · 기어박스 둘레 소음 등고선(가상) — 센서에서 멀어질수록 한 띠씩 작아지는 음압(바깥 띠부터 겹쳐 그림)
      var sp = sensorPoint();
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      b.save();
      b.beginPath(); b.rect(0, 0, geo.left - 2, H); b.clip();
      var rings = noiseRings(Math.min(W, H * 1.9));
      for (var ri = rings.length - 1; ri >= 0; ri--) {
        var g = rings[ri], c = colorAt(g.t);
        b.beginPath();
        for (var s2 = 0; s2 <= 96; s2++) {
          var th = s2 / 96 * Math.PI * 2, rr = g.r * (1 + 0.07 * Math.sin(3 * th + ri * 0.9) + 0.04 * Math.cos(5 * th - ri * 0.7));
          var px = sp.x + Math.cos(th) * rr * 1.3, py = sp.y + Math.sin(th) * rr * 0.82;
          if (s2) b.lineTo(px, py); else b.moveTo(px, py);
        }
        b.closePath();
        b.fillStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + g.fill + ')'; b.fill();
        b.lineWidth = 1; b.strokeStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + g.stroke + ')'; b.stroke();
      }
      b.restore();
      b.setTransform(1, 0, 0, 1, 0, 0);

      // ② 오른쪽: 캠벨 선도(가상)
      var img2 = b.createImageData(pw, ph), d2 = img2.data;
      for (var yy = 0; yy < ph; yy++) {
        var rpm = MODEL.rpmMax - (yy / (ph - 1)) * (MODEL.rpmMax - MODEL.rpmMin);
        for (var xx = 0; xx < pw; xx++) {
          var f = MODEL.fMin + (xx / (pw - 1)) * (MODEL.fMax - MODEL.fMin);
          var tt = levelOf(toDb(spectrumAt(rpm, f)), MODEL, true);
          var cc = colorAt(tt), k = (yy * pw + xx) * 4;
          d2[k] = cc[0]; d2[k + 1] = cc[1]; d2[k + 2] = cc[2]; d2[k + 3] = 255;
        }
      }
      outline(d2, pw, ph, 0.22);
      b.putImageData(img2, Math.round(geo.left * dpr), Math.round(geo.top * dpr));

      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 오더 선(점선) + 이름표
      b.save();
      b.beginPath(); b.rect(geo.left, geo.top, geo.right - geo.left, geo.bottom - geo.top); b.clip();
      b.setLineDash([5, 4]); b.lineWidth = 1.1; b.strokeStyle = 'rgba(255,255,255,.72)';
      MODEL.orders.forEach(function (o) {
        b.beginPath(); b.moveTo(xOfF(orderFrequency(o.k, MODEL.rpmMin)), yOfRpm(MODEL.rpmMin));
        b.lineTo(xOfF(orderFrequency(o.k, MODEL.rpmMax)), yOfRpm(MODEL.rpmMax)); b.stroke();
      });
      b.restore();
      b.font = '600 ' + (geo.narrow ? 10 : 11) + 'px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
      b.textBaseline = 'middle';
      MODEL.orders.forEach(function (o) {
        // 선이 위쪽 테두리 또는 오른쪽 테두리를 나가는 곳에 이름표
        var fTop = orderFrequency(o.k, MODEL.rpmMax), x, y;
        if (fTop <= MODEL.fMax) { x = xOfF(fTop); y = geo.top + 9; }
        else { var rAt = MODEL.fMax * 60 / o.k; x = geo.right - 4; y = yOfRpm(rAt) + 10; }
        var label = o.k + '차';
        var tw = b.measureText(label).width + 8;
        var bx = Math.min(geo.right - tw - 2, Math.max(geo.left + 2, x - tw / 2));
        b.fillStyle = 'rgba(8,20,36,.82)'; roundRect(b, bx, y - 8, tw, 16, 4); b.fill();
        b.fillStyle = '#ffffff'; b.textAlign = 'left'; b.fillText(label, bx + 4, y + 0.5);
      });

      // 테두리 · 눈금
      b.strokeStyle = 'rgba(217,234,246,.55)'; b.lineWidth = 1; b.setLineDash([]);
      b.strokeRect(geo.left + 0.5, geo.top + 0.5, geo.right - geo.left - 1, geo.bottom - geo.top - 1);
      b.fillStyle = '#d9eaf6';
      b.font = (geo.narrow ? 10 : 11) + 'px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
      b.textAlign = 'center'; b.textBaseline = 'top';
      var fStep = geo.narrow ? 100 : 50;
      for (var fv = 0; fv <= MODEL.fMax; fv += fStep) {
        var tx = xOfF(fv);
        b.fillRect(Math.round(tx), geo.bottom, 1, 4);
        b.fillText(String(fv), Math.min(geo.right - 8, Math.max(geo.left + 6, tx)), geo.bottom + 6);
      }
      b.textAlign = 'left'; b.textBaseline = 'middle';
      for (var rv = 1000; rv <= MODEL.rpmMax; rv += (geo.narrow ? 1000 : 500)) {
        var ty = yOfRpm(rv);
        b.fillRect(geo.right, Math.round(ty), 4, 1);
        b.fillText(fmtInt(rv), geo.right + 6, ty);
      }
      // 축 이름
      b.font = '700 ' + (geo.narrow ? 10 : 11) + 'px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
      b.textAlign = 'right'; b.textBaseline = 'bottom';
      b.fillText('Frequency (Hz)', geo.right, H - 1);
      b.save(); b.translate(W - 3, geo.top); b.rotate(Math.PI / 2); b.textAlign = 'left'; b.textBaseline = 'bottom';
      b.fillText('RPM', 0, 0); b.restore();
    }

    // 계단 색 띠의 경계 픽셀을 어둡게 → 등고선
    function outline(d, w, h, strength) {
      for (var y = 0; y < h - 1; y++) {
        for (var x = 0; x < w - 1; x++) {
          var i = (y * w + x) * 4, r = i + 4, dn = i + w * 4;
          if (d[i] !== d[r] || d[i + 1] !== d[r + 1] || d[i] !== d[dn] || d[i + 1] !== d[dn + 1]) {
            d[i] = d[i] * (1 - strength) | 0; d[i + 1] = d[i + 1] * (1 - strength) | 0; d[i + 2] = d[i + 2] * (1 - strength) | 0;
          }
        }
      }
    }

    function roundRect(c, x, y, w, h, r) {
      c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
      c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
      c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
    }

    function drawFrame(rpm) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var y = yOfRpm(rpm);
      // RPM 커서
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(geo.left, y); ctx.lineTo(geo.right, y); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(geo.right, y); ctx.lineTo(geo.right + 6, y - 4); ctx.lineTo(geo.right + 6, y + 4); ctx.closePath(); ctx.fill();
      // 오더 선과 만나는 점
      MODEL.orders.forEach(function (o) {
        var f = orderFrequency(o.k, rpm);
        if (f > MODEL.fMax) return;
        var a = orderAmplitude(o.k, rpm), rr = 2.5 + Math.min(4.5, a * 1.3);
        ctx.beginPath(); ctx.arc(xOfF(f), y, rr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fill();
        ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(8,20,36,.9)'; ctx.stroke();
      });
      var dom = dominantOrder(rpm);
      if (readout && dom) readout.textContent = 'RPM ' + fmtInt(rpm) + ' · 가장 큰 성분 ' + dom.k + '차 ' + dom.f.toFixed(1) + ' Hz';
      // 지게차 떨림 · 센서 물결 — 지금 RPM 의 가장 큰 오더 진폭에 비례
      var amp = dom ? Math.min(1, dom.a / 3.2) : 0;
      if (body && !reduce.matches) {
        var t = performance.now() / 1000, j = amp * 0.9;
        body.setAttribute('transform', 'translate(' + (Math.sin(t * 61) * j).toFixed(2) + ' ' + (Math.cos(t * 47) * j * 0.8).toFixed(2) + ')');
      }
      for (var i = 0; i < ripples.length; i++) {
        var p = reduce.matches ? (i + 1) / (ripples.length + 1) : ((performance.now() / 1400) + i / ripples.length) % 1;
        ripples[i].setAttribute('r', (5 + p * (14 + amp * 16)).toFixed(1));
        ripples[i].setAttribute('opacity', ((1 - p) * (0.35 + 0.6 * amp)).toFixed(2));
      }
    }

    function loop(now) {
      raf = 0;
      if (!visible || document.hidden || reduce.matches) return;
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
      phase += dt / 14; // 14초에 한 번 올렸다 내림
      if (now - lastDraw > 32) { drawFrame(sweepRpm(phase)); lastDraw = now; }
      raf = requestAnimationFrame(loop);
    }
    function kick() { if (!raf && visible && !document.hidden && !reduce.matches) { last = 0; raf = requestAnimationFrame(loop); } }
    function drawStill() { drawFrame(reduce.matches ? 2350 : sweepRpm(phase)); }

    var resizeTimer = 0;
    function onResize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { layout(); drawStill(); }, 120); }

    layout(); drawStill();
    if (window.ResizeObserver) new ResizeObserver(onResize).observe(wrap); else window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', function () { if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; } else kick(); });
    if (window.IntersectionObserver) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) kick(); }, { threshold: 0.05 }).observe(wrap);
    var onMotion = function () { if (reduce.matches) { if (raf) cancelAnimationFrame(raf); raf = 0; if (body) body.removeAttribute('transform'); drawStill(); } else kick(); };
    if (reduce.addEventListener) reduce.addEventListener('change', onMotion); else if (reduce.addListener) reduce.addListener(onMotion);
    kick();

    // 버튼: 히어로의 「CSV 파일 선택」은 도구의 파일 선택과 같은 입력을 연다
    var pick = document.getElementById('heroPickCsv');
    if (pick) pick.addEventListener('click', function () {
      var up = document.getElementById('csvUploadSection');
      if (up && up.classList.contains('collapsed')) { var tg = document.getElementById('csvUploadToggle'); if (tg) tg.click(); }
      var fi = document.getElementById('fileInput'); if (fi) fi.click();
    });
    if (forklift) forklift.setAttribute('data-ready', '1');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
