/* ============================================================
   hack//ops - "the desktop" engine
   One endless retro desktop. There is no document scroll: a
   fixed stage hosts a grid canvas plus a transformed world
   layer of DOM windows. The camera flies between stops; the
   header chips and scroll-to-fly drive the tour.
   Camera model: screen = center + R(rot) * s * (p - cam)
   ============================================================ */
(function () {
  'use strict';

  const world = document.getElementById('world');
  const gridCv = document.getElementById('grid');
  const gtx = gridCv.getContext('2d');
  const hud = document.getElementById('hud');
  const hint = document.getElementById('hint');
  const nav = document.getElementById('stops-nav');
  const stage = document.getElementById('stage');

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;

  /* ---------------- placed items ---------------- */
  const items = [...document.querySelectorAll('[data-x]')];
  items.forEach(el => {
    const x = +el.dataset.x, y = +el.dataset.y;
    const rot = +(el.dataset.rot || 0);
    const sc = +(el.dataset.scale || 1);
    el.style.position = 'absolute';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.transform =
      `translate(-50%,-50%) rotate(${rot}deg) scale(${sc})`;
  });

  /* ---------------- stops / tour ---------------- */
  const stops = [...document.querySelectorAll('[data-stop]')].map(el => ({
    el,
    id: el.dataset.stop,
    label: el.dataset.label || el.dataset.stop,
    x: +el.dataset.x,
    y: +el.dataset.y,
    vw: +(el.dataset.vw || 800),
    vh: +(el.dataset.vh || 600),
    bearing: (+(el.dataset.bearing || 0)) * Math.PI / 180,
    s: 1
  }));

  function landScale(st) {
    // a hidden or collapsed viewport reports 0x0; a zero scale would
    // poison the log-space damping with NaN forever, so clamp hard
    const s = Math.min(innerWidth / st.vw, innerHeight / st.vh) * 0.85;
    return (isFinite(s) && s > 0) ? s : 0.5;
  }
  function computeScales() { stops.forEach(st => { st.s = landScale(st); }); }

  /* ---------------- camera ---------------- */
  const cam = { x: 0, y: 0, s: 0.1, r: 0 };
  let u = 0;                 // tour position: stop k lives at u = k
  let targetU = 0;
  let tourMode = true;       // false after free pan/zoom until re-engaged
  let booted = false;

  function pathAt(uu) {
    uu = Math.max(0, Math.min(stops.length - 1, uu));
    const i = Math.min(Math.floor(uu), stops.length - 2);
    const A = stops[i], B = stops[Math.min(i + 1, stops.length - 1)];
    let t = uu - i;
    t = t * t * (3 - 2 * t); // ease within the leg
    const dist = Math.hypot(B.x - A.x, B.y - A.y);
    const la = Math.log(A.s), lb = Math.log(B.s);
    // long hops pull the camera out mid-flight, short hops do not
    const lm = Math.min(la, lb) - Math.log(1 + dist / 2600);
    const omt = 1 - t;
    const ls = omt * omt * la + 2 * omt * t * lm + t * t * lb;
    // shortest-angle bearing lerp
    let dr = B.bearing - A.bearing;
    while (dr > Math.PI) dr -= 2 * Math.PI;
    while (dr < -Math.PI) dr += 2 * Math.PI;
    return {
      x: A.x + (B.x - A.x) * t,
      y: A.y + (B.y - A.y) * t,
      s: Math.exp(ls),
      r: A.bearing + dr * t
    };
  }

  /* ---------------- render ---------------- */
  function applyCam() {
    world.style.transform =
      `rotate(${cam.r}rad) scale(${cam.s}) translate(${-cam.x}px,${-cam.y}px)`;
  }

  function drawGrid() {
    const dpr = devicePixelRatio || 1;
    const w = innerWidth, h = innerHeight;
    if (gridCv.width !== w * dpr || gridCv.height !== h * dpr) {
      gridCv.width = w * dpr; gridCv.height = h * dpr;
      gridCv.style.width = w + 'px'; gridCv.style.height = h + 'px';
    }
    gtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gtx.clearRect(0, 0, w, h);

    const cx = w / 2, cy = h / 2;
    const cos = Math.cos(cam.r), sin = Math.sin(cam.r);
    // world -> screen
    gtx.setTransform(
      dpr * cam.s * cos, dpr * cam.s * sin,
      -dpr * cam.s * sin, dpr * cam.s * cos,
      dpr * (cx - cam.s * (cos * cam.x - sin * cam.y)),
      dpr * (cy - cam.s * (sin * cam.x + cos * cam.y))
    );

    // visible world bbox from the four screen corners
    const inv = (px, py) => {
      const dx = px - cx, dy = py - cy;
      return [
        cam.x + (dx * cos + dy * sin) / cam.s,
        cam.y + (-dx * sin + dy * cos) / cam.s
      ];
    };
    const c1 = inv(0, 0), c2 = inv(w, 0), c3 = inv(0, h), c4 = inv(w, h);
    const x0 = Math.min(c1[0], c2[0], c3[0], c4[0]);
    const x1 = Math.max(c1[0], c2[0], c3[0], c4[0]);
    const y0 = Math.min(c1[1], c2[1], c3[1], c4[1]);
    const y1 = Math.max(c1[1], c2[1], c3[1], c4[1]);

    // pick a grid step that stays readable at any magnification
    let step = 64;
    while (step * cam.s < 26) step *= 2;
    while (step * cam.s > 120) step /= 2;

    const minor = getComputedStyle(document.body).getPropertyValue('--grid').trim() || '#ffe2f0';
    const major = getComputedStyle(document.body).getPropertyValue('--grid-2').trim() || '#ffcfe6';

    gtx.lineWidth = 1 / cam.s;
    for (let pass = 0; pass < 2; pass++) {
      const st = pass ? step * 8 : step;
      gtx.strokeStyle = pass ? major : minor;
      gtx.beginPath();
      for (let gx = Math.floor(x0 / st) * st; gx <= x1; gx += st) {
        gtx.moveTo(gx, y0); gtx.lineTo(gx, y1);
      }
      for (let gy = Math.floor(y0 / st) * st; gy <= y1; gy += st) {
        gtx.moveTo(x0, gy); gtx.lineTo(x1, gy);
      }
      gtx.stroke();
    }
    gtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------- HUD / nav ---------------- */
  function updateHud() {
    const pad = n => String(Math.round(Math.abs(n))).padStart(5, '0');
    hud.textContent =
      `X ${pad(cam.x)} · Y ${pad(cam.y)} · FIELD ${pad(innerWidth / cam.s)}`;
  }

  let chips = [];
  function buildNav() {
    nav.innerHTML = '';
    chips = stops.map((st, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = st.label;
      b.addEventListener('click', () => flyTo(i));
      nav.appendChild(b);
      return b;
    });
  }
  function updateNav() {
    const k = Math.round(Math.max(0, Math.min(stops.length - 1, u)));
    chips.forEach((c, i) => c.classList.toggle('on', tourMode && i === k));
  }

  /* ---------------- flight ---------------- */
  function flyTo(i) {
    dismissHint();
    tourMode = true;
    targetU = i;
    if (reduceMotion) { u = i; const p = pathAt(u); Object.assign(cam, p); }
  }
  window.hackops = { flyTo: id => {
    const i = stops.findIndex(s => s.id === id);
    if (i >= 0) flyTo(i);
  }};

  function nextStop(dir) {
    const k = Math.round(Math.max(0, Math.min(stops.length - 1, targetU)));
    flyTo(Math.max(0, Math.min(stops.length - 1, k + dir)));
  }

  /* ---------------- input ---------------- */
  let hintGone = false;
  function dismissHint() {
    if (!hintGone) { hintGone = true; hint.classList.add('gone'); }
  }

  // wheel: tour progress; ctrl+wheel (pinch on trackpads): zoom at cursor
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    dismissHint();
    if (e.ctrlKey) {
      freeZoom(Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
      return;
    }
    tourMode = true;
    targetU = Math.max(0, Math.min(stops.length - 1,
      targetU + e.deltaY * 0.0011));
  }, { passive: false });

  function freeZoom(f, px, py) {
    tourMode = false;
    const cx = innerWidth / 2, cy = innerHeight / 2;
    const cos = Math.cos(cam.r), sin = Math.sin(cam.r);
    const dx = px - cx, dy = py - cy;
    const wx = cam.x + (dx * cos + dy * sin) / cam.s;
    const wy = cam.y + (-dx * sin + dy * cos) / cam.s;
    const ns = Math.max(0.01, Math.min(160, cam.s * f));
    cam.x = wx - (dx * cos + dy * sin) / ns;
    cam.y = wy - (-dx * sin + dy * cos) / ns;
    cam.s = ns;
  }

  // drag pan / touch swipe
  let pDown = null, moved = false;
  const pts = new Map();
  let pinch0 = 0, pinchS0 = 1;

  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('[data-interactive]')) return;
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]);
      pinchS0 = cam.s;
    }
    pDown = { x: e.clientX, y: e.clientY, t: performance.now() };
    moved = false;
  });
  stage.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch0 > 0) {
        tourMode = false;
        cam.s = Math.max(0.01, Math.min(160, pinchS0 * d / pinch0));
      }
      moved = true;
      return;
    }
    const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
    if (Math.abs(e.clientX - pDown.x) + Math.abs(e.clientY - pDown.y) > 6) moved = true;
    if (moved) {
      dismissHint();
      tourMode = false;
      const cos = Math.cos(cam.r), sin = Math.sin(cam.r);
      cam.x -= (dx * cos + dy * sin) / cam.s;
      cam.y -= (-dx * sin + dy * cos) / cam.s;
    }
  });
  stage.addEventListener('pointerup', e => {
    pts.delete(e.pointerId);
    if (!pDown) return;
    const dt = performance.now() - pDown.t;
    const dx = e.clientX - pDown.x, dy = e.clientY - pDown.y;
    // quick vertical swipe on touch: advance the tour
    if (coarse && dt < 500 && Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx)) {
      nextStop(dy < 0 ? 1 : -1);
    }
    pDown = null;
  });
  stage.addEventListener('pointercancel', e => pts.delete(e.pointerId));

  // double click zooms in, shift+double click zooms out
  stage.addEventListener('dblclick', e => {
    if (e.target.closest('[data-interactive]')) return;
    freeZoom(e.shiftKey ? 0.5 : 2, e.clientX, e.clientY);
  });

  addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    const panPx = 90;
    const pan = (dx, dy) => {
      tourMode = false; dismissHint();
      const cos = Math.cos(cam.r), sin = Math.sin(cam.r);
      cam.x += (dx * cos + dy * sin) / cam.s;
      cam.y += (-dx * sin + dy * cos) / cam.s;
    };
    switch (e.key) {
      case ' ': case 'PageDown': e.preventDefault(); nextStop(1); break;
      case 'PageUp': e.preventDefault(); nextStop(-1); break;
      case 'Home': e.preventDefault(); flyTo(0); break;
      case 'End': e.preventDefault(); flyTo(stops.length - 1); break;
      case 'ArrowLeft': pan(-panPx, 0); break;
      case 'ArrowRight': pan(panPx, 0); break;
      case 'ArrowUp': pan(0, -panPx); break;
      case 'ArrowDown': pan(0, panPx); break;
      case '+': case '=': freeZoom(1.4, innerWidth / 2, innerHeight / 2); break;
      case '-': freeZoom(1 / 1.4, innerWidth / 2, innerHeight / 2); break;
    }
  });

  // camera rail controls
  const zin = document.getElementById('zin');
  const zout = document.getElementById('zout');
  const lvl = document.getElementById('lvl');
  if (zin) zin.addEventListener('click', () => freeZoom(1.6, innerWidth / 2, innerHeight / 2));
  if (zout) zout.addEventListener('click', () => freeZoom(1 / 1.6, innerWidth / 2, innerHeight / 2));
  if (lvl) lvl.addEventListener('click', () => { cam.r = 0; });

  const nextbtn = document.getElementById('nextbtn');
  if (nextbtn) nextbtn.addEventListener('click', () => nextStop(1));

  // dark mode: html.dark switches the palette, the grid canvas picks
  // the new colors up on its next frame automatically
  const modebtn = document.getElementById('modebtn');
  const modelbl = document.getElementById('modelbl');
  function syncModeLabel() {
    if (modelbl) modelbl.textContent =
      document.documentElement.classList.contains('dark') ? 'white mode' : 'dark mode';
  }
  if (modebtn) {
    syncModeLabel();
    modebtn.addEventListener('click', () => {
      const dark = document.documentElement.classList.toggle('dark');
      try { localStorage.setItem('hackops-theme', dark ? 'dark' : 'light'); } catch (e) {}
      syncModeLabel();
    });
  }

  /* ---------------- main loop ---------------- */
  let last = performance.now();
  function rafLoop(now) { frame(now); requestAnimationFrame(rafLoop); }
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (tourMode) {
      // u chases targetU, camera rides the path
      const k = 1 - Math.exp(-dt * (reduceMotion ? 60 : 4.2));
      u += (targetU - u) * k;
      const p = pathAt(u);
      const ck = 1 - Math.exp(-dt * (reduceMotion ? 60 : 6));
      cam.x += (p.x - cam.x) * ck;
      cam.y += (p.y - cam.y) * ck;
      cam.s = Math.exp(Math.log(cam.s) + (Math.log(p.s) - Math.log(cam.s)) * ck);
      let dr = p.r - cam.r;
      while (dr > Math.PI) dr -= 2 * Math.PI;
      while (dr < -Math.PI) dr += 2 * Math.PI;
      cam.r += dr * ck;
    }

    // never let a NaN camera survive a frame: snap back onto the tour
    if (!isFinite(cam.s) || cam.s <= 0 || !isFinite(cam.x) || !isFinite(cam.y) || !isFinite(cam.r)) {
      Object.assign(cam, pathAt(u));
    }

    applyCam();
    drawGrid();
    updateHud();
    updateNav();
  }

  /* ---------------- boot ---------------- */
  function boot() {
    computeScales();
    buildNav();
    const p0 = pathAt(0);
    Object.assign(cam, p0);
    u = 0; targetU = 0;
    document.body.classList.add('booted');
    booted = true;
    if (coarse) hint.textContent = 'SWIPE TO FLY';
    // paint one frame synchronously: rAF is throttled to zero on hidden
    // tabs and the world must never appear un-placed
    applyCam(); drawGrid(); updateHud(); updateNav();
    requestAnimationFrame(rafLoop);
    // keep the tour advancing even when rAF starves (hidden panel)
    setInterval(() => {
      if (performance.now() - last > 250) frame(performance.now());
    }, 250);
  }

  addEventListener('resize', () => { computeScales(); });

  boot();
})();
