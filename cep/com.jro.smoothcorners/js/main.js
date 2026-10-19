/* Smooth Corners — CEP panel logic.
   The same engine-core.js that runs inside Illustrator is loaded here too,
   so the little preview in the panel is drawn with the exact same math. */
(function () {
  var cs = new CSInterface();
  var $ = function (id) { return document.getElementById(id); };

  var STYLES = [
    { id: "logo", label: "Logo", sub: "fuller curve", mode: "cubic", k: 69.2 },
    { id: "ios", label: "iOS", sub: "Figma 60%", mode: "smooth", smoothing: 60 },
    { id: "max", label: "Max smooth", sub: "Figma 100%", mode: "smooth", smoothing: 100 },
    { id: "circle", label: "Circle", sub: "Illustrator default", mode: "smooth", smoothing: 0 }
  ];

  var DEFAULTS = { mode: "cubic", radius: 2.5, unit: "pt", smoothing: 60, k: 69.2, live: true, tab: "doubling",
    cornerMode: "all", picked: { tl: true, tr: true, br: true, bl: true }, perCorner: false,
    sizes: { tl: 2.5, tr: 2.5, br: 2.5, bl: 2.5 }, focus: "tl", scaleMode: "keep" };
  var CORNERS = ["tl", "tr", "br", "bl"];
  var state = load("sc.state", DEFAULTS);
  for (var dk in DEFAULTS) if (!(dk in state)) state[dk] = JSON.parse(JSON.stringify(DEFAULTS[dk]));
  var saved = load("sc.saved", []);

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
  function renderSizes() {
    var tabs = $("sizeTabs"); tabs.innerHTML = "";
    var sets = SC.PRESETS.sizeSets.concat(saved.length ? [{ id: "saved", label: "Saved" }] : []);
    if (!sets.some(function (s) { return s.id === state.tab; })) state.tab = "doubling";
    sets.forEach(function (s) {
      var a = document.createElement("a");
      a.textContent = s.id === "relative" ? "% of side" : s.label;
      a.className = s.id === state.tab ? "on" : "";
      a.onclick = function () { state.tab = s.id; store(); render(); };
      tabs.appendChild(a);
    });
    var box = $("sizeChips"); box.innerHTML = "";
    if (state.tab === "saved") {
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
        box.appendChild(b);
      });
      return;
    }
    var set = SC.PRESETS.sizeSets.filter(function (s) { return s.id === state.tab; })[0];
    set.values.forEach(function (v) {
      var b = document.createElement("button");
      // presets use the unit you're working in (switching only into / out of %)
      var unit = set.unit === "%" ? "%" : (state.unit === "%" ? "pt" : state.unit);
      var perC = state.cornerMode === "pick" && state.perCorner;
      var cur = perC ? +state.sizes[state.focus] : state.radius;
      b.className = "chip" + (cur === v && state.unit === unit ? " on" : "");
      b.textContent = v + (unit === "%" ? "%" : "");
      b.title = v + (unit === "%" ? "% of the shortest side" : " " + unit) + (perC ? " → " + NAMES[state.focus] : "");
      b.onclick = function () {
        if (perC) { state.sizes[state.focus] = v; state.picked[state.focus] = true; } else state.radius = v;
        state.unit = unit; changed();
      };
      box.appendChild(b);
    });
  }

  /* ---------- UI: sliders ---------- */
  function bindSlider(wrapId, numId, key, min, max, decimals) {
    var wrap = $(wrapId), range = wrap.querySelector("input"), num = $(numId);
    function onInput(v) {
      v = Math.max(min, Math.min(max, parseFloat(v)));
      if (isNaN(v)) return;
      state[key] = +v.toFixed(decimals);
      changed();
    }
    range.addEventListener("input", function () { onInput(range.value); });
    num.addEventListener("change", function () { onInput(num.value); });
    return function () {
      range.value = state[key];
      if (document.activeElement !== num) num.value = state[key] + (decimals ? "" : "");
      var pct = (state[key] - min) / (max - min) * 100;
      wrap.querySelector(".fill").style.width = pct + "%";
      wrap.querySelector(".thumb").style.left = pct + "%";
    };
  }
  var drawSmooth = bindSlider("smoothSlider", "smoothPct", "smoothing", 0, 100, 0);
  var drawK = bindSlider("kSlider", "kPct", "k", 40, 100, 1);

  /* ---------- preview (same engine) ---------- */
  function renderPreview() {
    var svg = $("preview");
    var w = 110, h = 74, x0 = 5, y0 = 5;
    var poly = [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }];
    // map radius to the preview: absolute → relative to a 74-unit tall box, clamped for readability
    var r = state.unit === "%" ? Math.min(h / 2, state.radius / 100 * h) : h * 0.4;
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
    svg.innerHTML = '<path d="' + d(pts) + '" fill="#29A191"/><path d="' + d(circ) + '" fill="none" stroke="rgba(255,255,255,.55)" stroke-dasharray="3 3"/>';
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
      dots += '<circle cx="' + pos[c][0] + '" cy="' + pos[c][1] + '" r="4.5" fill="' + (on ? "#3b88e8" : "#2b2b2b") + '" stroke="' + (on ? "#fff" : "#777") + '" stroke-width="1.5"/>';
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
    renderStyles(); renderPicker(); renderSizes(); drawSmooth(); drawK(); renderPreview(); renderScale();
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
    var label = (state.mode === "cubic" ? "Logo " + state.k + "%" : "Smooth " + state.smoothing + "%") + " · " + state.radius + (state.unit === "%" ? "%" : state.unit);
    if (state.cornerMode === "pick") label += " · " + CORNERS.filter(function (c) { return state.picked[c]; }).join("+").toUpperCase();
    saved.push({ name: label, mode: state.mode, radius: state.radius, unit: state.unit, smoothing: state.smoothing, k: state.k,
      cornerMode: state.cornerMode, picked: JSON.parse(JSON.stringify(state.picked)), perCorner: state.perCorner, sizes: JSON.parse(JSON.stringify(state.sizes)) });
    state.tab = "saved"; store(); render();
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
    var hit = SC.PRESETS.sizeSets.filter(function (set) { return (set.unit === "%") === (state.unit === "%") && set.values.indexOf(rad) >= 0; })[0];
    if (hit && !SC.PRESETS.sizeSets.some(function (set) { return set.id === state.tab && set.values.indexOf(rad) >= 0; })) state.tab = hit.id;
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
