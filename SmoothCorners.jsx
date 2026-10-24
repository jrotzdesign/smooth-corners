#target illustrator
/*  Smooth Corners for Adobe Illustrator — v1.4.3
    Figma / iOS-style corner smoothing + a fuller single-curve 'Full' corner preset (k = 0.692).
    Built 2026-10-07. Runs in Illustrator 2024 and newer.  */

/* =====================================================================
   Smooth Corners — geometry engine (pure math, ES3 so it runs in
   Adobe ExtendScript AND in a browser / Node for testing).

   Two corner constructions:

   1. "smooth"  — Figma / iOS style continuous corner smoothing,
                  generalised to ANY corner angle. A circular arc of
                  radius r whose sweep is shrunk by the smoothing
                  factor s, with a cubic Bézier "lead-in" on each side
                  that takes curvature from 0 (straight edge) up to the
                  arc. s = 0 is a plain circular fillet (what Illustrator
                  does), s = 0.6 matches the "iOS" tick in Figma,
                  s = 1 removes the arc entirely.

   2. "cubic"   — One cubic Bézier per corner with the handles pulled
                  to k × (corner length). k = 0.5523 is a circle,
                  k = 0.692 is a fuller corner that
                  joins straight edges more gently (the "Full" preset).

   Coordinates are plain {x,y}. The engine is orientation-agnostic:
   it works for clockwise or counter-clockwise paths and for
   Illustrator's y-up document space.
   ===================================================================== */

var SC = (typeof SC !== "undefined") ? SC : {};

SC.VERSION = "1.4.3";
SC.EPS = 1e-6;
SC.K_CIRCLE = 0.5522847498307936;   // 4/3 * tan(pi/8)
SC.K_FULL = 0.692;                  // fuller single-curve corner
SC.SMOOTH_IOS = 0.6;                // Figma's "iOS" tick

/* ---------- tiny vector kit ---------- */
SC.v = function (x, y) { return { x: x, y: y }; };
SC.add = function (a, b) { return { x: a.x + b.x, y: a.y + b.y }; };
SC.sub = function (a, b) { return { x: a.x - b.x, y: a.y - b.y }; };
SC.mul = function (a, s) { return { x: a.x * s, y: a.y * s }; };
SC.dot = function (a, b) { return a.x * b.x + a.y * b.y; };
SC.cross = function (a, b) { return a.x * b.y - a.y * b.x; };
SC.len = function (a) { return Math.sqrt(a.x * a.x + a.y * a.y); };
SC.dist = function (a, b) { return SC.len(SC.sub(a, b)); };
SC.norm = function (a) {
  var l = SC.len(a);
  return l < SC.EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
SC.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };

/* ---------- one corner ----------
   prev, V, next : world points (prev -> V -> next is the travel order)
   opts:
     mode       "smooth" | "cubic"
     radius     corner radius (same units as the points)
     smoothing  0..1   (smooth mode)
     k          handle factor (cubic mode)
     budget     max distance the corner may extend along EITHER edge
                (Infinity / undefined = unlimited)
   returns null if the corner is degenerate (collinear / zero length),
   otherwise:
     { points: [ {anchor, left, right, smooth(bool)} ... ],
       extent, radius, smoothing }                                   */
SC.buildCorner = function (prev, V, next, opts) {
  var mode = opts.mode || "smooth";
  var r = Math.max(0, opts.radius || 0);
  var s = SC.clamp(opts.smoothing == null ? 0 : opts.smoothing, 0, 1);
  var k = opts.k == null ? SC.K_CIRCLE : opts.k;
  var budget = (opts.budget == null || !(opts.budget > 0)) ? Infinity : opts.budget;

  var e1 = SC.norm(SC.sub(V, prev));
  var e2 = SC.norm(SC.sub(next, V));
  if (SC.len(e1) < SC.EPS || SC.len(e2) < SC.EPS) return null;

  var cr = SC.cross(e1, e2);
  var dt = SC.clamp(SC.dot(e1, e2), -1, 1);
  var phi = Math.acos(dt);                 // turn angle, 0..pi
  if (Math.abs(cr) < 1e-7 || phi < 1e-4 || Math.PI - phi < 1e-4) return null; // straight or spike
  if (r < SC.EPS) return null;

  var tanHalf = Math.tan(phi / 2);
  var t = r * tanHalf;                     // plain fillet extent
  var p;

  if (mode === "cubic") {
    p = t;
    if (p > budget) { p = budget; t = budget; r = t / tanHalf; }
  } else {
    p = t * (1 + s);
    if (p > budget) {
      // Figma order of sacrifice: smoothing first, then radius.
      var sMax = budget / t - 1;
      if (sMax >= 0) { s = Math.min(s, sMax); }
      else { s = 0; t = budget; r = t / tanHalf; }
      p = budget;
    }
  }

  // local frame: origin S (start of corner on incoming edge),
  // x along e1, y toward the inside of the turn
  var sgn = cr > 0 ? 1 : -1;
  var n = { x: -e1.y * sgn, y: e1.x * sgn };
  var S = SC.sub(V, SC.mul(e1, p));
  var W = function (x, y) { return { x: S.x + e1.x * x + n.x * y, y: S.y + e1.y * x + n.y * y }; };
  var E = SC.add(V, SC.mul(e2, p));
  var pts = [];

  if (mode === "cubic") {
    pts.push({ anchor: S, left: S, right: SC.add(S, SC.mul(e1, k * p)), smooth: false });
    pts.push({ anchor: E, left: SC.sub(E, SC.mul(e2, k * p)), right: E, smooth: false });
    return { points: pts, extent: p, radius: r, smoothing: 0 };
  }

  /* ----- smooth mode ----- */
  var beta = phi * s / 2;                  // turn absorbed by each lead-in cubic
  var phiA = phi * (1 - s);                // turn left for the arc
  var p34 = r * Math.tan(beta / 2);
  var c = p34 * Math.cos(beta);
  var d = p34 * Math.sin(beta);
  var mx = c + r * (Math.sin(beta + phiA / 2) - Math.sin(beta));
  var my = d + r * (Math.cos(beta) - Math.cos(beta + phiA / 2));
  var b = (p - mx - my * tanHalf) / 3;     // forces mirror symmetry about the bisector
  if (b < 0) b = 0;
  var a = 2 * b;

  var noArc = phiA < 1e-5;
  var noLead = beta < 1e-7;

  // start point S
  var sRight = noLead ? null : W(a, 0);
  pts.push({ anchor: S, left: S, right: sRight, smooth: false });

  // arc description (local)
  var P3 = W(a + b + c, d);
  var C = W(a + b + c - r * Math.sin(beta), d + r * Math.cos(beta));
  var th0 = beta - Math.PI / 2;            // position angle of P3 about C (local)
  var arcPoint = function (th) { return SC.add(C, SC.mul(SC.v(e1.x * Math.cos(th) + n.x * Math.sin(th), e1.y * Math.cos(th) + n.y * Math.sin(th)), r)); };
  var arcTangent = function (th) { return SC.v(e1.x * -Math.sin(th) + n.x * Math.cos(th), e1.y * -Math.sin(th) + n.y * Math.cos(th)); };

  var Q1dir = SC.v(e1.x * Math.cos(phi - beta) + n.x * Math.sin(phi - beta), e1.y * Math.cos(phi - beta) + n.y * Math.sin(phi - beta));
  var P2 = noLead ? null : W(a + b, 0);

  if (noArc) {
    // s == 1 : the two lead-ins meet at a single apex point
    pts.push({ anchor: P3, left: P2, right: SC.add(P3, SC.mul(Q1dir, p34)), smooth: true });
  } else {
    var pieces = Math.ceil(phiA / (Math.PI / 2) - 1e-9); if (pieces < 1) pieces = 1;
    var dth = phiA / pieces;
    var h = (4 / 3) * Math.tan(dth / 4) * r;
    var i, th, A;
    for (i = 0; i <= pieces; i++) {
      th = th0 + dth * i;
      A = (i === 0) ? P3 : arcPoint(th);
      var tg = arcTangent(th);
      var L = (i === 0) ? P2 : SC.sub(A, SC.mul(tg, h));
      var R;
      if (i === pieces) {
        R = noLead ? null : SC.add(A, SC.mul(Q1dir, p34));
      } else {
        R = SC.add(A, SC.mul(tg, h));
      }
      // first/last arc points sit on the lead-in join; if there is no
      // lead-in (s==0) they ARE the start/end anchors on the edges.
      if (i === 0 && noLead) { pts[0].right = R; continue; }
      if (i === pieces && noLead) { pts.push({ anchor: E, left: L, right: E, smooth: false }); return { points: pts, extent: p, radius: r, smoothing: s }; }
      pts.push({ anchor: A, left: L, right: R, smooth: true });
    }
  }

  // end point E
  pts.push({ anchor: E, left: noLead ? E : SC.sub(E, SC.mul(e2, a)), right: E, smooth: false });
  return { points: pts, extent: p, radius: r, smoothing: s };
};

