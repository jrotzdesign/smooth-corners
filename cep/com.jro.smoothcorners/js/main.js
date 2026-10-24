/* Smooth Corners — CEP panel logic.
   The same engine-core.js that runs inside Illustrator is loaded here too,
   so the little preview in the panel is drawn with the exact same math. */
(function () {
  var cs = new CSInterface();
  var $ = function (id) { return document.getElementById(id); };

  var STYLES = [
    { id: "ios", label: "iOS", sub: "Figma 60%", mode: "smooth", smoothing: 60 },
    { id: "full", label: "Full", sub: "fuller curve", mode: "cubic", k: 69.2 },
    { id: "max", label: "Max smooth", sub: "Figma 100%", mode: "smooth", smoothing: 100 },
    { id: "circle", label: "Circle", sub: "Illustrator default", mode: "smooth", smoothing: 0 }
  ];

  var DEFAULTS = { mode: "smooth", radius: 2.5, unit: "pt", smoothing: 60, k: 69.2,live: true,
    cornerMode: "all", picked: { tl: true, tr: true, br: true, bl: true }, perCorner: false,
    sizes: { tl: 2.5, tr: 2.5, br: 2.5, bl: 2.5 }, focus: "tl", scaleMode: "keep", scale: "common" };
  var CORNERS = ["tl", "tr", "br", "bl"];
  var state = load("sc.state", DEFAULTS);
  for (var dk in DEFAULTS) if (!(dk in state)) state[dk] = JSON.parse(JSON.stringify(DEFAULTS[dk]));
  var saved = load("sc.saved", []);
  // 1.3.5: the Logo style was renamed Full and iOS is the default. Reset to iOS once, then never again.
  if (!load("sc.v135", false)) {
    state.mode = "smooth"; state.smoothing = 60;
    try { localStorage.setItem("sc.v135", "1"); } catch (e) {}
  }
  saved.forEach(function (p) { if (p && typeof p.name === "string") p.name = p.name.replace(/^Logo /, "Full "); });

  function load(key, def) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function store() { try { localStorage.setItem("sc.state", JSON.stringify(state)); localStorage.setItem("sc.saved", JSON.stringify(saved)); } catch (e) {} }

  /* ---------- ExtendScript bridge ---------- */
  function call(expr, cb) { cs.evalScript(expr, function (res) { if (cb) cb(String(res)); }); }
  function parse(res) {
    var o = {}, parts = String(res).split("|"); o.status = parts[0];
    if (o.status !== "ok" && o.status !== "err") { o.status = "err"; o.message = res === "EvalScript error." ? "Script engine not loaded — reopen the panel." : res; return o; }
    for (var i = 1; i < parts.length; i++) { var kv = parts[i].split("="); o[kv[0]] = kv[1]; }
    if (o.status === "err") o.message = parts.slice(1).join("|");
    return o;
  }
  function ensureEngine(cb) {
    call("typeof SC !== 'undefined' && typeof SC.AI !== 'undefined' && SC.VERSION === '" + SC.VERSION + "'", function (r) {
      if (r === "true") return cb();
      var p = cs.getExtensionPath().replace(/\\/g, "/") + "/jsx/engine.jsx";
      call("$.evalFile('" + p.replace(/'/g, "\\'") + "')", function () { cb(); });
    });
  }
  function optString() {
    var rel = state.unit === "%";
    return "mode=" + state.mode + "&radius=" + state.radius + "&unit=" + (rel ? "pt" : state.unit) + "&relative=" + (rel ? 1 : 0) +
      "&smoothing=" + (state.smoothing / 100) + "&k=" + (state.k / 100) +
      (state.cornerMode === "pick" ? "&corners=" + CORNERS.map(function (c) { return c + ":" + cornerRadius(c); }).join(",") : "");
  }
  function cornerRadius(c) {
    if (state.cornerMode !== "pick") return state.radius;
    if (!state.picked[c]) return 0;
    return state.perCorner ? (+state.sizes[c] || 0) : state.radius;
  }
  function pickedCount() { return CORNERS.filter(function (c) { return state.picked[c]; }).length; }

  /* ---------- status ---------- */
  function setStatus(text, kind) { var s = $("status"); s.textContent = text; s.className = "status" + (kind ? " " + kind : ""); }
  function showResult(r) {
    if (r.status !== "ok") return setStatus(r.message, "err");
    var p = +r.paths, c = +r.corners, sk = +r.skipped;
    if (p === 0) return setStatus("No sharp corners found in the selection (curved points are left alone).", "err");
    var sh = +r.sharp || 0;
    setStatus(p + " path" + (p === 1 ? "" : "s") + " · " + c + " corner" + (c === 1 ? "" : "s") + " rounded" +
      (sh ? " · " + sh + " left sharp" : "") + (sk ? " · " + sk + " skipped" : ""), "ok");
  }

  var busy = false, pending = false, timer = null;
  function apply() {
    if (busy) { pending = true; return; }
    if (state.cornerMode !== "pick" && !(state.radius > 0)) return setStatus("Enter a radius greater than 0.", "err");
    busy = true;
    ensureEngine(function () {
      call("SC.AI.runDirect('" + optString() + "')", function (res) {
        busy = false; showResult(parse(res));
        if (pending) { pending = false; apply(); }
      });
    });
  }
  function changed() {
    store(); render();
    if (state.live) { clearTimeout(timer); timer = setTimeout(apply, 90); }
  }

  /* ---------- UI: style chips ---------- */
  function renderStyles() {
    var box = $("styleChips"); box.innerHTML = "";
    STYLES.forEach(function (s) {
      var b = document.createElement("button");
      var on = s.mode === state.mode && (s.mode === "cubic" ? Math.abs(s.k - state.k) < 0.05 : s.smoothing === state.smoothing);
      b.className = "chip style" + (on ? " on" : "");
      b.innerHTML = s.label + "<small>" + s.sub + "</small>";
      b.onclick = function () {
        state.mode = s.mode;
        if (s.k != null) state.k = s.k;
        if (s.smoothing != null) state.smoothing = s.smoothing;
        changed();
      };
      box.appendChild(b);
    });
  }

  /* ---------- UI: size presets ---------- */
  /* Size chips sit right under the radius field and the Scale menu is on the Radius heading row. "Common" is the default scale; Doubling, Fine and Fibonacci come
     from the engine's presets. The % of side chips replace them only while the unit is %. Saved presets get their
     own row underneath. */
  var COMMON = [2, 4, 8, 12, 16, 24];
  function scales() {
    var by = function (id) { return SC.PRESETS.sizeSets.filter(function (s) { return s.id === id; })[0]; };
    return [{ id: "common", label: "Common", values: COMMON }, { id: "doubling", label: "Doubling", values: by("doubling").values },
      { id: "fine", label: "Fine", values: by("fine").values }, { id: "fib", label: "Fibonacci", values: by("fib").values }];
  }
  function renderSizes() {
    var box = $("sizeChips"); box.innerHTML = "";
    var rel = state.unit === "%", all = scales();
    if (!all.some(function (s) { return s.id === state.scale; })) state.scale = "common";
    var values = rel ? SC.PRESETS.sizeSets.filter(function (s) { return s.unit === "%"; })[0].values : all.filter(function (s) { return s.id === state.scale; })[0].values;
    var unit = rel ? "%" : state.unit;
    var perC = state.cornerMode === "pick" && state.perCorner;
    var cur = perC ? +state.sizes[state.focus] : state.radius;
    values.forEach(function (v) {
      var b = document.createElement("button");
      b.className = "chip" + (cur === v && state.unit === unit ? " on" : "");
      b.textContent = v + (unit === "%" ? "%" : "");
      b.title = v + (unit === "%" ? "% of the shortest side" : " " + unit) + (perC ? " → " + NAMES[state.focus] : "");
      b.onclick = function () {
        if (perC) { state.sizes[state.focus] = v; state.picked[state.focus] = true; } else state.radius = v;
        state.unit = unit; changed();
      };
      box.appendChild(b);
    });
    // the Scale menu lives on the Radius heading row; it only applies to the pt/px/mm/in chips
    var sel = $("scale");
    $("scaleWrap").style.display = rel ? "none" : "";
    if (sel.options.length !== all.length) {
      sel.innerHTML = "";
      all.forEach(function (sc) { var o = document.createElement("option"); o.value = sc.id; o.textContent = sc.label; sel.appendChild(o); });
      sel.onchange = function () { state.scale = sel.value; store(); render(); };
    }
    sel.value = state.scale;
    var sbox = $("savedChips"); sbox.innerHTML = "";
    saved.forEach(function (p, i) {
      var b = document.createElement("button");
      b.className = "chip saved";
      b.innerHTML = p.name + "<b title='Delete'>×</b>";
      b.onclick = function (e) {
        if (e.target.tagName === "B") { saved.splice(i, 1); store(); render(); return; }
        state.mode = p.mode; state.radius = p.radius; state.unit = p.unit; state.smoothing = p.smoothing; state.k = p.k;
        state.cornerMode = p.cornerMode || "all"; state.perCorner = !!p.perCorner;
        if (p.picked) state.picked = JSON.parse(JSON.stringify(p.picked));
        if (p.sizes) state.sizes = JSON.parse(JSON.stringify(p.sizes));
        changed();
      };
      sbox.appendChild(b);
    });
  }

  /* ---------- UI: sliders ---------- */
  /* Slider with labelled ticks. While the pointer drags the thumb, a value within SNAP of the range of a tick
     snaps to the tick's exact value (the browser recomputes the raw value from the pointer on every move, so the
     snap holds inside the zone and lets go once the pointer leaves it). Holding Option/Alt turns snapping off.
     Keyboard steps and typing in the number box never snap. */
  var SNAP = 0.02;
  var altDown = false;
  window.addEventListener("keydown", function (e) { if (e.key === "Alt") altDown = true; });
  window.addEventListener("keyup", function (e) { if (e.key === "Alt") altDown = false; });
  window.addEventListener("blur", function () { altDown = false; });

  /* x position of the thumb's center for a 0..1 value: the thumb never leaves the track, so its center travels
     from half a thumb in to half a thumb in from the other end. Ticks, labels, fill and the invisible native
     range input (its thumb is sized to match in the CSS) all use this same travel. */
  var THUMB = 18;
  function along(f) { return "calc(" + THUMB / 2 + "px + (100% - " + THUMB + "px) * " + f + ")"; }

  function bindSlider(wrapId, numId, key, min, max, decimals, ticks) {
    var wrap = $(wrapId), range = wrap.querySelector("input"), num = $(numId), dragging = false, labels = [];
    ticks.forEach(function (t) {
      var pos = (t.v - min) / (max - min);
      var lab = document.createElement("div"); lab.className = "tick-label"; lab.style.left = along(pos); lab.textContent = t.label;
      if (pos > 0 && pos < 1) { var dot = document.createElement("div"); dot.className = "tick"; dot.style.left = along(pos); wrap.insertBefore(dot, wrap.querySelector(".thumb")); }
      wrap.insertBefore(lab, wrap.querySelector(".thumb"));
      labels.push({ el: lab, v: t.v });
    });
    function onInput(v) {
      v = Math.max(min, Math.min(max, parseFloat(v)));
      if (isNaN(v)) return;
      state[key] = +v.toFixed(decimals);
      changed();
    }
    function snap(v) {
      for (var i = 0; i < ticks.length; i++) if (Math.abs(v - ticks[i].v) <= SNAP * (max - min)) return ticks[i].v;
      return v;
    }
    range.addEventListener("pointerdown", function (e) { dragging = true; altDown = e.altKey; });
    range.addEventListener("pointermove", function (e) { altDown = e.altKey; });
    window.addEventListener("pointerup", function () { dragging = false; });
    window.addEventListener("pointercancel", function () { dragging = false; });
    range.addEventListener("input", function () {
      var v = parseFloat(range.value);
      onInput(dragging && !altDown ? snap(v) : v);
    });
    num.addEventListener("change", function () { onInput(num.value); });
    return function () {
      range.value = state[key];
      if (document.activeElement !== num) num.value = state[key] + (decimals ? "" : "");
      var f = (state[key] - min) / (max - min);
      wrap.querySelector(".fill").style.width = along(f);
      wrap.querySelector(".thumb").style.left = along(f);
      labels.forEach(function (l) { l.el.classList.toggle("on", Math.abs(state[key] - l.v) < 0.001); });
    };
  }
  var drawSmooth = bindSlider("smoothSlider", "smoothPct", "smoothing", 0, 100, 0, [{ v: 0, label: "circle" }, { v: 60, label: "iOS" }, { v: 100, label: "max" }]);
  var drawK = bindSlider("kSlider", "kPct", "k", 40, 100, 1, [{ v: 55.2, label: "circle" }, { v: 69.2, label: "full" }]);

  /* ---------- preview (same engine) ---------- */
  function renderPreview() {
    var svg = $("preview");
    var w = 150, h = 102, x0 = 5, y0 = 5;
    var poly = [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }];
    // Each corner may use at most half of the 102-tall edge (51). Smoothing needs r * (1 + s) of it, so a radius of
    // h / 4 (25.5) lets 0 to 100% smoothing all fit and look different. Anything bigger hits the engine's cap.
    var rMax = h / 4;
    var r = state.unit === "%" ? Math.min(rMax, state.radius / 100 * h) : rMax;
    // preview polygon order (screen, y-down): TL, TR, BR, BL
    var maxR = Math.max.apply(null, CORNERS.map(cornerRadius).concat([0.0001]));
    var per = [], perC = [];
    CORNERS.forEach(function (c, i) {
      var cr = cornerRadius(c); if (!(cr > 0)) { per[i] = null; perC[i] = null; return; }
      var rr = state.cornerMode === "pick" && state.perCorner && state.unit !== "%" ? r * cr / maxR : r;
      per[i] = { mode: state.mode, radius: rr, smoothing: state.smoothing / 100, k: state.k / 100 };
      perC[i] = { mode: "smooth", radius: rr, smoothing: 0 };
    });
    var pts = SC.roundPolygon(poly, [], null, true, null, per);
    var circ = SC.roundPolygon(poly, [], null, true, null, perC);
    svg.innerHTML = '<path d="' + d(pts) + '" style="fill:var(--accent)"/><path d="' + d(circ) + '" fill="none" stroke="rgba(255,255,255,.55)" stroke-dasharray="3 3"/>';
  }
  function d(pts) {
    var f = function (n) { return n.toFixed(2); };
    var s = "M" + f(pts[0].anchor.x) + " " + f(pts[0].anchor.y);
    for (var i = 0; i < pts.length; i++) {
      var A = pts[i], B = pts[(i + 1) % pts.length];
      s += "C" + f(A.right.x) + " " + f(A.right.y) + " " + f(B.left.x) + " " + f(B.left.y) + " " + f(B.anchor.x) + " " + f(B.anchor.y);
    }
    return s + "Z";
  }

  /* ---------- corner picker ---------- */
  var NAMES = { tl: "top left", tr: "top right", br: "bottom right", bl: "bottom left" };
  function renderPicker() {
    var pick = state.cornerMode === "pick";
    var poly = [{ x: 14, y: 14 }, { x: 62, y: 14 }, { x: 62, y: 62 }, { x: 14, y: 62 }];
    var per = CORNERS.map(function (c) { return (!pick || state.picked[c]) ? { mode: "smooth", radius: 14, smoothing: 0.6 } : null; });
    var pts = SC.roundPolygon(poly, [], null, true, null, per);
    var dots = "";
    var pos = { tl: [14, 14], tr: [62, 14], br: [62, 62], bl: [14, 62] };
    CORNERS.forEach(function (c) {
      var on = !pick || state.picked[c];
      dots += '<circle cx="' + pos[c][0] + '" cy="' + pos[c][1] + '" r="4.5" style="fill:' + (on ? "var(--accent)" : "#2b2b2b") + '" stroke="' + (on ? "#fff" : "#777") + '" stroke-width="1.5"/>';
    });
    $("pickerSvg").innerHTML = '<path d="' + d(pts) + '" fill="none" stroke="#cfcfcf" stroke-width="2"/>' + dots;
    [].forEach.call(document.querySelectorAll("#cornerSeg button"), function (b) { b.className = b.dataset.cm === state.cornerMode ? "on" : ""; });
    $("perCorner").checked = state.perCorner;
    $("perCorner").parentNode.classList.toggle("hidden", !pick);
    var perC = pick && state.perCorner;
    $("perCornerFields").classList.toggle("hidden", !perC);
    $("radiusField").style.display = perC ? "none" : "";
    [].forEach.call(document.querySelectorAll(".cfield"), function (f) {
      var c = f.dataset.c, inp = f.querySelector("input");
      f.classList.toggle("off", !state.picked[c]);
      f.classList.toggle("focus", c === state.focus);
      if (document.activeElement !== inp) inp.value = state.picked[c] ? state.sizes[c] : 0;
    });
    var n = pickedCount();
    $("cornerHint").textContent = !pick ? "Click corners in the square to round only those. Direct-selected anchors (A) also limit it."
      : n === 0 ? "No corners picked — the shape will be left sharp."
      : perC ? "Presets fill the highlighted field (" + NAMES[state.focus] + "). 0 = sharp."
      : n + " corner" + (n === 1 ? "" : "s") + " picked · unpicked corners stay sharp.";
  }
  [].forEach.call(document.querySelectorAll("#picker button"), function (b) {
    b.onclick = function () {
      var c = b.dataset.c;
      if (state.cornerMode !== "pick") {           // first click: round ONLY this corner
        state.cornerMode = "pick";
        CORNERS.forEach(function (k) { state.picked[k] = false; });
        state.picked[c] = true;
      } else state.picked[c] = !state.picked[c];
      if (state.picked[c] && (!state.perCorner || !(+state.sizes[c] > 0))) state.sizes[c] = state.radius;
      state.focus = c;
      changed();
    };
  });
  [].forEach.call(document.querySelectorAll("#cornerSeg button"), function (b) {
    b.onclick = function () {
      state.cornerMode = b.dataset.cm;
      if (state.cornerMode === "all") CORNERS.forEach(function (k) { state.picked[k] = true; });
      changed();
    };
  });
  $("perCorner").addEventListener("change", function () {
    state.perCorner = this.checked;
    if (state.perCorner) CORNERS.forEach(function (k) { state.sizes[k] = state.radius; });
    changed();
  });
  [].forEach.call(document.querySelectorAll(".cfield"), function (f) {
    var c = f.dataset.c, inp = f.querySelector("input");
    inp.addEventListener("focus", function () { state.focus = c; renderPicker(); renderSizes(); });
    inp.addEventListener("input", function () {
      var v = parseFloat(inp.value); if (isNaN(v) || v < 0) return;
      state.sizes[c] = v; state.picked[c] = v > 0; changed();
    });
  });

  /* ---------- scaling ---------- */
  var SCALE_HINTS = {
    keep: "Scale or stretch freely — the corners are rebuilt at the same radius as soon as you click off the shape (or press Fix now).",
    scale: "Corners grow and shrink with the shape and get rebuilt clean as soon as you click off it (or press Fix now).",
    off: "Illustrator stretches the corners. Use the link below to fix them later."
  };
  function renderScale() {
    [].forEach.call(document.querySelectorAll("#scaleSeg button"), function (b) { b.className = b.dataset.sm === state.scaleMode ? "on" : ""; });
    $("scaleHint").textContent = SCALE_HINTS[state.scaleMode];
  }
  [].forEach.call(document.querySelectorAll("#scaleSeg button"), function (b) {
    b.onclick = function () { state.scaleMode = b.dataset.sm; store(); render(); lastInfo = ""; poll(); };
  });
  $("fixNowBtn").onclick = function () {
    var m = state.scaleMode === "off" ? "keep" : state.scaleMode;
    ensureEngine(function () {
      call("SC.AI.fixScaled('selection','" + m + "')", function (res) {
        var r = parse(res);
        if (r.status !== "ok") return setStatus(r.message, "err");
        lastInfo = "";
        setStatus(+r.fixed ? "Rebuilt corners on " + r.fixed + " shape" + (+r.fixed === 1 ? "" : "s") + "." : "Nothing to fix in the selection.", +r.fixed ? "ok" : "");
      });
    });
  };
  $("fixAllBtn").onclick = function () {
    var m = state.scaleMode === "off" ? "keep" : state.scaleMode;
    ensureEngine(function () {
      call("SC.AI.fixScaled('document','" + m + "')", function (res) {
        var r = parse(res);
        if (r.status !== "ok") return setStatus(r.message, "err");
        setStatus(+r.fixed ? "Rebuilt corners on " + r.fixed + " scaled shape" + (+r.fixed === 1 ? "" : "s") + "." : "No scaled corners found in this document.", +r.fixed ? "ok" : "");
      });
    });
  };

  /* ---------- render all ---------- */
  function render() {
    [].forEach.call(document.querySelectorAll("#modeSeg button"), function (b) { b.className = b.dataset.mode === state.mode ? "on" : ""; });
    $("smoothBlock").classList.toggle("hidden", state.mode !== "smooth");
    $("cubicBlock").classList.toggle("hidden", state.mode !== "cubic");
    if (document.activeElement !== $("radius")) $("radius").value = state.radius;
    $("unit").value = state.unit;
    $("live").checked = state.live;
    renderStyles(); renderPicker(); renderSizes(); drawSmooth(); drawK(); renderPreview(); renderScale(); renderTooSmall();
  }

  /* One short line under the smoothing slider when the selected shape has less room than the chosen
     smoothing needs. Each corner may use half of the shape's shortest side, and smoothing needs
     r * (1 + s) of it. This is the bounding box of the selection, so it is a hint, not a guarantee. */
  var selMinSide = 0;
  function renderTooSmall() {
    var el = $("tooSmall"), show = false, limit = 0;
    if (state.mode === "smooth" && selMinSide > 0) {
      var rPts = Math.max.apply(null, CORNERS.map(cornerRadius).concat([0]));
      if (state.unit === "%") rPts = rPts / 100 * selMinSide; else rPts = SC.toPoints(rPts, state.unit);
      if (rPts > 0 && rPts * (1 + state.smoothing / 100) > selMinSide / 2 + 1e-6) {
        show = true; limit = Math.max(0, Math.floor((selMinSide / 2 / rPts - 1) * 100));
      }
    }
    el.style.display = show ? "block" : "none";
    if (show) el.textContent = "Shape is too small for full smoothing at this radius (limit about " + limit + "%).";
  }

  /* ---------- events ---------- */
  [].forEach.call(document.querySelectorAll("#modeSeg button"), function (b) {
    b.onclick = function () { state.mode = b.dataset.mode; changed(); };
  });
  $("radius").addEventListener("input", function () { var v = parseFloat(this.value); if (v > 0) { state.radius = v; changed(); } });
  $("unit").addEventListener("change", function () { state.unit = this.value; changed(); });
  $("live").addEventListener("change", function () { state.live = this.checked; store(); if (state.live) apply(); });
  $("applyBtn").onclick = apply;
  $("resetBtn").onclick = function () {
    ensureEngine(function () {
      call("SC.AI.resetCorners()", function (res) {
        var r = parse(res);
        if (r.status !== "ok") return setStatus(r.message, "err");
        setStatus(+r.reset ? r.reset + " path(s) back to sharp corners." : "Nothing to reset — these paths weren't rounded with Smooth Corners.", +r.reset ? "ok" : "");
      });
    });
  };
  $("saveBtn").onclick = function () {
    var label = (state.mode === "cubic" ? "Full " + state.k + "%" : "Smooth " + state.smoothing + "%") + " · " + state.radius + (state.unit === "%" ? "%" : state.unit);
    if (state.cornerMode === "pick") label += " · " + CORNERS.filter(function (c) { return state.picked[c]; }).join("+").toUpperCase();
    saved.push({ name: label, mode: state.mode, radius: state.radius, unit: state.unit, smoothing: state.smoothing, k: state.k,
      cornerMode: state.cornerMode, picked: JSON.parse(JSON.stringify(state.picked)), perCorner: state.perCorner, sizes: JSON.parse(JSON.stringify(state.sizes)) });
    store(); render();
    setStatus("Saved “" + label + "”.", "ok");
  };
  document.addEventListener("keydown", function (e) { if (e.key === "Enter") apply(); });

  /* ---------- selection info (light polling, paused when hidden) ---------- */
  /* ---------- show the selected shape's own settings ---------- */
  var lastSel = null;
  function round(n, d) { var f = Math.pow(10, d); return Math.round(n * f) / f; }
  function adopt(r) {
    state.mode = r.mode === "smooth" ? "smooth" : "cubic";
    if (state.mode === "smooth") state.smoothing = round(+r.smoothing * 100, 0);
    else state.k = round(+r.k * 100, 1);
    state.unit = ["pt", "px", "mm", "in", "%"].indexOf(r.unit) >= 0 ? r.unit : "pt";
    if (r.all === "1") {
      state.cornerMode = "all"; state.radius = +r.radius;
      CORNERS.forEach(function (c) { state.picked[c] = true; state.sizes[c] = +r.radius; });
    } else {
      state.cornerMode = "pick";
      var vals = [];
      CORNERS.forEach(function (c) {
        var v = +r[c] || 0;
        state.picked[c] = v > 0;
        state.sizes[c] = v > 0 ? v : (state.sizes[c] || 0);
        if (v > 0) vals.push(v);
      });
      var same = vals.every(function (v) { return Math.abs(v - vals[0]) < 1e-3; });
      state.perCorner = !same;
      if (vals.length) state.radius = vals[0];
    }
    // jump to the preset tab that contains this radius, if any
    var rad = state.perCorner ? state.sizes[state.focus] : state.radius;
    store(); render();                    // render only — never re-apply on selection
  }
  function describeAdopted(r) {
    var u = r.unit === "%" ? "% of side" : r.unit;
    var style = r.mode === "smooth" ? "Smoothing " + round(+r.smoothing * 100, 0) + "%" : "Single curve " + round(+r.k * 100, 1) + "%";
    var size = r.all === "1" ? r.radius + " " + u + " on all corners"
      : CORNERS.filter(function (c) { return +r[c] > 0; }).map(function (c) { return c.toUpperCase() + " " + r[c]; }).join(" · ") + " " + u;
    return "Selected shape: " + style + " · " + size + (r.mixed === "1" ? " (mixed — showing the first corner's style)" : "") + (+r.of > 1 ? " · showing the first of " + r.of + " paths" : "");
  }
  function checkSelection(selKey, hasStored, infoKey) {
    if (selKey === lastSel) return false;
    lastSel = selKey;
    if (!hasStored) return false;
    lastInfo = infoKey;                   // keep the "Selected shape: …" status up
    call("SC.AI.inspect()", function (res) {
      var r = parse(res);
      if (r.status !== "ok" || r.has !== "1") return;
      adopt(r);
      setStatus(describeAdopted(r), "ok");
    });
    return true;
  }

  var lastInfo = "";
  function poll() {
    if (document.hidden || busy) return;
    var mode = state.scaleMode || "keep";
    call("typeof SC !== 'undefined' && SC.AI && SC.AI.tick ? SC.AI.tick('" + mode + "') : 'na'", function (res) {
      if (res === "na") return ensureEngine(function () {});
      var r = parse(res);
      if (r.status !== "ok") return;
      var ms = +r.paths > 0 ? parseFloat(r.minSide) || 0 : 0;
      if (ms !== selMinSide) { selMinSide = ms; renderTooSmall(); }
      if (+r.fixed) {
        lastInfo = "";
        return setStatus("Corners rebuilt after scaling (" + r.fixed + " shape" + (+r.fixed === 1 ? "" : "s") + "). Undo twice to undo the scale.", "ok");
      }
      if (+r.waiting) {
        var wkey = "w" + r.sel + r.waiting;
        if (wkey === lastInfo) return; lastInfo = wkey;
        return setStatus("Stretched — the corners get rebuilt when you click off the shape, or press Fix now.");
      }
      var key = res.replace(/\|fixed=\d+$/, "");
      if (checkSelection(r.sel, +r.stored > 0, key)) return;
      if (key === lastInfo) return;
      lastInfo = key;
      if (r.doc === "0") return setStatus("Open a document to start.");
      if (+r.paths === 0) return setStatus("Select one or more paths. Direct-select individual anchors to round only those.");
      setStatus(r.paths + " path(s) selected · " + r.corners + " corner(s)" +
        (+r.partial ? " (only your direct-selected anchors)" : "") +
        (+r.stored ? " · " + r.stored + " already smooth-cornered (editable)" : "") +
        (+r.scaled ? " · " + r.scaled + " scaled — corners are stretched" : ""), +r.scaled ? "err" : "");
    });
  }

  /* CEP on Apple Silicon sometimes loads a panel but never paints it.
     Nudging the compositor on load / resize / show forces a repaint. */
  function nudge() {
    var b = document.body;
    b.style.transform = "translateZ(0)";
    requestAnimationFrame(function () { b.style.transform = ""; });
  }
  window.addEventListener("resize", nudge);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) nudge(); });
  [30, 250, 1000].forEach(function (t) { setTimeout(nudge, t); });
  var boot = $("boot"); if (boot) boot.parentNode.removeChild(boot);

  ensureEngine(function () { poll(); });
  setInterval(poll, 1000);
  render();
})();
