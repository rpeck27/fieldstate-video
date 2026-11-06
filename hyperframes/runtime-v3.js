// Fieldstate weekly video v3: motion kinds the v3 scenes add (inlined by
// hyperframes/generate.mjs after runtime.js, only into v3 compositions, so a
// v2 composition stays byte-for-byte what it was). Same contract as
// runtime.js: a function of timeline time only, added to the one paused
// timeline runtime.js registered as window.__timelines.main.
//
//   hl    the highlighter: the marker band sweeps across the quote
//         (background-size 0 → 100 %), as the approved sample
//   push  the camera push-in on the page: scale 1 → data-scale, y 0 → data-y,
//         linear from data-at to the scene's end
//   draw  a rule or track drawn on left to right (scaleX 0 → 1)
//   lit   the quick round's highlight: the card being read at full opacity
//         and lifted, the others dimmed (data-first, data-on, data-off,
//         data-lift px, default 12); also the long road's stations, dim
//         until their own line is read
//   glow  an isometric figure's lit layer (lib/iso.mjs): fades in at
//         data-on, out at data-off (-1: stays), over the lit step
(function () {
  "use strict";
  var DATA = JSON.parse(document.getElementById("fs-data").textContent);
  var FPS = DATA.fps;
  var tl = window.__timelines.main;
  var DIM = 0.35;

  function num(el, name, dflt) {
    var v = el.getAttribute(name);
    return v === null || v === "" ? dflt : Number(v);
  }

  var scenes = document.querySelectorAll(".scene");
  for (var i = 0; i < scenes.length; i++) {
    var sc = scenes[i];
    var s0 = num(sc, "data-start", 0);
    var dur = num(sc, "data-duration", 1);
    var els = sc.querySelectorAll("[data-a]");
    for (var e = 0; e < els.length; e++) {
      var el = els[e];
      var kind = el.getAttribute("data-a");
      var at = s0 + num(el, "data-at", 0) / FPS;
      if (kind === "hl") {
        tl.fromTo(
          el,
          { backgroundSize: "0% 100%" },
          { backgroundSize: "100% 100%", duration: num(el, "data-d", 40) / FPS, ease: "power2.inOut" },
          at,
        );
      } else if (kind === "push") {
        tl.fromTo(
          el,
          { scale: 1, x: 0, y: 0 },
          {
            scale: num(el, "data-scale", 1.07),
            x: num(el, "data-x", 0),
            y: num(el, "data-y", -40),
            duration: Math.max(1 / FPS, s0 + dur - at),
            ease: "none",
          },
          at,
        );
      } else if (kind === "draw") {
        tl.fromTo(el, { scaleX: 0 }, { scaleX: 1, duration: num(el, "data-d", 24) / FPS, ease: "power2.out" }, at);
      } else if (kind === "lit") {
        var first = s0 + num(el, "data-first", 0) / FPS;
        var on = s0 + num(el, "data-on", 0) / FPS;
        var off = num(el, "data-off", -1);
        var step = 8 / FPS;
        var lift = -num(el, "data-lift", 12);
        if (on > first + 1e-6) {
          tl.fromTo(el, { opacity: 1, y: 0 }, { opacity: DIM, y: 0, duration: step, ease: "none" }, first);
          tl.to(el, { opacity: 1, y: lift, duration: step, ease: "none" }, on);
        } else {
          tl.fromTo(el, { opacity: 1, y: 0 }, { opacity: 1, y: lift, duration: step, ease: "none" }, on);
        }
        if (off >= 0) tl.to(el, { opacity: DIM, y: 0, duration: step, ease: "none" }, s0 + off / FPS);
      } else if (kind === "glow") {
        var gStep = 8 / FPS;
        var gOff = num(el, "data-off", -1);
        tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: gStep, ease: "none" }, s0 + num(el, "data-on", 0) / FPS);
        if (gOff >= 0) tl.to(el, { opacity: 0, duration: gStep, ease: "none" }, s0 + gOff / FPS);
      }
    }
  }
})();