/* ---------- whole polygon ----------
   anchors  : array of {x,y} (travel order)
   isCorner : array of bool — which vertices to round with `opts` (null = all)
   opts     : as buildCorner (budget is computed here per edge)
   closed   : closed path? (default true)
   handles  : optional [{l:{x,y}, r:{x,y}}] — handles of points that are NOT
              rounded are kept exactly (curves elsewhere in the shape survive)
   perVertex: optional [opts|null] — overrides `opts` for a given vertex
              (used to keep previously rounded corners that aren't selected)
   returns array of point records {anchor,left,right,smooth,original,applied}
   plus .skipped (count of vertices that could not be rounded)      */
SC.roundPolygon = function (anchors, isCorner, opts, closed, handles, perVertex) {
  var N = anchors.length;
  var i, j, k;
  if (closed == null) closed = true;

  // desired extent per vertex (no budget yet)
  var want = [];
  var meta = [];
  var intended = [];
  for (i = 0; i < N; i++) {
    want[i] = 0; meta[i] = null; intended[i] = false;
    var endOK = closed || (i > 0 && i < N - 1);
    var base = null;
    if (perVertex && perVertex[i]) base = perVertex[i];
    else if (!isCorner || isCorner[i]) base = opts;
    if (!base || !endOK) continue;
    intended[i] = true;
    var pv = anchors[(i - 1 + N) % N], nx = anchors[(i + 1) % N];
    var o = {}; for (k in base) if (base.hasOwnProperty(k)) o[k] = base[k];
    o.budget = Infinity;
    var probe = SC.buildCorner(pv, anchors[i], nx, o);
    if (probe) { want[i] = probe.extent; meta[i] = o; }
  }

  // budgets: each edge is shared by two vertices
  var budget = [];
  for (i = 0; i < N; i++) budget[i] = Infinity;
  var edgeCount = closed ? N : N - 1;
  for (i = 0; i < edgeCount; i++) {
    j = (i + 1) % N;
    var L = SC.dist(anchors[i], anchors[j]);
    var wi = want[i], wj = want[j];
    var bi, bj;
    if (wi + wj > L) {
      if (wi > 0 && wj > 0) { bi = L * wi / (wi + wj); bj = L - bi; }
      else if (wi > 0) { bi = L; bj = 0; }
      else { bi = 0; bj = L; }
    } else { bi = L; bj = L; }
    bi = Math.max(0, bi - 1e-9); bj = Math.max(0, bj - 1e-9);
    budget[i] = Math.min(budget[i], bi);
    budget[j] = Math.min(budget[j], bj);
  }

  var out = [];
  var skipped = 0;
  var keep = function (i) {
    var h = handles && handles[i];
    out.push({ anchor: anchors[i], left: h ? h.l : anchors[i], right: h ? h.r : anchors[i], smooth: h ? !!h.smooth : false, original: i, applied: null });
  };
  for (i = 0; i < N; i++) {
    if (!meta[i]) { if (intended[i]) skipped++; keep(i); continue; }
    meta[i].budget = budget[i];
    var res = SC.buildCorner(anchors[(i - 1 + N) % N], anchors[i], anchors[(i + 1) % N], meta[i]);
    if (!res || res.extent < 1e-6) { skipped++; keep(i); continue; }
    var applied = { mode: meta[i].mode || "smooth", radius: meta[i].radius, smoothing: meta[i].smoothing, k: meta[i].k, rel: meta[i].rel || 0, unit: meta[i].unit || "pt" };
    for (k = 0; k < res.points.length; k++) {
      var P = res.points[k];
      out.push({ anchor: P.anchor, left: P.left || P.anchor, right: P.right || P.anchor, smooth: P.smooth, original: i, applied: applied });
    }
  }
  out.skipped = skipped;
  return out;
};

/* ---------- presets ---------- */
SC.PRESETS = {
  sizeSets: [
    { id: "doubling", label: "Doubling", unit: "pt", values: [2.5, 5, 10, 20, 40] },
    { id: "fine", label: "Fine", unit: "pt", values: [2, 4, 6, 8, 12, 16, 24] },
    { id: "fib", label: "Fibonacci", unit: "pt", values: [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144] },
    { id: "relative", label: "% of shortest side", unit: "%", values: [5, 10, 20, 30] }
  ],
  smoothing: [
    { id: "circle", label: "Circle (Illustrator)", value: 0 },
    { id: "ios", label: "iOS", value: 0.6 },
    { id: "max", label: "Max", value: 1 }
  ],
  handle: [
    { id: "circle", label: "Circle", value: 0.5523 },
    { id: "full", label: "Full", value: 0.692 },
    { id: "square", label: "Squarer", value: 0.8 }
  ]
};

/* unit → points */
SC.UNITS = { pt: 1, px: 1, mm: 72 / 25.4, cm: 72 / 2.54, "in": 72 };
SC.toPoints = function (value, unit) { return value * (SC.UNITS[unit] || 1); };

/* =====================================================================
   Smooth Corners — Illustrator binding (ExtendScript / ES3)
   Requires engine-core.js to be loaded first (same file in the build).

   Public API (used by the ScriptUI dialog and the CEP panel):
     SC.AI.run(optString)      apply, inside a preview session (dialog)
     SC.AI.runDirect(opt)      apply once, no session (panel)
     SC.AI.previewBegin()      snapshot the selection (idempotent)
     SC.AI.previewCancel()     restore the snapshot
     SC.AI.commit()            keep the result, drop the snapshot
     SC.AI.resetCorners()      put the original sharp shape back
     SC.AI.info()              "ok|paths=N|corners=M|stored=K|minSide=..|partial=P|scaled=S|doc=1"
     SC.AI.fixScaled(scope, m) rebuild corners on scaled paths ("selection"|"document", "keep"|"scale")
     SC.AI.tick(mode)          panel heartbeat: info + fixes stretched shapes once they're deselected

   optString is a query string, e.g.
     "mode=smooth&radius=12&unit=pt&relative=0&smoothing=0.6&k=0.692"
   Optional per-corner radii (rectangles / icons), 0 = keep that corner sharp:
     "...&corners=tl:8,tr:0,br:8,bl:0"
   Each sharp vertex is matched to the nearest corner of the shape's bounds.

   Non-destructive editing: every path this tool rounds keeps a copy of its
   ORIGINAL points (anchors + handles) and the settings used on each corner
   inside the path's Note (Attributes panel). Running the tool again on the
   same path re-rounds from the original instead of stacking rounds, and
   corners you don't select keep their previous rounding.
   ===================================================================== */

