// Fieldstate weekly video: HyperFrames runtime (inlined into index.html by
// hyperframes/generate.mjs). The generator writes every element and its
// timing into the markup as data attributes; this file only turns those into
// one paused GSAP timeline, registered as window.__timelines.main.
//
// Rules (HyperFrames contract): everything is a function of timeline time; no
// clock, no random, no network, no requestAnimationFrame. Motion follows the
// Remotion pilot (src/WeeklyVideo.tsx): the same ease (bezier .22,1,.36,1),
// the same springs (solved in closed form), the same frame offsets.
(function () {
  "use strict";
  var DATA = JSON.parse(document.getElementById("fs-data").textContent);
  var FPS = DATA.fps;
  var tl = gsap.timeline({ paused: true });

  // ── easing ──────────────────────────────────────────────────────────────
  // cubic-bezier(x1, y1, x2, y2) as an ease function (Newton + bisection).
  function bezier(x1, y1, x2, y2) {
    var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    function sx(t) { return ((ax * t + bx) * t + cx) * t; }
    function sy(t) { return ((ay * t + by) * t + cy) * t; }
    function dx(t) { return (3 * ax * t + 2 * bx) * t + cx; }
    function solve(x) {
      var t = x, i, d, x2;
      for (i = 0; i < 8; i++) {
        x2 = sx(t) - x;
        if (Math.abs(x2) < 1e-7) return t;
        d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= x2 / d;
      }
      var lo = 0, hi = 1;
      t = x;
      while (lo < hi) {
        x2 = sx(t);
        if (Math.abs(x2 - x) < 1e-7) return t;
        if (x > x2) lo = t; else hi = t;
        t = (hi - lo) / 2 + lo;
        if (hi - lo < 1e-9) break;
      }
      return t;
    }
    return function (p) { return p <= 0 ? 0 : p >= 1 ? 1 : sy(solve(p)); };
  }
  var EASE = bezier(0.22, 1, 0.36, 1);

  // Remotion spring({ damping, stiffness, mass }) from 0 to 1, as an ease over
  // its settle time (closed-form damped oscillator, released at rest).
  function spring(damping, stiffness, mass) {
    stiffness = stiffness || 140;
    mass = mass || 0.7;
    var w0 = Math.sqrt(stiffness / mass);
    var zeta = damping / (2 * Math.sqrt(stiffness * mass));
    var x;
    if (zeta < 1) {
      var wd = w0 * Math.sqrt(1 - zeta * zeta);
      x = function (t) {
        return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
      };
    } else {
      x = function (t) { return 1 - Math.exp(-w0 * t) * (1 + w0 * t); };
    }
    var settle = Math.log(2000) / (zeta < 1 ? zeta * w0 : w0);
    return { dur: settle, ease: function (p) { return p >= 1 ? 1 : x(p * settle); } };
  }

  function num(el, name, dflt) {
    var v = el.getAttribute(name);
    return v === null || v === "" ? dflt : Number(v);
  }
  function fmt(v, decimals) {
    return decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString("en-US");
  }

  // ── per-element motion, declared in the markup ──────────────────────────
  // data-a: in | pop | stamp | count | dot | pulse | kb | hl | push
  // data-at: frames from the scene's start. Others per kind (data-d, data-x,
  // data-y, ...). hl and push are the v3 page's.
  function animate(el, s0, dur) {
    var kind = el.getAttribute("data-a");
    var at = s0 + num(el, "data-at", 0) / FPS;
    if (kind === "in") {
      tl.fromTo(
        el,
        { opacity: 0, x: num(el, "data-x", 0), y: num(el, "data-y", 0) },
        { opacity: 1, x: 0, y: 0, duration: num(el, "data-d", 18) / FPS, ease: EASE },
        at,
      );
    } else if (kind === "pop") {
      var sp = spring(num(el, "data-damp", 14));
      var from = { opacity: 0, x: num(el, "data-x", 0), y: num(el, "data-y", 0) };
      var to = { opacity: 1, x: 0, y: 0, duration: sp.dur, ease: sp.ease };
      if (el.hasAttribute("data-scale")) {
        from.scale = num(el, "data-scale", 1);
        to.scale = 1;
      }
      tl.fromTo(el, from, to, at);
    } else if (kind === "stamp") {
      var st = spring(num(el, "data-damp", 9));
      tl.fromTo(
        el,
        { opacity: 0, scale: 0.6, rotation: -8 },
        { opacity: 1, scale: 1, rotation: 0, duration: st.dur, ease: st.ease },
        at,
      );
    } else if (kind === "count") {
      var to2 = num(el, "data-to", 0);
      var dec = num(el, "data-dec", 0);
      var box = { v: 0 };
      el.textContent = fmt(0, dec);
      tl.to(
        box,
        {
          v: to2,
          duration: num(el, "data-d", 30) / FPS,
          ease: EASE,
          onUpdate: function () { el.textContent = fmt(box.v, dec); },
        },
        at,
      );
    } else if (kind === "dot" || kind === "pulse") {
      var sd = spring(num(el, "data-damp", kind === "dot" ? 10 : 9));
      tl.fromTo(el, { scale: 0 }, { scale: 1, duration: sd.dur, ease: sd.ease }, at);
    } else if (kind === "label") {
      var sl = spring(num(el, "data-damp", 9));
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: sl.dur, ease: sl.ease }, at);
    } else if (kind === "hl") {
      // Highlighter: the marker band sweeps across the quote.
      tl.fromTo(
        el,
        { backgroundSize: "0% 100%" },
        { backgroundSize: "100% 100%", duration: num(el, "data-d", 40) / FPS, ease: "power2.inOut" },
        at,
      );
    } else if (kind === "push") {
      // Camera push-in: a slow, linear move from data-at to the scene's end.
      var rest = Math.max(1 / FPS, s0 + dur - at);
      tl.fromTo(
        el,
        { scale: 1, x: 0, y: 0 },
        { scale: num(el, "data-scale", 1.07), x: num(el, "data-x", 0), y: num(el, "data-y", -40), duration: rest, ease: "none" },
        at,
      );
    } else if (kind === "kb") {
      // Ken Burns: interpolate(frame, [0, 16 s], [1.04, 1.16]) and x 0 → -3 %.
      tl.fromTo(el, { scale: 1.04, xPercent: 0 }, { scale: 1.16, xPercent: -3, duration: 16, ease: "none" }, at);
    }
  }

  // The county map draws on west to east; lit counties fill gold.
  function mapSweep(svg, s0) {
    var drawAt = num(svg, "data-draw-at", 0);
    var paths = svg.querySelectorAll("path[data-sx]");
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      var at = s0 + (drawAt + (num(p, "data-sx", 0) / 100) * 30) / FPS;
      tl.fromTo(p, { opacity: 0 }, { opacity: 1, duration: 14 / FPS, ease: EASE }, at);
      if (p.hasAttribute("data-lit")) {
        tl.fromTo(
          p,
          { attr: { "fill-opacity": 0 } },
          { attr: { "fill-opacity": 0.78 }, duration: 14 / FPS, ease: "none" },
          s0 + (drawAt + 20) / FPS,
        );
      } else {
        tl.fromTo(
          p,
          { attr: { "stroke-opacity": 0 } },
          { attr: { "stroke-opacity": 0.3 }, duration: 14 / FPS, ease: EASE },
          at,
        );
      }
    }
  }

  // Continuous effects (twinkling dots, pulse rings) from the scene's time.
  function ticker(scene, s0, dur) {
    var twinkles = scene.querySelectorAll("[data-twinkle]");
    var rings = scene.querySelectorAll("[data-ring-at]");
    if (!twinkles.length && !rings.length) return;
    var clock = { t: 0 };
    tl.fromTo(
      clock,
      { t: 0 },
      {
        t: dur,
        duration: dur,
        ease: "none",
        onUpdate: function () {
          var f = clock.t * FPS;
          for (var i = 0; i < twinkles.length; i++) {
            var n = num(twinkles[i], "data-twinkle", 0);
            twinkles[i].style.opacity = String(0.55 + 0.45 * Math.sin(f / 12 + n));
          }
          for (var j = 0; j < rings.length; j++) {
            var at = num(rings[j], "data-ring-at", 0);
            if (f < at) {
              rings[j].style.opacity = "0";
              continue;
            }
            var k = ((f - at) % 48) / 48;
            rings[j].style.opacity = String(1 - k);
            rings[j].style.transform = "scale(" + (0.3 + k * 1.2) + ")";
          }
        },
      },
      s0,
    );
  }

  // ── scenes ──────────────────────────────────────────────────────────────
  var scenes = document.querySelectorAll(".scene");
  for (var i = 0; i < scenes.length; i++) {
    var sc = scenes[i];
    var s0 = num(sc, "data-start", 0);
    var dur = num(sc, "data-duration", 1);
    var fade = sc.querySelector(".fade");
    // Fade: in over 12 frames, out over the last 10 (as the pilot).
    tl.fromTo(fade, { opacity: 0 }, { opacity: 1, duration: 12 / FPS, ease: EASE }, s0);
    tl.to(fade, { opacity: 0, duration: 10 / FPS, ease: "none" }, s0 + dur - 10 / FPS);
    var els = sc.querySelectorAll("[data-a]");
    for (var e = 0; e < els.length; e++) animate(els[e], s0, dur);
    var maps = sc.querySelectorAll("svg[data-draw-at]");
    for (var m = 0; m < maps.length; m++) mapSweep(maps[m], s0);
    ticker(sc, s0, dur);
  }

  // Captions: each group fades in over 0.18 s from 0.05 s before its cue.
  var caps = document.querySelectorAll(".cap-group");
  for (var c = 0; c < caps.length; c++) {
    var g = caps[c];
    tl.fromTo(
      g,
      { opacity: 0 },
      { opacity: 1, duration: 0.18, ease: "none" },
      num(g, "data-start", 0),
    );
  }

  // The drifting navy wash behind everything (the pilot's three glows).
  var wash = document.getElementById("wash");
  var w = { t: 0 };
  tl.fromTo(
    w,
    { t: 0 },
    {
      t: DATA.duration,
      duration: DATA.duration,
      ease: "none",
      onUpdate: function () {
        var t = w.t;
        var a = 20 + Math.sin(t / 6) * 8;
        var b = 78 + Math.cos(t / 7) * 8;
        var cc = 60 + Math.sin(t / 5 + 1) * 10;
        wash.style.background =
          "radial-gradient(55% 50% at " + a + "% 30%, rgba(124,92,255,.30), transparent 62%)," +
          "radial-gradient(45% 45% at " + b + "% 18%, rgba(240,166,43,.24), transparent 62%)," +
          "radial-gradient(45% 40% at " + cc + "% 85%, rgba(14,133,96,.22), transparent 62%), #0a2540";
      },
    },
    0,
  );

  window.__timelines = window.__timelines || {};
  window.__timelines.main = tl;
})();
