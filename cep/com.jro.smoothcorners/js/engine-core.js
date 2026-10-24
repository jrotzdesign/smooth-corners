/*  Smooth Corners for Adobe Illustrator — v1.4.0
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

SC.VERSION = "1.4.0";
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