SC.AI = (function () {
  var API = {};
  var EPS = 0.01;                       // pt — "handle sits on the anchor"
  var cache = null;                     // preview snapshot
  var TAG_OPEN = "[SC2 ", TAG_CLOSE = " SC2]";

  /* ---------- helpers ---------- */
  function P(arr) { return { x: arr[0], y: arr[1] }; }
  function A(pt) { return [pt.x, pt.y]; }
  function same(a, b) { return Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS; }
  function f4(n) { return (Math.round(n * 10000) / 10000).toString(); }
  function isSel(s) { return s === PathPointSelection.ANCHORPOINT || s === PathPointSelection.LEFTRIGHTPOINT; }

  function parseOpts(str) {
    var o = {};
    if (!str) return o;
    var parts = String(str).split("&");
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split("=");
      if (kv.length < 2) continue;
      o[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join("="));
    }
    return o;
  }

  /* collect every PathItem in the selection, drilling into groups/compounds */
  function collect(items, out) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      try { if (!it || it.locked || it.hidden) continue; } catch (e) { continue; }
      var tn = it.typename;
      if (tn === "PathItem") out.push(it);
      else if (tn === "CompoundPathItem") collect(it.pathItems, out);
      else if (tn === "GroupItem") collect(it.pageItems, out);
    }
    return out;
  }

  function targets() {
    if (app.documents.length === 0) return [];
    var sel = app.activeDocument.selection;
    if (!sel || sel.length === 0 || typeof sel.length === "undefined") return [];
    return collect(sel, []);
  }

  /* ---------- stored original (lives in PathItem.note) ---------- */
  function stripStored(note) {
    note = note || "";
    var i0 = note.indexOf(TAG_OPEN), i1 = note.indexOf(TAG_CLOSE);
    if (i0 < 0 || i1 < 0) return note;
    return (note.substring(0, i0) + note.substring(i1 + TAG_CLOSE.length)).replace(/^\s+|\s+$/g, "");
  }

  function fingerprint(path) {
    var gb = path.geometricBounds; // [left, top, right, bottom]
    return [path.pathPoints.length, f4(gb[2] - gb[0]), f4(gb[1] - gb[3]), f4(gb[0]), f4(gb[1])].join(",");
  }

  function readStored(path) {
    var note = "";
    try { note = path.note || ""; } catch (e) { return null; }
    var i0 = note.indexOf(TAG_OPEN), i1 = note.indexOf(TAG_CLOSE);
    if (i0 < 0 || i1 < 0) return null;
    var body = note.substring(i0 + TAG_OPEN.length, i1);
    var rec = {}, parts = body.split(";"), i;
    for (i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf("=");
      if (eq > 0) rec[parts[i].substring(0, eq)] = parts[i].substring(eq + 1);
    }
    if (!rec.pts || !rec.fp) return null;
    var pts = [], pp = rec.pts.split("|");
    for (i = 0; i < pp.length; i++) {
      var v = pp[i].split(",");
      if (v.length < 8) return null;
      pts.push({ a: [parseFloat(v[0]), parseFloat(v[1])], l: [parseFloat(v[2]), parseFloat(v[3])], r: [parseFloat(v[4]), parseFloat(v[5])], smooth: v[6] === "1", eligible: v[7] === "1" });
    }
    var applied = [];
    for (i = 0; i < pts.length; i++) applied[i] = null;
    if (rec.st) {
      var sp = rec.st.split("|");
      for (i = 0; i < sp.length; i++) {
        var c = sp[i].split(":"); if (c.length !== 2) continue;
        var w = c[1].split(",");
        applied[parseInt(c[0], 10)] = { mode: w[0] === "c" ? "cubic" : "smooth", radius: parseFloat(w[1]), smoothing: parseFloat(w[2]), k: parseFloat(w[3]), rel: w.length > 4 ? parseFloat(w[4]) || 0 : 0, unit: w.length > 5 && w[5] ? w[5] : (w.length > 4 && parseFloat(w[4]) > 0 ? "%" : "pt") };
      }
    }
    var map = rec.map ? rec.map.split(",") : [];
    for (i = 0; i < map.length; i++) map[i] = parseInt(map[i], 10);
    return { pts: pts, applied: applied, closed: rec.closed === "1", map: map, fp: rec.fp.split(",") };
  }

  function writeStored(path, orig, closed, recs) {
    var ps = [], i, st = [], seen = {}, map = [];
    for (i = 0; i < orig.length; i++) {
      var o = orig[i];
      ps.push([f4(o.a[0]), f4(o.a[1]), f4(o.l[0]), f4(o.l[1]), f4(o.r[0]), f4(o.r[1]), o.smooth ? 1 : 0, o.eligible ? 1 : 0].join(","));
    }
    for (i = 0; i < recs.length; i++) {
      map.push(recs[i].original);
      var ap = recs[i].applied;
      if (ap && !seen[recs[i].original]) {
        seen[recs[i].original] = true;
        st.push(recs[i].original + ":" + (ap.mode === "cubic" ? "c" : "s") + "," + f4(ap.radius) + "," + f4(ap.smoothing || 0) + "," + f4(ap.k || SC.K_FULL) + "," + f4(ap.rel || 0) + "," + (ap.unit || "pt"));
      }
    }
    var rest = stripStored(path.note);
    if (!st.length) { path.note = rest; return; }   // nothing rounded → don't keep data
    var body = "closed=" + (closed ? "1" : "0") + ";pts=" + ps.join("|") + ";st=" + st.join("|") + ";map=" + map.join(",") + ";fp=" + fingerprint(path);
    path.note = (rest ? rest + " " : "") + TAG_OPEN + body + TAG_CLOSE;
  }

  /* ---------- transform tracking ----------
     The note holds the ORIGINAL sharp outline + per-corner settings, in the
     coordinates they had when the path was last rounded. To find out what
     happened to the path since (moved, scaled, stretched, rotated,
     reflected, skewed) we rebuild the rounded path the note describes and
     fit an affine transform from it onto the path's current anchors. If it
     fits, the outline is transformed the same way and the corners can be
     rebuilt crisp at their real radius. If it doesn't fit, the points were
     edited by hand and the path is treated as new artwork.              */
  API.scaleMode = "keep";      // "keep" = radius stays the same in pt | "scale" = radius follows the object

  function storedRecs(st) {
    var anchors = [], handles = [];
    for (var i = 0; i < st.pts.length; i++) {
      var q = st.pts[i];
      anchors.push(P(q.a)); handles.push({ l: P(q.l), r: P(q.r), smooth: q.smooth });
    }
    return SC.roundPolygon(anchors, [], null, st.closed, handles, st.applied);
  }

  function fitAffine(src, dst) {
    var n = src.length, i, mx = 0, my = 0, nx = 0, ny = 0;
    if (n < 3) return null;
    for (i = 0; i < n; i++) { mx += src[i][0]; my += src[i][1]; nx += dst[i][0]; ny += dst[i][1]; }
    mx /= n; my /= n; nx /= n; ny /= n;
    var sxx = 0, sxy = 0, syy = 0, axx = 0, axy = 0, ayx = 0, ayy = 0;
    for (i = 0; i < n; i++) {
      var x = src[i][0] - mx, y = src[i][1] - my, X = dst[i][0] - nx, Y = dst[i][1] - ny;
      sxx += x * x; sxy += x * y; syy += y * y;
      axx += x * X; axy += y * X; ayx += x * Y; ayy += y * Y;
    }
    var det = sxx * syy - sxy * sxy;
    if (!(Math.abs(det) > 1e-9 * (sxx * syy + 1e-12))) return null;
    var T = {
      a: (axx * syy - axy * sxy) / det, b: (axy * sxx - axx * sxy) / det,
      c: (ayx * syy - ayy * sxy) / det, d: (ayy * sxx - ayx * sxy) / det
    };
    T.e = nx - T.a * mx - T.b * my; T.f = ny - T.c * mx - T.d * my;
    var err = 0;
    for (i = 0; i < n; i++) {
      var px = T.a * src[i][0] + T.b * src[i][1] + T.e, py = T.c * src[i][0] + T.d * src[i][1] + T.f;
      err = Math.max(err, Math.abs(px - dst[i][0]), Math.abs(py - dst[i][1]));
    }
    T.err = err;
    return T;
  }

  function xf(T, p) { return [T.a * p[0] + T.b * p[1] + T.e, T.c * p[0] + T.d * p[1] + T.f]; }

  /* cur: current points [{a:[x,y]}...]. Returns the stored record mapped
     into the path's current space (or null), with flags:
       transformed — anything changed since the note was written
       distorted   — scaled / stretched / skewed (not just moved/rotated) */
  function validStored(path, st, cur) {
    if (!st) return null;
    if (!cur) cur = snapshot(path).points;
    var old;
    try { old = storedRecs(st); } catch (e) { return null; }
    if (old.length !== cur.length) return null;
    var src = [], dst = [], i, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (i = 0; i < cur.length; i++) {
      src.push([old[i].anchor.x, old[i].anchor.y]); dst.push(cur[i].a);
      minX = Math.min(minX, cur[i].a[0]); maxX = Math.max(maxX, cur[i].a[0]);
      minY = Math.min(minY, cur[i].a[1]); maxY = Math.max(maxY, cur[i].a[1]);
    }
    var T = fitAffine(src, dst);
    if (!T) return null;
    var diag = Math.sqrt((maxX - minX) * (maxX - minX) + (maxY - minY) * (maxY - minY));
    if (T.err > Math.max(0.05, diag * 3e-4)) return null;          // hand-edited

    var ident = Math.abs(T.a - 1) < 1e-6 && Math.abs(T.b) < 1e-6 && Math.abs(T.c) < 1e-6 && Math.abs(T.d - 1) < 1e-6 && Math.abs(T.e) < 1e-4 && Math.abs(T.f) < 1e-4;
    // rigid = columns orthonormal (move / rotate / reflect only)
    var c1 = T.a * T.a + T.c * T.c, c2 = T.b * T.b + T.d * T.d, cd = T.a * T.b + T.c * T.d;
    var rigid = Math.abs(c1 - 1) < 1e-4 && Math.abs(c2 - 1) < 1e-4 && Math.abs(cd) < 1e-4;
    st.transformed = !ident; st.distorted = !rigid; st.T = T;
    if (!ident) {
      for (i = 0; i < st.pts.length; i++) {
        var q = st.pts[i];
        q.a = xf(T, q.a); q.l = xf(T, q.l); q.r = xf(T, q.r);
      }
    }
    if (!rigid) {
      // corners measured in % follow the new size; fixed ones keep their pt
      // radius unless scaleMode says to scale them with the object
      var oMinX = Infinity, oMaxX = -Infinity, oMinY = Infinity, oMaxY = -Infinity;
      for (i = 0; i < st.pts.length; i++) {
        oMinX = Math.min(oMinX, st.pts[i].a[0]); oMaxX = Math.max(oMaxX, st.pts[i].a[0]);
        oMinY = Math.min(oMinY, st.pts[i].a[1]); oMaxY = Math.max(oMaxY, st.pts[i].a[1]);
      }
      var minSide = Math.min(oMaxX - oMinX, oMaxY - oMinY);
      var areaScale = Math.sqrt(Math.abs(T.a * T.d - T.b * T.c));
      for (i = 0; i < st.applied.length; i++) {
        var ap = st.applied[i]; if (!ap) continue;
        if (ap.rel > 0) ap.radius = ap.rel / 100 * minSide;
        else if (API.scaleMode === "scale") ap.radius = ap.radius * areaScale;
      }
    }
    return st;
  }

  /* ---------- snapshot / restore ---------- */
  function snapshot(path) {
    var pts = [], pp = path.pathPoints;
    for (var i = 0; i < pp.length; i++) {
      pts.push({ a: pp[i].anchor.slice(0), l: pp[i].leftDirection.slice(0), r: pp[i].rightDirection.slice(0), t: pp[i].pointType, s: pp[i].selected });
    }
    var note = ""; try { note = path.note; } catch (e) {}
    return { item: path, closed: path.closed, note: note, points: pts };
  }

  function writePath(path, recs, closed) {
    var anchors = [];
    for (var i = 0; i < recs.length; i++) anchors.push(A(recs[i].anchor));
    path.setEntirePath(anchors);
    var pp = path.pathPoints;
    for (i = 0; i < recs.length; i++) {
      pp[i].leftDirection = A(recs[i].left);
      pp[i].rightDirection = A(recs[i].right);
      pp[i].pointType = recs[i].smooth ? PointType.SMOOTH : PointType.CORNER;
    }
    path.closed = closed;
  }

  function restore(snap) {
    var path = snap.item;
    try {
      var anchors = [];
      for (var i = 0; i < snap.points.length; i++) anchors.push(snap.points[i].a);
      path.setEntirePath(anchors);
      var pp = path.pathPoints;
      for (i = 0; i < snap.points.length; i++) {
        pp[i].leftDirection = snap.points[i].l;
        pp[i].rightDirection = snap.points[i].r;
        pp[i].pointType = snap.points[i].t;
        try { pp[i].selected = snap.points[i].s; } catch (e1) {}
      }
      path.closed = snap.closed;
      path.note = snap.note;
    } catch (e) { /* item may have been deleted */ }
  }

  /* ---------- analyse one path ----------
     returns the ORIGINAL shape (stored one if this path was rounded
     before), which vertices are eligible, which are selected, and the
     settings previously applied to each vertex.                        */
  function analyse(path, snapPts) {
    var pp = snapPts || snapshot(path).points;
    var N = pp.length, i;
    var st = validStored(path, readStored(path), pp);
    var orig, applied, closed, selOrig = {}, anySel = false, allSel = true;

    if (st) {
      orig = st.pts; applied = st.applied; closed = st.closed;
      for (i = 0; i < N; i++) {
        if (isSel(pp[i].s)) { anySel = true; if (st.map[i] != null) selOrig[st.map[i]] = true; } else allSel = false;
      }
    } else {
      orig = []; applied = []; closed = path.closed;
      for (i = 0; i < N; i++) {
        var prev = pp[(i - 1 + N) % N], cur = pp[i], next = pp[(i + 1) % N];
        var sharp = same(cur.l, cur.a) && same(cur.r, cur.a);
        var straightIn = same(prev.r, prev.a), straightOut = same(next.l, next.a);
        var elig = sharp && straightIn && straightOut && (closed || (i > 0 && i < N - 1));
        orig.push({ a: cur.a, l: cur.l, r: cur.r, smooth: cur.t === PointType.SMOOTH, eligible: elig });
        applied.push(null);
        if (isSel(pp[i].s)) { anySel = true; selOrig[i] = true; } else allSel = false;
      }
    }
    var partial = anySel && !allSel;
    var target = [], count = 0;
    for (i = 0; i < orig.length; i++) {
      target[i] = orig[i].eligible && (!partial || !!selOrig[i]);
      if (target[i]) count++;
    }
    return { orig: orig, applied: applied, closed: closed, target: target, stored: !!st, distorted: !!(st && st.distorted), cornerCount: count, partial: partial, selOrig: selOrig };
  }

  /* which corner of the shape a vertex belongs to (Illustrator is y-up) */
  function quadOf(q, cx, cy) { return (q.a[1] >= cy ? "t" : "b") + (q.a[0] <= cx ? "l" : "r"); }

  /* ---------- apply to one path ---------- */
  function applyPath(path, snap, o) {
    var an = analyse(path, snap.points);
    if (an.cornerCount === 0) return { corners: 0, skipped: 0, touched: false };

    var anchors = [], handles = [], minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, i;
    for (i = 0; i < an.orig.length; i++) {
      var q = an.orig[i];
      anchors.push(P(q.a));
      handles.push({ l: P(q.l), r: P(q.r), smooth: q.smooth });
      minX = Math.min(minX, q.a[0]); maxX = Math.max(maxX, q.a[0]);
      minY = Math.min(minY, q.a[1]); maxY = Math.max(maxY, q.a[1]);
    }
    var minSide = Math.min(maxX - minX, maxY - minY);
    var toPt = function (v) { return o.relative ? (v / 100) * minSide : SC.toPoints(v, o.unit); };
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    // which corner of the shape a vertex belongs to (Illustrator is y-up)
    var quad = function (q) { return quadOf(q, cx, cy); };

    // targets get the new settings; corners outside the scope keep theirs.
    // In "pick corners" mode a picked corner gets its radius and an
    // unpicked one (radius 0) goes back to sharp.
    var perVertex = [], rounded = 0, sharp = 0;
    for (i = 0; i < an.orig.length; i++) {
      if (an.target[i]) {
        var rv = o.cornerRadii ? (o.cornerRadii[quad(an.orig[i])] || 0) : o.radius;
        if (rv > 0) { perVertex[i] = { mode: o.mode, radius: toPt(rv), smoothing: o.smoothing, k: o.k, rel: o.relative ? rv : 0, unit: o.relative ? "%" : o.unit }; rounded++; }
        else { perVertex[i] = null; sharp++; }
      } else perVertex[i] = an.applied[i] || null;
    }
    var recs = SC.roundPolygon(anchors, [], null, an.closed, handles, perVertex);

    writePath(path, recs, an.closed);
    writeStored(path, an.orig, an.closed, recs);

    // keep the same anchors selected so the next (live) update hits the
    // same corners — rewriting the path would otherwise select all of them
    var pp = path.pathPoints;
    for (i = 0; i < recs.length; i++) {
      try { pp[i].selected = (!an.partial || an.selOrig[recs[i].original]) ? PathPointSelection.ANCHORPOINT : PathPointSelection.NOSELECTION; } catch (e) {}
    }
    return { corners: Math.max(0, rounded - recs.skipped), sharp: sharp, skipped: recs.skipped, touched: true };
  }

  /* ---------- public ---------- */
  API.previewBegin = function () {
    if (cache) return cache.length;
    var tg = targets();
    cache = [];
    for (var i = 0; i < tg.length; i++) cache.push(snapshot(tg[i]));
    return cache.length;
  };

  API.previewCancel = function () {
    if (!cache) return "ok|restored=0";
    for (var i = 0; i < cache.length; i++) restore(cache[i]);
    var n = cache.length; cache = null;
    try { app.redraw(); } catch (e) {}
    return "ok|restored=" + n;
  };

  API.commit = function () { var n = cache ? cache.length : 0; cache = null; return "ok|committed=" + n; };
  API.hasPreview = function () { return !!cache; };

  API.run = function (optString) {
    try {
      if (app.documents.length === 0) return "err|Open a document first.";
      var raw = parseOpts(optString);
      var o = {
        mode: raw.mode === "cubic" ? "cubic" : "smooth",
        radius: parseFloat(raw.radius), unit: raw.unit || "pt",
        relative: raw.relative === "1" || raw.relative === "true",
        smoothing: SC.clamp(parseFloat(raw.smoothing || "0.6"), 0, 1),
        k: parseFloat(raw.k || SC.K_FULL)
      };
      o.cornerRadii = null;
      if (raw.corners) {
        o.cornerRadii = { tl: 0, tr: 0, br: 0, bl: 0 };
        var cp = raw.corners.split(",");
        for (var ci = 0; ci < cp.length; ci++) {
          var kv = cp[ci].split(":");
          if (kv.length === 2 && o.cornerRadii.hasOwnProperty(kv[0])) o.cornerRadii[kv[0]] = Math.max(0, parseFloat(kv[1]) || 0);
        }
      } else if (!(o.radius > 0)) return "err|Radius must be greater than 0.";
      if (!(o.k > 0)) o.k = SC.K_FULL;
      if (isNaN(o.smoothing)) o.smoothing = SC.SMOOTH_IOS;

      API.previewBegin();
      if (!cache.length) { cache = null; return "err|Select one or more paths first."; }
      var paths = 0, corners = 0, skipped = 0, sharp = 0;
      for (var i = 0; i < cache.length; i++) {
        restore(cache[i]);
        var res = applyPath(cache[i].item, cache[i], o);
        if (res.touched) paths++;
        corners += res.corners; skipped += res.skipped; sharp += res.sharp || 0;
      }
      try { app.redraw(); } catch (e2) {}
      return "ok|paths=" + paths + "|corners=" + corners + "|sharp=" + sharp + "|skipped=" + skipped + "|total=" + cache.length;
    } catch (e) {
      return "err|" + (e.message || e) + (e.line ? " (line " + e.line + ")" : "");
    }
  };

  API.runDirect = function (optString) {
    cache = null;
    var r = API.run(optString);
    cache = null;
    return r;
  };

  /* Put the original shape back on every selected path that has stored data */
  API.resetCorners = function () {
    try {
      if (cache) { for (var c = 0; c < cache.length; c++) restore(cache[c]); cache = null; }
      var tg = targets(), n = 0;
      for (var i = 0; i < tg.length; i++) {
        var st = validStored(tg[i], readStored(tg[i]), null);
        if (!st) continue;
        var recs = [];
        for (var j = 0; j < st.pts.length; j++) {
          var q = st.pts[j];
          recs.push({ anchor: P(q.a), left: P(q.l), right: P(q.r), smooth: q.smooth });
        }
        writePath(tg[i], recs, st.closed);
        tg[i].note = stripStored(tg[i].note);
        n++;
      }
      try { app.redraw(); } catch (e2) {}
      return "ok|reset=" + n + "|total=" + tg.length;
    } catch (e) { return "err|" + (e.message || e); }
  };

  /* ---------- keep corners crisp after scaling ----------
     Rebuilds the corners of every rounded path that was scaled / stretched
     since it was last rounded, at the radius it had before (or scaled with
     the object when scaleMode is "scale"). Paths that were only moved or
     rotated are left alone.

     Undo-friendly: every distorted state we fix is remembered for the
     session. If you press Undo and get back to that stretched state, it is
     NOT fixed again — so the next Undo takes you back before the scale.   */
  var fixedStates = {}, fixedCount = 0;
  function stateKey(path, snapPts) {
    var id = ""; try { id = path.uuid || ""; } catch (e) {}       // Illustrator 2020+
    var k = [id, snapPts.length];
    for (var i = 0; i < snapPts.length; i++) k.push(f4(snapPts[i].a[0]) + "," + f4(snapPts[i].a[1]));
    return k.join("|");
  }

  /* Work out the fix for a path WITHOUT touching it. Returns null when the
     path doesn't need one (not ours, not distorted, already right, or a
     stretched state the user deliberately undid back to). */
  function planFix(path) {
    var raw = readStored(path); if (!raw) return null;
    var snap = snapshot(path);
    var st = validStored(path, raw, snap.points);
    if (!st || !st.distorted) return null;
    var key = stateKey(path, snap.points);
    if (fixedStates[key]) return null;             // user undid our fix — respect it

    var anchors = [], handles = [], i;
    for (i = 0; i < st.pts.length; i++) {
      var q = st.pts[i];
      anchors.push(P(q.a)); handles.push({ l: P(q.l), r: P(q.r), smooth: q.smooth });
    }
    var recs = SC.roundPolygon(anchors, [], null, st.closed, handles, st.applied);

    // already looks right? (e.g. % radius on a uniform scale, or scaleMode "scale")
    if (recs.length === snap.points.length) {
      var dev = 0;
      for (i = 0; i < recs.length; i++) {
        var c = snap.points[i];
        dev = Math.max(dev, Math.abs(recs[i].anchor.x - c.a[0]), Math.abs(recs[i].anchor.y - c.a[1]),
          Math.abs(recs[i].left.x - c.l[0]), Math.abs(recs[i].left.y - c.l[1]),
          Math.abs(recs[i].right.x - c.r[0]), Math.abs(recs[i].right.y - c.r[1]));
      }
      if (dev < 0.01) return null;
    }
    return { st: st, recs: recs, snap: snap, key: key };
  }

  function fixOne(path) {
    var plan = planFix(path);
    if (!plan) return false;
    var recs = plan.recs, snap = plan.snap, i;
    try {
      writePath(path, recs, plan.st.closed);
      writeStored(path, plan.st.pts, plan.st.closed, recs);
      var pp = path.pathPoints, same = recs.length === snap.points.length;
      for (i = 0; i < recs.length; i++) {
        try { pp[i].selected = same ? snap.points[i].s : PathPointSelection.NOSELECTION; } catch (e1) {}
      }
    } catch (e) { return false; }                    // locked layer etc.
    if (fixedCount > 2000) { fixedStates = {}; fixedCount = 0; }
    fixedStates[plan.key] = true; fixedCount++;
    return true;
  }

  function documentPaths() {
    var out = [], items = app.activeDocument.pathItems;
    for (var i = 0; i < items.length; i++) {
      var it = items[i], note = "";
      try { if (it.locked || it.hidden) continue; note = it.note || ""; } catch (e) { continue; }
      if (note.indexOf(TAG_OPEN) >= 0) out.push(it);
    }
    return out;
  }

  /* scope: "selection" | "document"; mode: "keep" | "scale" (optional) */
  API.fixScaled = function (scope, mode) {
    try {
      if (app.documents.length === 0) return "ok|fixed=0|checked=0";
      if (mode === "keep" || mode === "scale") API.scaleMode = mode;
      var list = scope === "document" ? documentPaths() : targets(), n = 0;
      for (var i = 0; i < list.length; i++) if (fixOne(list[i])) n++;
      if (n) { try { app.redraw(); } catch (e2) {} }
      return "ok|fixed=" + n + "|checked=" + list.length;
    } catch (e) { return "err|" + (e.message || e); }
  };

  /* Panel heartbeat.
     IMPORTANT: it never modifies anything that is currently selected.
     Rewriting a selected path right after a drag collides with
     Illustrator's Bounding Box / Free Transform tool ("Error:PARM").
     So a stretched shape is only remembered while it's selected, and its
     corners are rebuilt once you click off it (or press Fix now, which is
     a deliberate click in the panel).

     It is also cheap while nothing changes: the full analysis only runs
     when the selection or its bounds change.                              */
  var pending = {}, pendingCount = 0, lastFp = null, lastInfo = null, lastMode = null;

  function uidOf(it) { try { return String(it.uuid || ""); } catch (e) { return ""; } }

  function selectionFingerprint(tg) {
    var f = [tg.length];
    for (var i = 0; i < tg.length; i++) {
      var gb; try { gb = tg[i].geometricBounds; } catch (e) { gb = [0, 0, 0, 0]; }
      f.push(uidOf(tg[i]) + ":" + f4(gb[0]) + "," + f4(gb[1]) + "," + f4(gb[2]) + "," + f4(gb[3]) + ":" + tg[i].pathPoints.length);
    }
    return f.join("|");
  }

  API.tick = function (mode) {
    var fixed = 0, waiting = 0, i;
    try {
      if (!app.documents.length) { pending = {}; pendingCount = 0; return API.info() + "|fixed=0|waiting=0"; }
      var auto = !cache && (mode === "keep" || mode === "scale");
      if (auto) API.scaleMode = mode;
      var tg = targets(), selIds = {};
      for (i = 0; i < tg.length; i++) selIds[uidOf(tg[i])] = true;

      // 1. fix stretched shapes you've clicked off of (safe: not selected)
      if (auto && pendingCount) {
        for (var id in pending) {
          if (!pending.hasOwnProperty(id) || selIds[id]) continue;
          var it = pending[id];
          delete pending[id]; pendingCount--;
          try { if (fixOne(it)) fixed++; } catch (eDead) { /* deleted / closed */ }
        }
        if (fixed) { try { app.redraw(); } catch (e2) {} }
      }

      // 2. look at the selection — read only
      var fp = selectionFingerprint(tg);
      if (fp !== lastFp || fixed || mode !== lastMode) {
        lastFp = fp; lastMode = mode;
        lastInfo = API.info();
        if (auto) {
          for (i = 0; i < tg.length; i++) {
            var uid = uidOf(tg[i]);
            if (!uid || pending[uid]) continue;
            if (planFix(tg[i])) { pending[uid] = tg[i]; pendingCount++; }
          }
        }
      }
      for (i = 0; i < tg.length; i++) if (pending[uidOf(tg[i])]) waiting++;
      return lastInfo + "|fixed=" + fixed + "|waiting=" + waiting;
    } catch (e) { return "err|" + (e.message || e); }
  };

  /* ---------- read a rounded shape's settings back ----------
     Returns the settings of the first selected shape that was rounded with
     Smooth Corners, in the unit you used, so the panel / dialog can show
     them (like Figma showing a layer's radius).                            */
  function r3(n) { return Math.round(n * 1000) / 1000; }
  function describe(an) {
    var orig = an.orig, ap = an.applied, i, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (i = 0; i < orig.length; i++) {
      minX = Math.min(minX, orig[i].a[0]); maxX = Math.max(maxX, orig[i].a[0]);
      minY = Math.min(minY, orig[i].a[1]); maxY = Math.max(maxY, orig[i].a[1]);
    }
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, minSide = Math.min(maxX - minX, maxY - minY);
    var first = null;
    for (i = 0; i < ap.length; i++) if (ap[i]) { first = ap[i]; break; }
    if (!first) return "ok|has=0";
    var unit = first.unit || "pt";
    if (unit !== "%" && !SC.UNITS[unit]) unit = "pt";
    var disp = function (a) {
      if (!a) return 0;
      if (unit === "%") return a.rel > 0 ? a.rel : (minSide > 0 ? a.radius / minSide * 100 : 0);
      return a.radius / SC.UNITS[unit];
    };
    var q = { tl: null, tr: null, br: null, bl: null }, mixed = false, allVal = null, all = true, styleMixed = false;
    for (i = 0; i < orig.length; i++) {
      if (!orig[i].eligible) continue;
      var v = r3(disp(ap[i])), k = quadOf(orig[i], cx, cy);
      if (q[k] === null) q[k] = v; else if (Math.abs(q[k] - v) > 1e-3) mixed = true;
      if (allVal === null) allVal = v; else if (Math.abs(allVal - v) > 1e-3) all = false;
      if (!(v > 0)) all = false;
      if (ap[i] && (ap[i].mode !== first.mode || Math.abs((ap[i].smoothing || 0) - (first.smoothing || 0)) > 1e-3 || Math.abs((ap[i].k || 0) - (first.k || 0)) > 1e-3)) styleMixed = true;
    }
    return "ok|has=1|mode=" + first.mode + "|smoothing=" + r3(first.smoothing || 0) + "|k=" + r3(first.k || SC.K_FULL) +
      "|unit=" + unit + "|all=" + (all ? 1 : 0) + "|radius=" + (allVal || 0) +
      "|tl=" + (q.tl || 0) + "|tr=" + (q.tr || 0) + "|br=" + (q.br || 0) + "|bl=" + (q.bl || 0) +
      "|mixed=" + (mixed || styleMixed ? 1 : 0);
  }

  API.inspect = function () {
    try {
      if (app.documents.length === 0) return "ok|has=0";
      var tg = targets();
      for (var i = 0; i < tg.length; i++) {
        var an = analyse(tg[i], null);
        if (an.stored) return describe(an) + "|of=" + tg.length;
      }
      return "ok|has=0";
    } catch (e) { return "err|" + (e.message || e); }
  };

  /* identity of the current selection (changes only when you select
     different objects, not when their geometry changes)                  */
  function selKey(tg) {
    var s = String(tg.length), h = 5381, i, j;
    for (i = 0; i < tg.length; i++) {
      var id = ""; try { id = String(tg[i].uuid || ""); } catch (e) {}
      if (!id) { try { var gb = tg[i].geometricBounds; id = Math.round(gb[0]) + "," + Math.round(gb[1]); } catch (e2) {} }
      for (j = 0; j < id.length; j++) h = ((h * 33) ^ id.charCodeAt(j)) % 2147483647;
    }
    return s + "-" + h;
  }

  API.info = function () {
    try {
      if (app.documents.length === 0) return "ok|paths=0|corners=0|stored=0|minSide=0|doc=0";
      var tg = targets(), corners = 0, stored = 0, minSide = Infinity, partial = 0, distorted = 0;
      for (var i = 0; i < tg.length; i++) {
        var an = analyse(tg[i], null);
        corners += an.cornerCount; if (an.stored) stored++; if (an.partial) partial++; if (an.distorted) distorted++;
        var gb = tg[i].geometricBounds;
        minSide = Math.min(minSide, gb[2] - gb[0], gb[1] - gb[3]);
      }
      if (!isFinite(minSide)) minSide = 0;
      return "ok|paths=" + tg.length + "|corners=" + corners + "|stored=" + stored + "|minSide=" + minSide.toFixed(2) + "|partial=" + partial + "|scaled=" + distorted + "|sel=" + selKey(tg) + "|doc=1";
    } catch (e) { return "err|" + (e.message || e); }
  };

  return API;
})();

/* =====================================================================
   Smooth Corners — standalone dialog (ScriptUI, live preview)
   ===================================================================== */
(function () {
  if (app.documents.length === 0) { alert("Smooth Corners\n\nOpen a document and select one or more paths first."); return; }
  var info0 = SC.AI.info();
  if (info0.indexOf("paths=0") >= 0) { alert("Smooth Corners\n\nSelect one or more paths (or Direct-Select just the anchors you want rounded) and run again."); return; }

  var state = { mode: "smooth", radius: 2.5, unit: "pt", relative: false, smoothing: SC.SMOOTH_IOS, k: SC.K_FULL, preview: true };
  var busy = false;

  var w = new Window("dialog", "Smooth Corners  ·  Figma / iOS style corners for Illustrator");
  w.orientation = "column"; w.alignChildren = ["fill", "top"]; w.spacing = 10; w.margins = 16;

  /* ---- mode ---- */
  var gMode = w.add("panel", undefined, "Corner style"); gMode.orientation = "row"; gMode.alignChildren = ["left", "center"]; gMode.margins = [12, 14, 12, 10];
  var rbSmooth = gMode.add("radiobutton", undefined, "Smoothing (Figma / iOS)");
  var rbCubic = gMode.add("radiobutton", undefined, "Full curve (fuller single curve)");
  rbSmooth.value = true;

  /* ---- radius ---- */
  var gR = w.add("panel", undefined, "Radius"); gR.orientation = "column"; gR.alignChildren = ["fill", "top"]; gR.margins = [12, 14, 12, 10];
  var rowR = gR.add("group"); rowR.orientation = "row"; rowR.alignChildren = ["left", "center"];
  rowR.add("statictext", undefined, "Radius");
  var etR = rowR.add("edittext", undefined, "2.5"); etR.characters = 7;
  var ddUnit = rowR.add("dropdownlist", undefined, ["pt", "px", "mm", "in", "% of shortest side"]); ddUnit.selection = 0;
  rowR.add("statictext", undefined, "   Size preset");
  var presetItems = [], presetMap = [];
  (function () {
    var sets = SC.PRESETS.sizeSets;
    presetItems.push("— choose —"); presetMap.push(null);
    for (var i = 0; i < sets.length; i++) {
      presetItems.push("-"); presetMap.push(null);
      for (var j = 0; j < sets[i].values.length; j++) {
        var v = sets[i].values[j];
        presetItems.push(sets[i].label + ":  " + v + (sets[i].unit === "%" ? " %" : ""));
        presetMap.push({ value: v, unit: sets[i].unit === "%" ? "%" : "pt" });
      }
    }
  })();
  var ddPreset = rowR.add("dropdownlist", undefined, presetItems); ddPreset.selection = 0; ddPreset.preferredSize.width = 190;

  /* ---- which corners ---- */
  var gC = w.add("panel", undefined, "Corners"); gC.orientation = "column"; gC.alignChildren = ["fill", "top"]; gC.margins = [12, 14, 12, 10];
  var rowCM = gC.add("group"); rowCM.orientation = "row"; rowCM.alignChildren = ["left", "center"];
  var rbAll = rowCM.add("radiobutton", undefined, "All corners");
  var rbPick = rowCM.add("radiobutton", undefined, "Only these corners:");
  rbAll.value = true;
  var cbPer = rowCM.add("checkbox", undefined, "Different size per corner");
  var CORNERS = ["tl", "tr", "bl", "br"], CNAMES = { tl: "Top left", tr: "Top right", bl: "Bottom left", br: "Bottom right" };
  var cb = {}, et = {}, focusCorner = "tl";
  var gridC = gC.add("group"); gridC.orientation = "column"; gridC.alignChildren = ["left", "top"];
  (function () {
    var row;
    for (var i = 0; i < CORNERS.length; i++) {
      if (i % 2 === 0) { row = gridC.add("group"); row.orientation = "row"; row.alignChildren = ["left", "center"]; }
      var c = CORNERS[i];
      var g = row.add("group"); g.orientation = "row"; g.alignChildren = ["left", "center"]; g.preferredSize.width = 230;
      cb[c] = g.add("checkbox", undefined, CNAMES[c]); cb[c].value = true; cb[c].preferredSize.width = 110;
      et[c] = g.add("edittext", undefined, "2.5"); et[c].characters = 6;
    }
  })();
  var stCHint = gC.add("statictext", undefined, "Tip: you can also Direct-Select (A) any anchors on any shape to round only those.");

  /* ---- smoothing (smooth mode) ---- */
  var gS = w.add("panel", undefined, "Corner smoothing"); gS.orientation = "column"; gS.alignChildren = ["fill", "top"]; gS.margins = [12, 14, 12, 10];
  var rowS = gS.add("group"); rowS.orientation = "row"; rowS.alignChildren = ["left", "center"];
  var slS = rowS.add("slider", undefined, 60, 0, 100); slS.preferredSize.width = 300;
  var etS = rowS.add("edittext", undefined, "60"); etS.characters = 4; rowS.add("statictext", undefined, "%");
  var rowSB = gS.add("group"); rowSB.orientation = "row";
  var bS0 = rowSB.add("button", undefined, "Circle  0%"); var bS60 = rowSB.add("button", undefined, "iOS  60%"); var bS100 = rowSB.add("button", undefined, "Max  100%");
  rowSB.add("statictext", undefined, "   0% = Illustrator's normal round corner.");

  /* ---- handle factor (cubic mode) ---- */
  var gK = w.add("panel", undefined, "Curve fullness (handle length as % of corner length)"); gK.orientation = "column"; gK.alignChildren = ["fill", "top"]; gK.margins = [12, 14, 12, 10];
  var rowK = gK.add("group"); rowK.orientation = "row"; rowK.alignChildren = ["left", "center"];
  var slK = rowK.add("slider", undefined, 69.2, 40, 100); slK.preferredSize.width = 300;
  var etK = rowK.add("edittext", undefined, "69.2"); etK.characters = 5; rowK.add("statictext", undefined, "%");
  var rowKB = gK.add("group"); rowKB.orientation = "row";
  var bKc = rowKB.add("button", undefined, "Circle  55.2%"); var bKl = rowKB.add("button", undefined, "Full  69.2%"); var bKs = rowKB.add("button", undefined, "Squarer  80%");
  gK.visible = false;

  /* ---- footer ---- */
  var rowF = w.add("group"); rowF.orientation = "row"; rowF.alignChildren = ["left", "center"];
  var cbPrev = rowF.add("checkbox", undefined, "Live preview"); cbPrev.value = true;
  var stInfo = rowF.add("statictext", undefined, "", { truncate: "end" }); stInfo.preferredSize.width = 330;
  var rowB = w.add("group"); rowB.orientation = "row"; rowB.alignment = "right";
  var bReset = rowB.add("button", undefined, "Reset to sharp corners");
  var bCancel = rowB.add("button", undefined, "Cancel", { name: "cancel" });
  var bOK = rowB.add("button", undefined, "Apply", { name: "ok" });

  /* ---- logic ---- */
  function cornerValue(c) {
    if (!cb[c].value) return 0;
    if (cbPer.value) { var v = parseFloat(et[c].text); return v > 0 ? v : 0; }
    return state.radius;
  }
  function optString() {
    var s = "mode=" + state.mode + "&radius=" + state.radius + "&unit=" + (state.relative ? "pt" : state.unit) +
      "&relative=" + (state.relative ? 1 : 0) + "&smoothing=" + state.smoothing + "&k=" + state.k;
    if (rbPick.value) {
      var parts = [];
      for (var i = 0; i < CORNERS.length; i++) parts.push(CORNERS[i] + ":" + cornerValue(CORNERS[i]));
      s += "&corners=" + parts.join(",");
    }
    return s;
  }
  function syncCorners() {
    var pick = rbPick.value;
    cbPer.enabled = pick;
    for (var i = 0; i < CORNERS.length; i++) {
      var c = CORNERS[i];
      cb[c].enabled = pick;
      et[c].enabled = pick && cbPer.value && cb[c].value;
      if (!(pick && cbPer.value)) et[c].text = etR.text;
    }
    etR.enabled = !(pick && cbPer.value);
  }
  function parseResult(res) {
    var o = {}, parts = res.split("|"); o.status = parts[0];
    for (var i = 1; i < parts.length; i++) { var kv = parts[i].split("="); o[kv[0]] = kv[1]; }
    if (o.status === "err") o.message = parts.slice(1).join("|");
    return o;
  }
  function readFields() {
    var r = parseFloat(etR.text); if (!(r > 0)) r = 0;
    state.radius = r;
    var ui = ddUnit.selection ? ddUnit.selection.index : 0;
    state.relative = ui === 4;
    state.unit = ["pt", "px", "mm", "in", "pt"][ui];
    state.smoothing = SC.clamp(slS.value / 100, 0, 1);
    state.k = SC.clamp(slK.value / 100, 0.1, 1.5);
    state.mode = rbCubic.value ? "cubic" : "smooth";
  }
  function refresh(force) {
    if (busy) return; busy = true;
    try {
      readFields();
      if (!cbPrev.value && !force) { stInfo.text = "Preview off — press Apply."; return; }
      if (!rbPick.value && !(state.radius > 0)) { stInfo.text = "Enter a radius > 0"; return; }
      var r = parseResult(SC.AI.run(optString()));
      if (r.status === "ok") {
        stInfo.text = r.paths + " path" + (r.paths == 1 ? "" : "s") + " · " + r.corners + " corner" + (r.corners == 1 ? "" : "s") + " rounded" +
          (parseInt(r.sharp, 10) > 0 ? " · " + r.sharp + " left sharp" : "") +
          (parseInt(r.skipped, 10) > 0 ? " · " + r.skipped + " skipped (curved/too short)" : "");
      } else stInfo.text = r.message;
    } catch (e) { stInfo.text = "Error: " + e.message; }
    finally { busy = false; }
  }
  function setMode(m) {
    state.mode = m; gS.visible = (m === "smooth"); gK.visible = (m === "cubic"); w.layout.layout(true); refresh();
  }
  rbSmooth.onClick = function () { setMode("smooth"); };
  rbCubic.onClick = function () { setMode("cubic"); };
  etR.onChange = function () { ddPreset.selection = 0; syncCorners(); refresh(); };
  rbAll.onClick = function () { syncCorners(); refresh(); };
  rbPick.onClick = function () { syncCorners(); refresh(); };
  cbPer.onClick = function () { syncCorners(); refresh(); };
  (function () {
    for (var i = 0; i < CORNERS.length; i++) (function (c) {
      cb[c].onClick = function () { focusCorner = c; syncCorners(); refresh(); };
      et[c].onActivate = function () { focusCorner = c; };
      et[c].onChange = function () { focusCorner = c; refresh(); };
    })(CORNERS[i]);
  })();
  ddUnit.onChange = function () { refresh(); };
  ddPreset.onChange = function () {
    var m = presetMap[ddPreset.selection.index]; if (!m) return;
    // keep the unit you're in; only switch into / out of "% of shortest side"
    if (m.unit === "%") ddUnit.selection = 4;
    else if (ddUnit.selection && ddUnit.selection.index === 4) ddUnit.selection = 0;
    if (rbPick.value && cbPer.value) { et[focusCorner].text = String(m.value); cb[focusCorner].value = true; }
    else etR.text = String(m.value);
    syncCorners();
    refresh();
  };
  slS.onChanging = function () { etS.text = Math.round(slS.value); refresh(); };
  slS.onChange = function () { etS.text = Math.round(slS.value); refresh(); };
  etS.onChange = function () { var v = parseFloat(etS.text); if (isNaN(v)) v = 60; slS.value = SC.clamp(v, 0, 100); etS.text = Math.round(slS.value); refresh(); };
  bS0.onClick = function () { slS.value = 0; etS.text = "0"; refresh(); };
  bS60.onClick = function () { slS.value = 60; etS.text = "60"; refresh(); };
  bS100.onClick = function () { slS.value = 100; etS.text = "100"; refresh(); };
  slK.onChanging = function () { etK.text = (Math.round(slK.value * 10) / 10).toFixed(1); refresh(); };
  slK.onChange = slK.onChanging;
  etK.onChange = function () { var v = parseFloat(etK.text); if (isNaN(v)) v = 69.2; slK.value = SC.clamp(v, 40, 100); etK.text = (Math.round(slK.value * 10) / 10).toFixed(1); refresh(); };
  bKc.onClick = function () { slK.value = 55.2; etK.text = "55.2"; refresh(); };
  bKl.onClick = function () { slK.value = 69.2; etK.text = "69.2"; refresh(); };
  bKs.onClick = function () { slK.value = 80; etK.text = "80.0"; refresh(); };
  cbPrev.onClick = function () { if (cbPrev.value) refresh(); else { SC.AI.previewCancel(); stInfo.text = "Preview off — press Apply."; } };
  bReset.onClick = function () {
    var r = parseResult(SC.AI.resetCorners());
    stInfo.text = (r.status === "ok") ? (r.reset + " of " + r.total + " path(s) reset to their stored sharp corners") : r.message;
  };
  bOK.onClick = function () { readFields(); if (!SC.AI.hasPreview() || !cbPrev.value) refresh(true); SC.AI.commit(); w.close(1); };
  bCancel.onClick = function () { SC.AI.previewCancel(); w.close(0); };
  w.onClose = function () { if (SC.AI.hasPreview()) SC.AI.previewCancel(); };

  // prime the info line with what is selected
  (function () {
    var r = parseResult(info0);
    stInfo.text = r.paths + " path(s) selected · " + r.corners + " sharp corner(s)" + (parseInt(r.stored, 10) > 0 ? " · " + r.stored + " already smooth-cornered (editable)" : "") +
      (parseInt(r.scaled, 10) > 0 ? " · " + r.scaled + " scaled (corners get rebuilt)" : "");
  })();

  /* start from the selected shape's own settings, if it has any */
  (function () {
    var r = parseResult(SC.AI.inspect());
    if (r.status !== "ok" || r.has !== "1") return;
    var cubic = r.mode !== "smooth";
    rbCubic.value = cubic; rbSmooth.value = !cubic;
    gS.visible = !cubic; gK.visible = cubic;
    if (cubic) { var kv = Math.round(parseFloat(r.k) * 1000) / 10; slK.value = kv; etK.text = kv.toFixed(1); }
    else { var sv = Math.round(parseFloat(r.smoothing) * 100); slS.value = sv; etS.text = String(sv); }
    var ui = { pt: 0, px: 1, mm: 2, "in": 3, "%": 4 }[r.unit]; ddUnit.selection = ui == null ? 0 : ui;
    var C = ["tl", "tr", "bl", "br"], i;
    if (r.all === "1") {
      rbAll.value = true; rbPick.value = false; cbPer.value = false;
      etR.text = r.radius;
    } else {
      rbAll.value = false; rbPick.value = true;
      var first = null, same = true;
      for (i = 0; i < C.length; i++) {
        var v = parseFloat(r[C[i]]) || 0;
        cb[C[i]].value = v > 0; et[C[i]].text = String(v);
        if (v > 0) { if (first === null) first = v; else if (Math.abs(v - first) > 1e-3) same = false; }
      }
      cbPer.value = !same;
      if (first !== null) etR.text = String(first);
    }
    stInfo.text = "Showing this shape's corners" + (r.mixed === "1" ? " (mixed — using the first corner's style)" : "");
  })();
  syncCorners();
  w.center();
  refresh();
  w.show();
})();
