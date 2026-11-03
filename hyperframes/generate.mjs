// Fieldstate weekly video: script → HyperFrames project.
//
// Input: the engine's script (fieldstate.weekly_video.v2) and the timeline
// lib/timeline.mjs builds from it (scene lengths from the voice clips, the
// caption cues). Output: a self-contained HyperFrames project folder:
//
//   index.html          one composition, every element written out, timing
//                       as data attributes, runtime.js inlined
//   captions.vtt        our own captions (lib/captions.mjs), the same file
//                       that ships to R2 as captions_url
//   transcript.json     captions.vtt imported by `hyperframes transcribe`
//   assets/             fonts, GSAP, photos, the voice clips
//
// Nothing in the project is fetched at render time: the county map is baked
// from us-atlas for the script's state (hyperframes/geo.mjs), fonts and GSAP
// come from pinned npm packages, photos and audio are copied in. The template
// is this file plus runtime.js; a week changes only the script.
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { countyFor, stateMap } from "./geo.mjs";
import { PHOTOS, photoFor } from "./photos.mjs";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

export const W = 1920;
export const H = 1080;

// The site's tokens, as the Remotion pilot (src/theme.ts).
export const C = {
  navy: "#0a2540",
  navy2: "#0f2e4f",
  card: "#ffffff",
  ink: "#0a2540",
  body: "#425466",
  muted: "#697386",
  line: "#e6ebf1",
  live: "#f0a62b",
  doc: "#0e8560",
  docSoft: "#effbf6",
  deny: "#b3352c",
  denySoft: "#fff3f2",
  reported: "#7c5cff",
  reportedSoft: "#f3f0ff",
  white: "#ffffff",
  dim: "rgba(255,255,255,.72)",
};

const OUTCOME = {
  approved: "Approved",
  approved_with_conditions: "Approved with conditions",
  denied: "Denied",
  withdrawn: "Withdrawn",
  failed: "Voted down",
};

const FONT_FILES = [
  ["@fontsource/geist/files/geist-latin-400-normal.woff2", "Geist", 400, "normal"],
  ["@fontsource/geist/files/geist-latin-500-normal.woff2", "Geist", 500, "normal"],
  ["@fontsource/geist/files/geist-latin-600-normal.woff2", "Geist", 600, "normal"],
  ["@fontsource/geist/files/geist-latin-700-normal.woff2", "Geist", 700, "normal"],
  ["@fontsource/newsreader/files/newsreader-latin-500-normal.woff2", "Newsreader", 500, "normal"],
  ["@fontsource/newsreader/files/newsreader-latin-600-normal.woff2", "Newsreader", 600, "normal"],
  ["@fontsource/newsreader/files/newsreader-latin-500-italic.woff2", "Newsreader", 500, "italic"],
];

// ── small helpers ─────────────────────────────────────────────────────────

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const sec = (frames, fps) => Number((frames / fps).toFixed(4));

function cap1(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function asItem(item) {
  const it = typeof item === "string" ? { text: item } : item || {};
  return { ...it, text: cap1(it.text) };
}

function list(v) {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}

function mapKeys(s) {
  const f = list(s.fips);
  if (f.length) return f;
  const names = (s.counties ?? []).filter(Boolean);
  if (names.length) return names;
  return s.county ? [s.county] : [];
}

function stripState(place) {
  return String(place ?? "").replace(/, [A-Z]{2}$/, "");
}

/** When each of `n` cards lands (frames from the scene start), as the pilot. */
export function cardTimes(n, scene, fps) {
  const start = scene.audioFrom + Math.round(fps * 0.9);
  const span = Math.max(fps, scene.durationInFrames - start - fps * 1.4);
  return Array.from({ length: n }, (_, i) => start + Math.round((span * i) / Math.max(1, n)));
}

/** Motion attributes for the runtime (hyperframes/runtime.js). */
function a(kind, at, extra = {}) {
  const attrs = { "data-a": kind, "data-at": Math.round(at) };
  for (const [k, v] of Object.entries(extra)) attrs[`data-${k}`] = v;
  return Object.entries(attrs)
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(" ");
}

// ── pieces ────────────────────────────────────────────────────────────────

class Ids {
  constructor(prefix) {
    this.prefix = prefix;
    this.n = 0;
  }
  next(name) {
    this.n += 1;
    return `${this.prefix}-${name}-${this.n}`;
  }
}

function wordmark(size) {
  return `<span class="wordmark" style="font-size:${size}px">field<span class="live">state</span></span>`;
}

function kicker(ids, text, at = 0, color = C.live) {
  return `<div id="${ids.next("kicker")}" class="kicker" style="color:${color}" ${a("in", at, { y: 16 })}>${esc(text)}</div>`;
}

function chip(text) {
  return `<span class="chip">${esc(text)}</span>`;
}

function tag(tier = "Documented") {
  const reported = tier !== "Documented";
  const tone = reported ? [C.reported, C.reportedSoft, "#ddd4ff"] : [C.doc, C.docSoft, "#c9eedf"];
  return `<span class="tag" style="color:${tone[0]};background:${tone[1]};border-color:${tone[2]}"><span class="tag-dot" style="background:${tone[0]}"></span>${esc(tier)}</span>`;
}

/**
 * The county map. opts: width, maxHeight, highlight (keys), dots (FIPS),
 * pulses [{key,label,at}], drawAt, dotsAt, dim. Frames are from the scene
 * start. The map fits a box: `width` wide (as the pilot laid out North
 * Carolina, a wide state) and no taller than `maxHeight`; a tall state
 * (Texas) is scaled down and centred in the same box.
 */
export function mapBox(map, width, maxHeight = Infinity) {
  const [, , vbW, vbH] = map.viewBox.split(" ").map(Number);
  const h = (width * vbH) / vbW;
  if (h <= maxHeight) return { boxWidth: width, width, height: h, left: 0 };
  const w = (maxHeight * vbW) / vbH;
  return { boxWidth: width, width: w, height: maxHeight, left: (width - w) / 2 };
}

function stateMapSvg(ids, map, opts) {
  const { highlight = [], dots = [], pulses = [], drawAt = 0, dotsAt = 18, dim = false } = opts;
  const box = mapBox(map, opts.width, opts.maxHeight);
  const width = Number(box.width.toFixed(1));
  const height = box.height;
  const lit = new Set(highlight.map((k) => countyFor(map, k)?.id).filter(Boolean));
  const base = dim ? "rgba(255,255,255,.035)" : "rgba(255,255,255,.06)";
  const paths = map.counties
    .map((c) => {
      const on = lit.has(c.id);
      return on
        ? `<path d="${c.d}" data-sx="${c.x}" data-lit="1" fill="${C.live}" fill-opacity="0" stroke="${C.live}" stroke-width="1.6"/>`
        : `<path d="${c.d}" data-sx="${c.x}" fill="${base}" stroke="#ffffff" stroke-opacity="0" stroke-width="0.7"/>`;
    })
    .join("");
  const dotCounties = [...new Set(dots)].map((id) => map.counties.find((c) => c.id === id)).filter(Boolean);
  const dotEls = dotCounties
    .map((c, i) => {
      const at = dotsAt + (c.x / 100) * 26 + (i % 7);
      const tw = i % 5 === 2 ? ` data-twinkle="${i}"` : "";
      return `<div id="${ids.next("dot")}" class="dot" style="left:${c.x}%;top:${c.y}%"${tw} ${a("dot", at)}></div>`;
    })
    .join("");
  const pulseEls = pulses
    .map((p, i) => {
      const c = countyFor(map, p.key);
      if (!c) return "";
      const at = p.at ?? 12 + i * 10;
      const label = p.label
        ? `<div id="${ids.next("plabel")}" class="pulse-label" style="left:${c.x}%;top:${c.y}%;margin-left:${c.x > 70 ? -260 : 22}px;margin-top:${i % 2 ? 26 : -54}px" ${a("label", at)}>${esc(p.label)}</div>`
        : "";
      return (
        `<div class="pulse-ring" style="left:${c.x}%;top:${c.y}%;opacity:0" data-ring-at="${Math.round(at)}"></div>` +
        `<div id="${ids.next("pulse")}" class="pulse-core" style="left:${c.x}%;top:${c.y}%" ${a("pulse", at)}></div>` +
        label
      );
    })
    .join("");
  const mapDiv =
    `<div class="map" style="width:${width}px;height:${height.toFixed(1)}px">` +
    `<svg viewBox="${map.viewBox}" width="${width}" height="${height.toFixed(1)}" data-draw-at="${drawAt}">${paths}</svg>` +
    dotEls +
    pulseEls +
    `</div>`;
  // A wide state fills its slot: the markup is exactly the pilot's. A
  // height-capped (tall) state sits centred in a slot that keeps the full
  // slot width, so it lines up the same whether its scene anchors the map
  // left, right (title, legislature) or in a centring flex box (outro).
  if (!box.left) return mapDiv;
  return `<div class="map-slot" style="width:${box.boxWidth}px;height:${height.toFixed(1)}px;display:flex;justify-content:center">${mapDiv}</div>`;
}

/** Big figure that counts up ("4.25 acres", "180 townhomes", "5–2"). */
function figure(ids, text, at) {
  const m = String(text).match(/^([0-9][0-9,]*(?:\.[0-9]+)?)\s*(.*)$/);
  const n = m ? Number(m[1].replace(/,/g, "")) : null;
  const rest = m ? m[2] : "";
  const decimals = m?.[1].includes(".") ? m[1].split(".")[1].length : 0;
  const value =
    n != null && Number.isFinite(n)
      ? `<div id="${ids.next("fig")}" class="fig-n" ${a("count", at, { to: n, dec: decimals, d: 30 })}>0</div>`
      : `<div class="fig-n">${esc(text)}</div>`;
  return `<div class="figure">${value}${rest ? `<div class="fig-rest">${esc(rest)}</div>` : ""}</div>`;
}

function caseCard(ids, item, at) {
  const out = item.outcome ? OUTCOME[item.outcome] ?? "Decided" : null;
  const ok = item.outcome === "approved" || item.outcome === "approved_with_conditions";
  const head = [item.kind_label, item.place_short].filter(Boolean).join(" · ");
  const stamp = out
    ? `<div id="${ids.next("stamp")}" class="stamp" style="color:${ok ? C.doc : C.deny};background:${ok ? C.docSoft : C.denySoft};border-color:${ok ? C.doc : C.deny}" ${a("stamp", at + 20)}>${esc(out)}${item.tally ? ` ${esc(item.tally)}` : ""}</div>`
    : "";
  return (
    `<div id="${ids.next("card")}" class="case-card" ${a("pop", at, { x: 80, damp: 16 })}>` +
    `<div class="card-head"><span class="card-kicker">${esc(head)}</span>${tag(item.tier)}</div>` +
    (item.figure ? `<div style="margin-top:10px">${figure(ids, item.figure, at + 6)}</div>` : "") +
    `<div class="card-text" style="padding-right:${out ? 230 : 0}px">${esc(item.text)}</div>` +
    stamp +
    `</div>`
  );
}

function photoPane(photo, label, style) {
  return (
    `<div class="photo" style="${style}">` +
    `<img data-a="kb" data-at="0" src="assets/${esc(photo.file)}" alt="">` +
    `<div class="photo-shade"></div>` +
    (label ? `<div class="photo-label">${esc(label)}</div>` : "") +
    `<div class="photo-credit">${esc(photo.credit)}</div>` +
    `</div>`
  );
}

function counter(ids, value, label, at = 10) {
  return (
    `<div id="${ids.next("counter")}" ${a("in", at, { d: 14, y: 24 })}>` +
    `<div id="${ids.next("count")}" class="counter-n" ${a("count", at, { to: value, dec: 0, d: 40 })}>0</div>` +
    `<div class="counter-label">${esc(label)}</div>` +
    `</div>`
  );
}

// ── scenes ────────────────────────────────────────────────────────────────

function titleScene(ids, s, ctx) {
  const head = String(s.state_name || ctx.title).replace(/^This week in\s+/i, "");
  const words = head.split(" ");
  const headHtml = words.length > 1 ? `${esc(words[0])}<br>${esc(words.slice(1).join(" "))}` : esc(head);
  return (
    `<div class="abs" style="right:60px;top:260px">${stateMapSvg(ids, ctx.map, { width: 1080, maxHeight: 680, dots: s.read_fips ?? [], drawAt: 2, dotsAt: 30 })}</div>` +
    `<div class="abs" style="left:110px;top:300px;width:900px">` +
    kicker(ids, s.kicker || "This week in", 6) +
    `<div id="${ids.next("head")}" class="title-head" ${a("in", 6, { d: 24, y: 40 })}>${headHtml}</div>` +
    `<div id="${ids.next("sub")}" class="title-sub" ${a("in", 40, { d: 24, y: 20 })}>What local boards decided, and what comes next. From the public record.</div>` +
    `<div id="${ids.next("chips")}" class="chips" ${a("in", 70)}>` +
    (s.week_label ? chip(s.week_label) : "") +
    (s.places_read ? chip(`${s.places_read} places read nightly`) : "") +
    `</div></div>`
  );
}

function placePane(ids, s, keys, labels, ctx) {
  const photo = photoFor(s.place, s.county, ctx.state);
  if (photo) {
    ctx.photos.add(photo.file);
    return photoPane(photo, stripState(s.place), "left:0;top:0;width:1000px;height:1080px");
  }
  const pulses = keys.map((k, i) => ({ key: k, label: labels[i] ?? null, at: 14 + i * 16 }));
  return (
    `<div class="abs" style="left:50px;top:300px">` +
    stateMapSvg(ids, ctx.map, { width: 860, maxHeight: 580, highlight: keys, pulses, drawAt: 0, dim: true }) +
    `<div class="map-credit">Counties: U.S. Census Bureau, public domain</div>` +
    `</div>`
  );
}

function decisionsScene(ids, s, scene, ctx) {
  const items = (s.items ?? []).map(asItem);
  const at = cardTimes(items.length, scene, ctx.fps);
  const keys = mapKeys(s);
  const places = [...new Set(items.map((i) => i.place_short).filter(Boolean))];
  const headline = places.length === 1 ? places[0] : places.join(" · ");
  return (
    placePane(ids, s, keys, places, ctx) +
    `<div class="abs" style="left:980px;top:130px;width:860px">` +
    kicker(ids, s.kicker || "Decided", 4) +
    `<div class="dec-head">${esc(headline)}</div>` +
    `<div class="dec-note">${esc(s.note || "From the public record")}</div>` +
    `<div class="cards">${items.map((it, i) => caseCard(ids, it, at[i])).join("")}</div>` +
    `</div>`
  );
}

function storyScene(ids, s, ctx) {
  const keys = mapKeys(s);
  const labels = (s.places ?? []).map(stripState);
  return (
    `<div class="abs" style="left:60px;top:280px">` +
    stateMapSvg(ids, ctx.map, {
      width: 980,
      maxHeight: 640,
      highlight: keys,
      pulses: keys.map((key, i) => ({ key, label: labels[i], at: 20 + i * 14 })),
      dim: true,
    }) +
    `</div>` +
    `<div class="abs" style="left:1120px;right:100px;top:300px">` +
    kicker(ids, s.kicker || "This week", 2) +
    `<div id="${ids.next("story")}" class="story-head" ${a("in", 8, { d: 22, y: 30 })}>${esc(s.headline)}</div>` +
    (s.figure ? `<div style="margin-top:40px">${counter(ids, s.figure.value, s.figure.label, 26)}</div>` : "") +
    `</div>`
  );
}

function agendaScene(ids, s, scene, ctx) {
  const items = (s.items ?? []).map(asItem);
  const keys = mapKeys(s);
  const fps = ctx.fps;
  const at = scene.audioFrom + Math.round(fps * 0.4);
  const itemAt = cardTimes(items.length, scene, fps).map((x) => x + Math.round(fps * 0.8));
  const photo = photoFor(s.place, s.county, ctx.state);
  if (photo) ctx.photos.add(photo.file);
  const more = Math.max(0, (s.n_items ?? items.length) - items.length);
  const place = stripState(s.place);
  const rows = items
    .map(
      (it, i) =>
        `<div id="${ids.next("item")}" ${a("in", itemAt[i], { d: 16, x: 30 })}>` +
        `<div class="agenda-row"><span class="agenda-dot"></span><span>` +
        (it.kind_label && it.kind_label !== "Item" ? `<b>${esc(it.kind_label)}: </b>` : "") +
        `${esc(it.text)}</span></div>` +
        (it.figure ? `<div style="margin-left:24px;margin-top:6px">${figure(ids, it.figure, itemAt[i] + 6)}</div>` : "") +
        `</div>`,
    )
    .join("");
  const moreHtml =
    more > 0
      ? `<div id="${ids.next("more")}" class="agenda-more" ${a("in", (itemAt[itemAt.length - 1] ?? at) + 20, { y: 0 })}>+ ${more} more on the posted agenda</div>`
      : "";
  return (
    (photo ? `<div class="abs" style="inset:0;opacity:.32">${photoPane(photo, null, "left:0;top:0;width:1920px;height:1080px")}</div>` : "") +
    `<div class="abs" style="left:110px;top:100px">` +
    kicker(ids, s.kicker || "Coming up", 2) +
    `<div class="agenda-title">On the agenda</div></div>` +
    `<div class="abs" style="left:60px;top:380px">` +
    stateMapSvg(ids, ctx.map, { width: 700, maxHeight: 520, highlight: keys, pulses: keys.map((key) => ({ key, label: place, at: at + 12 })), dim: true }) +
    `</div>` +
    `<div class="abs" style="left:820px;top:260px;width:1020px;display:grid;gap:22px">` +
    `<div id="${ids.next("agenda")}" class="agenda-card" ${a("pop", at, { y: 60, damp: 15 })}>` +
    `<div class="agenda-when"><div class="when-day">${esc(s.when?.[0] ?? "")}</div><div class="when-date">${esc(s.when?.[1] ?? "")}</div>` +
    (s.time ? `<div class="when-time">${esc(s.time)}</div>` : "") +
    `</div><div class="agenda-body"><div class="agenda-place">${esc(place)} ${s.body ? `<span class="agenda-bodyname">${esc(s.body)}</span>` : ""}</div>` +
    `<div class="agenda-items">${rows}${moreHtml}</div></div></div>` +
    `<div class="agenda-src">From the posted agenda${s.time ? " · time as the agenda lists it" : ""}</div>` +
    `</div>`
  );
}

function legislatureScene(ids, s, ctx) {
  return (
    `<div class="abs" style="right:80px;top:260px;opacity:.5">${stateMapSvg(ids, ctx.map, { width: 900, maxHeight: 680, dim: true })}</div>` +
    `<div class="abs" style="left:140px;top:300px">` +
    kicker(ids, s.kicker || "The legislature") +
    (typeof s.count === "number"
      ? `<div style="margin-top:24px">${counter(ids, s.count, s.count === 1 ? "tracked bill moved this week" : "tracked bills moved this week")}</div>`
      : "") +
    `<div class="src-note" style="margin-top:24px">Source: Open States, the state legislature's bill actions</div>` +
    `</div>`
  );
}

function outroScene(ids, s, ctx) {
  return (
    `<div class="abs outro-map">${stateMapSvg(ids, ctx.map, { width: 1500, maxHeight: 1000, dim: true, drawAt: -20 })}</div>` +
    `<div class="outro">` +
    `<div id="${ids.next("o1")}" class="outro-1" ${a("in", 3, { y: 20 })}>We don't predict votes.</div>` +
    `<div id="${ids.next("o2")}" class="outro-2" ${a("in", 30, { y: 20 })}>We show you the record.</div>` +
    `<div id="${ids.next("o3")}" class="outro-mark" ${a("pop", 60, { damp: 13, scale: 0.8 })}>${wordmark(84)}` +
    `<div class="outro-site">${esc(s.site || "fieldstate.org")}</div></div>` +
    `</div>`
  );
}

function fallbackScene(ids, s, ctx) {
  return (
    `<div class="abs" style="right:80px;top:260px;opacity:.5">${stateMapSvg(ids, ctx.map, { width: 900, maxHeight: 680, dim: true })}</div>` +
    `<div class="abs fallback-text">${esc(s.headline || s.text || s.place || "")}</div>`
  );
}

function sceneBody(scene, i, ctx) {
  const s = scene.screen ?? {};
  const ids = new Ids(`s${i}`);
  switch (scene.kind) {
    case "title":
      return titleScene(ids, s, ctx);
    case "decisions":
    case "decision":
      return decisionsScene(ids, s, scene, ctx);
    case "story":
      return storyScene(ids, s, ctx);
    case "agenda":
      return agendaScene(ids, s, scene, ctx);
    case "legislature":
      return legislatureScene(ids, s, ctx);
    case "outro":
      return outroScene(ids, s, ctx);
    // v3 (fieldstate.weekly_video.v3, lib/v3.mjs). No v2 scene has these kinds.
    case "open":
    case "clip":
    case "decided":
    case "matters":
    case "ident":
    case "record":
    case "next":
    case "round":
    case "road":
    case "turn":
      return V3_SCENES[scene.kind](ids, s, scene, ctx);
    default:
      return fallbackScene(ids, s, ctx);
  }
}

// ── page ──────────────────────────────────────────────────────────────────

function fontFaces() {
  return FONT_FILES.map(
    ([file, family, weight, style]) =>
      `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};font-display:block;src:url("assets/fonts/${path.basename(file)}") format("woff2");}`,
  ).join("\n");
}

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:${C.navy}}
body{font-family:"Geist",sans-serif;-webkit-font-smoothing:antialiased}
#root{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${C.navy}}
#wash{position:absolute;inset:0;z-index:0}
.scene{position:absolute;inset:0;z-index:1}
.fade{position:absolute;inset:0}
.abs{position:absolute}
.live{color:${C.live}}
.wordmark{font-family:"Geist";font-weight:700;letter-spacing:-.01em;color:${C.white};line-height:1}
.kicker{font-family:"Geist";font-weight:600;font-size:24px;letter-spacing:.14em;text-transform:uppercase}
.chip{font-family:"Geist";font-weight:500;font-size:22px;color:${C.white};border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06);border-radius:999px;padding:9px 18px}
.chips{display:flex;gap:14px;margin-top:34px}
.tag{font-family:"Geist";font-weight:600;font-size:17px;padding:5px 12px;border-radius:999px;border:1px solid;display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
.tag-dot{width:8px;height:8px;border-radius:8px}
.map{position:relative}
.map svg{position:absolute;inset:0;overflow:visible}
.dot{position:absolute;width:11px;height:11px;margin-left:-5.5px;margin-top:-5.5px;border-radius:11px;background:${C.live};box-shadow:0 0 14px rgba(240,166,43,.75)}
.pulse-ring{position:absolute;width:70px;height:70px;margin-left:-35px;margin-top:-35px;border-radius:70px;border:3px solid ${C.live}}
.pulse-core{position:absolute;width:22px;height:22px;margin-left:-11px;margin-top:-11px;border-radius:22px;background:${C.live};box-shadow:0 0 24px rgba(240,166,43,.9)}
.pulse-label{position:absolute;white-space:nowrap;font-family:"Geist";font-weight:600;font-size:26px;color:${C.white};background:rgba(10,37,64,.82);border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:6px 14px}
.map-credit{font-family:"Geist";font-size:17px;color:${C.dim};margin-top:16px}
.title-head{font-family:"Newsreader";font-weight:600;font-size:150px;line-height:.98;letter-spacing:-.025em;color:${C.white};margin-top:18px}
.title-sub{font-family:"Geist";font-size:34px;line-height:1.35;color:${C.dim};margin-top:34px;max-width:680px}
.photo{position:absolute;overflow:hidden}
.photo img{width:100%;height:100%;object-fit:cover;display:block}
.photo-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(10,37,64,0) 45%,rgba(10,37,64,.92) 100%),linear-gradient(0deg,rgba(10,37,64,.75) 0%,rgba(10,37,64,0) 40%)}
.photo-label{position:absolute;left:48px;bottom:170px;font-family:"Newsreader";font-size:64px;font-weight:600;color:${C.white}}
.photo-credit{position:absolute;left:48px;bottom:138px;font-family:"Geist";font-size:18px;color:${C.dim}}
.dec-head{font-family:"Newsreader";font-size:60px;font-weight:600;color:${C.white};line-height:1.05;margin-top:12px;letter-spacing:-.015em}
.dec-note{font-family:"Geist";font-size:19px;color:${C.dim};margin-top:12px}
.cards{display:grid;gap:20px;margin-top:28px}
.case-card{background:${C.card};border-radius:18px;padding:24px 30px 26px;box-shadow:0 24px 60px rgba(0,0,0,.35);border:1px solid ${C.line};position:relative}
.card-head{display:flex;justify-content:space-between;align-items:center;gap:16px}
.card-kicker{font-family:"Geist";font-size:19px;font-weight:600;color:${C.muted};letter-spacing:.06em;text-transform:uppercase}
.card-text{font-family:"Newsreader";font-size:38px;font-weight:600;color:${C.ink};margin-top:8px;line-height:1.15;letter-spacing:-.01em;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.stamp{position:absolute;right:28px;bottom:22px;font-family:"Geist";font-weight:700;font-size:26px;letter-spacing:.04em;border:2px solid;border-radius:10px;padding:6px 16px;white-space:nowrap}
.figure{display:flex;align-items:baseline;gap:12px}
.fig-n{font-family:"Newsreader";font-weight:600;font-size:68px;line-height:1;color:${C.ink};font-variant-numeric:tabular-nums}
.fig-rest{font-family:"Geist";font-size:24px;color:${C.body}}
.counter-n{font-family:"Newsreader";font-weight:600;font-size:140px;line-height:1;color:${C.live};letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.counter-label{font-family:"Geist";font-size:28px;color:${C.dim};margin-top:8px}
.story-head{font-family:"Newsreader";font-weight:600;font-size:76px;line-height:1.04;margin-top:18px;color:${C.white}}
.agenda-title{font-family:"Newsreader";font-weight:600;font-size:80px;color:${C.white};letter-spacing:-.02em;margin-top:8px}
.agenda-card{display:flex;background:${C.card};border-radius:20px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.4)}
.agenda-when{width:230px;flex:none;background:${C.navy2};color:${C.white};display:flex;flex-direction:column;align-items:center;justify-content:center;padding:22px 0;border-right:4px solid ${C.live}}
.when-day{font-family:"Geist";font-weight:700;font-size:24px;letter-spacing:.12em;color:${C.live}}
.when-date{font-family:"Newsreader";font-weight:600;font-size:56px;line-height:1.1;white-space:nowrap;margin:4px 0}
.when-time{font-family:"Geist";font-weight:600;font-size:24px;color:${C.dim}}
.agenda-body{padding:24px 30px;flex:1}
.agenda-place{font-family:"Newsreader";font-weight:600;font-size:40px;color:${C.ink};letter-spacing:-.01em;line-height:1.1}
.agenda-bodyname{color:${C.body}}
.agenda-items{display:grid;gap:14px;margin-top:16px}
.agenda-row{display:flex;align-items:flex-start;gap:14px;font-family:"Geist";font-size:28px;color:${C.body};line-height:1.3}
.agenda-row b{color:${C.ink};font-weight:700}
.agenda-dot{width:10px;height:10px;border-radius:10px;background:${C.live};flex:none;margin-top:13px}
.agenda-more{font-family:"Geist";font-size:20px;color:${C.muted}}
.agenda-src,.src-note{font-family:"Geist";font-size:19px;color:${C.dim}}
.outro-map{inset:0;display:flex;align-items:center;justify-content:center;opacity:.35}
.outro{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding-bottom:80px}
.outro-1{font-family:"Newsreader";font-style:italic;font-weight:500;font-size:92px;color:${C.dim}}
.outro-2{font-family:"Newsreader";font-weight:600;font-size:112px;color:${C.white};letter-spacing:-.02em}
.outro-mark{margin-top:70px;display:flex;flex-direction:column;align-items:center;gap:18px}
.outro-site{font-family:"Geist";font-size:34px;color:${C.white};border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:10px 28px;background:rgba(255,255,255,.06)}
.fallback-text{left:140px;right:900px;top:320px;font-family:"Newsreader";font-size:60px;color:${C.white}}
#brand{position:absolute;left:110px;top:44px;display:flex;align-items:center;gap:18px;z-index:5}
.brand-sep{width:1px;height:24px;background:rgba(255,255,255,.3)}
.brand-text{font-family:"Geist";font-size:22px;color:${C.dim}}
.cap-group{position:absolute;left:0;right:0;bottom:44px;display:flex;justify-content:center;z-index:10}
.cap-pill{display:block;max-width:1500px;font-family:"Geist";font-weight:600;font-size:44px;line-height:1.25;color:${C.white};background:rgba(6,24,44,.82);padding:14px 30px;border-radius:14px;text-align:center}
`;

/**
 * Caption groups from the imported transcript (one entry per VTT cue), shown
 * from 0.05 s before the cue to 0.2 s after (never into the next cue), and
 * never over the closing card (as the pilot).
 */
export function captionGroups(entries, hideAfter = Infinity) {
  const rows = (entries ?? [])
    .map((e) => ({ text: String(e.text ?? "").trim(), start: Number(e.start), end: Number(e.end) }))
    .filter((e) => e.text && Number.isFinite(e.start) && Number.isFinite(e.end))
    .sort((x, y) => x.start - y.start);
  const out = [];
  rows.forEach((e, i) => {
    const start = Math.max(0, e.start - 0.05);
    if (start >= hideAfter) return;
    const next = rows[i + 1];
    let end = Math.max(e.end, e.start + 0.2) + 0.2;
    if (next) end = Math.min(end, Math.max(start + 0.1, next.start - 0.05));
    end = Math.min(end, hideAfter);
    if (end - start < 0.05) return;
    out.push({ text: e.text, start: Number(start.toFixed(3)), duration: Number((end - start).toFixed(3)) });
  });
  return out;
}

/**
 * The composition. `timeline` is buildTimeline()'s result; `transcript` is
 * the imported captions (or the cues themselves). Returns the HTML and the
 * asset files it references (relative paths inside the project).
 */
export function compositionHtml({ script, timeline, transcript }) {
  const fps = timeline.fps;
  const duration = sec(timeline.totalFrames, fps);
  const map = stateMap(script.state);
  const ctx = { fps, map, state: script.state, title: script.title, photos: new Set() };
  const close = timeline.scenes.find((s) => s.kind === "outro");
  const open = timeline.scenes.find((s) => s.kind === "title");
  // v3 render scripts (lib/v3.mjs) add their own CSS, motion and brand
  // spans; a v2 composition is written exactly as before.
  const v3 = isV3(script);
  const weekLabel = open?.screen?.week_label || (v3 && script.week_label) || `week of ${script.week_of}`;
  const brandUntil = close ? sec(close.from, fps) : duration;
  const audio = [];
  const clips = [];
  const scenes = timeline.scenes
    .map((scene, i) => {
      const start = sec(scene.from, fps);
      const dur = sec(scene.durationInFrames, fps);
      if (scene.audio) {
        // The clip owns the rest of its scene: lib/timeline.mjs sized the
        // scene to the measured voice plus a tail, so the voice always ends
        // inside this window and never overlaps the next scene's clip.
        const audioStart = sec(scene.from + scene.audioFrom, fps);
        const window = Number((start + dur - audioStart).toFixed(4));
        audio.push(
          `<audio id="vo-${i}" class="clip" src="assets/${esc(scene.audio)}" data-start="${audioStart}" data-duration="${window}" data-volume="1" data-track-index="2"></audio>`,
        );
      }
      if (v3 && scene.clip?.file) clips.push(clipVideo(scene, i, start, dur));
      return (
        `<div id="scene-${i}" class="clip scene" data-scene="${esc(scene.id)}" data-kind="${esc(scene.kind)}" data-start="${start}" data-duration="${dur}" data-track-index="1" data-track-kind="graphics">` +
        `<div class="fade">${sceneBody(scene, i, ctx)}</div></div>`
      );
    })
    .join("\n");
  const groups = captionGroups(transcript, close ? sec(close.from, fps) - 0.1 : Infinity);
  const caps = groups
    .map(
      (g, i) =>
        `<div id="cap-${i}" class="clip cap-group" data-start="${g.start}" data-duration="${g.duration}" data-track-index="3"><span class="cap-pill">${esc(g.text)}</span></div>`,
    )
    .join("\n");
  const brand = v3
    ? v3BrandSpans(timeline, fps, script, weekLabel)
    : brandUntil > 0
      ? `<div id="brand" class="clip" data-start="0" data-duration="${brandUntil}" data-track-index="4">${wordmark(30)}<span class="brand-sep"></span><span class="brand-text">${esc(script.state_name || script.state)} · ${esc(weekLabel)}</span></div>`
      : "";
  const data = JSON.stringify({ fps, duration, state: script.state, week_of: script.week_of }).replace(/</g, "\\u003c");
  const runtime = RUNTIME_JS;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${W}, height=${H}">
<title>${esc(script.title || "Fieldstate weekly video")}</title>
<script src="assets/gsap.min.js"></script>
<style>
${fontFaces()}
${CSS}${v3 ? CSS_V3 : ""}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-fps="${fps}" data-width="${W}" data-height="${H}">
<div id="wash"></div>
${v3 && clips.length ? `${clips.join("\n")}\n` : ""}${scenes}
${brand}
${caps}
${audio.join("\n")}
</div>
<script type="application/json" id="fs-data">${data}</script>
<script>
${runtime}
</script>
${v3 ? `<script>\n${RUNTIME_V3_JS}\n</script>\n` : ""}</body>
</html>
`;
  return { html, photos: [...ctx.photos], duration, captionGroups: groups.length };
}

const RUNTIME_JS = await readFile(path.join(HERE, "runtime.js"), "utf8");
const RUNTIME_V3_JS = await readFile(path.join(HERE, "runtime-v3.js"), "utf8");

/**
 * Write the project folder. `audioRoot` holds the voice clips named as the
 * timeline's scene.audio ("audio/03.mp3"); `transcript` is the imported
 * captions (see lib/hyperframes.mjs) or null to use the cues directly.
 * `clean: false` keeps what is already in outDir (captions.vtt and
 * transcript.json from the import).
 */
export async function writeProject({ script, timeline, outDir, audioRoot, transcript, clean = true }) {
  if (clean) await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, "assets", "fonts"), { recursive: true });
  const entries = transcript ?? timeline.cues.map((c) => ({ text: c.text, start: c.start, end: c.end }));
  const out = compositionHtml({ script, timeline, transcript: entries });
  await writeFile(path.join(outDir, "index.html"), out.html);
  await copyFile(require.resolve("gsap/dist/gsap.min.js"), path.join(outDir, "assets", "gsap.min.js"));
  for (const [file] of FONT_FILES) {
    await copyFile(require.resolve(file), path.join(outDir, "assets", "fonts", path.basename(file)));
  }
  for (const file of out.photos) {
    await mkdir(path.dirname(path.join(outDir, "assets", file)), { recursive: true });
    await copyFile(path.join(ROOT, "public", file), path.join(outDir, "assets", file));
  }
  for (const scene of timeline.scenes) {
    if (scene.clip?.file) {
      await mkdir(path.dirname(path.join(outDir, "assets", scene.clip.file)), { recursive: true });
      await copyFile(path.join(audioRoot, scene.clip.file), path.join(outDir, "assets", scene.clip.file));
    }
    if (!scene.audio) continue;
    await mkdir(path.join(outDir, "assets", "audio"), { recursive: true });
    await copyFile(path.join(audioRoot, scene.audio), path.join(outDir, "assets", scene.audio));
  }
  return out;
}

// ── v3: the "why" spine and the wheel (fieldstate-site #172) ─────────────
//
// The scenes of a v3 render script (lib/v3.mjs). The look is the approved
// sample's (claude/SAMPLE-2026-10-27-weekly-video-lead-build.mjs, posted on
// fieldstate-site #172 on Oct 28) and the surface's 8-fix review of Oct 30:
// content fills the frame between the brand bar and the captions (fix 4), and
// each scene carries one source line from `screen.src` instead of a chip per
// card (fix 5). Every string on screen comes from the script's `screen`; the
// template only places it. Timing follows the voice: `scene.lineFrames` says
// when each line is read (lib/timeline.mjs).

export const V3_RENDER_SCHEMA = "fieldstate.weekly_video.v3.render";

export function isV3(script) {
  return script?.schema === V3_RENDER_SCHEMA;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2024-11-18" → "Nov 18, 2024" (a date from the script's own data). */
function dateLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${MON[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : "";
}

/** Frames from the scene start when line `k` is read, else `fallback`. */
function lineAt(scene, k, fallback) {
  const f = scene.lineFrames?.[k]?.[0];
  return Number.isFinite(f) && k >= 0 ? f : fallback;
}

/** The hook's figure in gold and a lone "no" in italics, as the sample set it. */
function hookHtml(text) {
  let h = esc(text);
  h = h.replace(/\b(\d[\d,.]*(?:\s+(?:months?|years?|weeks?|days?|votes?|times))?)/, '<span class="live">$1</span>');
  h = h.replace(/\bno\b/, "<em>no</em>");
  return h;
}

function v3Kicker(ids, text, at = 3) {
  return text ? `<div id="${ids.next("kicker")}" class="kicker v3-kicker" style="color:${C.live}" ${a("in", at, { y: 14 })}>${esc(text)}</div>` : "";
}

function v3Src(ids, text, at) {
  return text ? `<div id="${ids.next("src")}" class="v3-src" ${a("in", at)}>${esc(text)}</div>` : "";
}

function stampTone(outcome) {
  const o = String(outcome ?? "");
  if (o === "approved" || o === "approved_with_conditions") return [C.doc, C.docSoft];
  if (o === "denied" || o === "failed") return [C.deny, C.denySoft];
  return [C.body, "#f6f9fc"];
}

function v3Open(ids, s) {
  const hook = String(s.hook ?? "");
  const size = hook.length > 90 ? 76 : hook.length > 60 ? 88 : 104;
  return (
    `<div class="v3-stage">` +
    v3Kicker(ids, s.kicker, 6) +
    `<div id="${ids.next("hook")}" class="v3-hook" style="font-size:${size}px" ${a("in", 15, { y: 30, d: 22 })}>${hookHtml(hook)}</div>` +
    (s.sub ? `<div id="${ids.next("sub")}" class="v3-sub" ${a("in", 45, { y: 20 })}>${esc(s.sub)}</div>` : "") +
    v3Src(ids, s.src, 66) +
    `</div>`
  );
}

function v3Decided(ids, s, scene, ctx) {
  const seats = (s.seats ?? []).filter((m) => m && m.name);
  const [tone, soft] = stampTone(s.outcome);
  const seatsAt = scene.audioFrom + 24;
  const stampAt = lineAt(scene, 1, seatsAt + seats.length * 8 + 12);
  const noteAt = lineAt(scene, (scene.lines?.length ?? 1) - 1, stampAt + 30);
  const stampW = String(s.stamp ?? "").length * 28 + 90;
  const chips = seats
    .map((m, i) => {
      const v = String(m.vote ?? "").toLowerCase();
      const col = v === "yes" ? C.doc : v === "no" ? C.deny : C.muted;
      const word = v ? v.charAt(0).toUpperCase() + v.slice(1) : "";
      return `<div id="${ids.next("seat")}" class="v3-seat" ${a("pop", seatsAt + i * 8, { y: 20 })}><span class="v3-seat-dot" style="background:${col}"></span>${esc(m.name)}${word ? `<b style="color:${col}">${esc(word)}</b>` : ""}</div>`;
    })
    .join("");
  const headSize = String(s.head ?? "").length > 80 ? 68 : 84;
  return (
    `<div class="v3-stage">` +
    v3Kicker(ids, s.kicker, 3) +
    `<div id="${ids.next("card")}" class="v3-card" ${a("pop", 10, { y: 40 })}>` +
    `<div class="v3-card-kicker" style="padding-right:${stampW}px">${esc(s.card_kicker ?? "")}</div>` +
    `<div class="v3-card-head" style="font-size:${headSize}px;max-width:${s.stamp ? 1512 - stampW : 1512}px">${esc(s.head ?? "")}</div>` +
    // One source line per scene (fix 5): the card's sub-line is left off
    // when the scene's source line already says it.
    (s.sub && !String(s.src ?? "").includes(s.sub) ? `<div class="v3-card-sub">${esc(s.sub)}</div>` : "") +
    (chips ? `<div class="v3-seats">${chips}</div>` : "") +
    (s.stamp ? `<div id="${ids.next("stamp")}" class="v3-stamp" style="color:${tone};background:${soft};border-color:${tone}" ${a("stamp", stampAt)}>${esc(s.stamp)}</div>` : "") +
    (s.note ? `<div id="${ids.next("note")}" class="v3-note" ${a("in", noteAt, { y: 12 })}>${esc(s.note)}</div>` : "") +
    `</div>` +
    v3Src(ids, s.src, 40) +
    `</div>`
  );
}

function v3Matters(ids, s, scene, ctx) {
  const strip = s.strip ?? [];
  const X0 = 140;
  const X1 = 1780;
  const AXIS = 740;
  const ts = strip.map((v) => Date.parse(v.date));
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const seen = {};
  const tickAt = scene.audioFrom + 20;
  const span = Math.max(30, Math.min(7, 200 / Math.max(1, strip.length)) * strip.length);
  const ticks = strip
    .map((v, i) => {
      let x = t1 > t0 ? X0 + ((ts[i] - t0) / (t1 - t0)) * (X1 - X0) : X0 + (i / Math.max(1, strip.length - 1)) * (X1 - X0);
      seen[v.date] = (seen[v.date] || 0) + 1;
      if (seen[v.date] > 1) x += 16 * (seen[v.date] - 1);
      const split = v.no > 0;
      const last = i === strip.length - 1;
      const col = split ? C.deny : C.live;
      const h = split ? 120 : 160;
      const lab = (txtCol) => `<div class="v3-tick-lab" style="color:${txtCol}">${v.yes}–${v.no}<small>${esc(dateLabel(v.date))}</small></div>`;
      return (
        `<div id="${ids.next("tick")}" class="v3-tick${last ? " last" : ""}${split && !last && i === 0 ? " first" : ""}" style="left:${x.toFixed(1)}px" ${a("pop", tickAt + Math.round((span * i) / Math.max(1, strip.length)), { y: 30, damp: 11 })}>` +
        `<div class="v3-tick-bar" style="background:${col};height:${h}px;top:${AXIS - h}px"></div>` +
        `<div class="v3-tick-dot" style="background:${col};top:${AXIS - 9}px"></div>` +
        (split ? lab("#ffb3ad") : last ? lab(C.live) : "") +
        `</div>`
      );
    })
    .join("");
  const label = Array.isArray(s.label) ? s.label : [s.label].filter(Boolean);
  return (
    `<div class="abs" style="left:140px;top:150px;width:1640px">` +
    v3Kicker(ids, s.kicker, 3) +
    `<div style="display:flex;align-items:baseline;gap:34px;margin-top:44px">` +
    `<div class="v3-big"><span id="${ids.next("count")}" ${a("count", 18, { to: Number(s.count) || 0, dec: 0, d: 90 })}>0</span></div>` +
    `<div id="${ids.next("blabel")}" class="v3-big-label" ${a("in", 24, { x: -20 })}>${label.map((l) => hookHtml(l).replace(/<span class="live">([^<]*)<\/span>/, "$1")).join("<br>")}</div>` +
    `</div></div>` +
    (strip.length ? `<div id="${ids.next("axis")}" class="v3-axis" style="top:${AXIS}px" ${a("draw", 16, { d: 30 })}></div>${ticks}` : "") +
    `<div class="abs" style="left:140px;right:140px;top:${AXIS + 112}px">${v3Src(ids, s.src, tickAt + span + 20)}</div>`
  );
}

function v3Ident(ids, s) {
  return (
    `<div class="v3-ident">` +
    `<div id="${ids.next("rule")}" class="v3-ident-rule" ${a("in", 0, { x: -60, d: 10 })}></div>` +
    `<div id="${ids.next("ident")}" class="v3-ident-text" ${a("in", 3, { y: 20, d: 12 })}>${esc(s.title ?? "")}</div>` +
    `<div id="${ids.next("rule")}" class="v3-ident-rule" ${a("in", 0, { x: 60, d: 10 })}></div>` +
    `</div>`
  );
}

/** Film grain over the page, as the sample (an inline SVG filter: no URL). */
function grain(id) {
  return `<svg class="v3-grain" width="${W}" height="${H}" aria-hidden="true"><filter id="${id}"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7"/></filter><rect width="100%" height="100%" filter="url(#${id})"/></svg>`;
}

const PLINE_W = [96, 88, 93, 71, 98, 84, 90, 62];
function plines(n, seed) {
  return Array.from({ length: n }, (_, i) => `<div class="v3-pline" style="width:${PLINE_W[(i + seed) % 8]}%"></div>`).join("");
}

function v3Record(ids, s, scene) {
  const n = scene.lines?.length ?? 0;
  const capIdx = (text) => (text ? (scene.lines ?? []).findIndex((l) => l.cap === text) : -1);
  // A wheel segment's page opens on the line that names its case; the
  // highlighter runs on the line about the page.
  const hlAt = lineAt(scene, s.card_head ? 1 : 0, scene.audioFrom) + 12;
  const sideAt = hlAt + 40;
  const dupe = s.side_2 && s.outcome_line && s.side_2 === s.outcome_line;
  const side2At = lineAt(scene, capIdx(s.side_2) >= 0 ? capIdx(s.side_2) : n - 1, sideAt + 50);
  const outAt = lineAt(scene, capIdx(s.outcome_line) >= 0 ? capIdx(s.outcome_line) : n - 1, sideAt + 60);
  const q = String(s.quote ?? "");
  const qSize = q.length > 300 ? 32 : q.length > 180 ? 38 : 46;
  const compact = !!(s.card_head || s.card_kicker);
  return (
    `<div id="${ids.next("cam")}" class="v3-camera" ${a("push", 0, { scale: 1.07, y: -40 })}>` +
    `<div class="v3-paper">` +
    `<div class="v3-paper-head"><span>${esc(s.paper_head ?? "")}</span><span>${esc(s.paper_id ?? "")}</span></div>` +
    `<div class="v3-paper-title">${esc(s.paper_title ?? "")}</div>` +
    plines(5, 0) +
    `<div class="v3-pgap"></div>` +
    plines(3, 3) +
    `<p class="v3-pquote" style="font-size:${qSize}px"><span id="${ids.next("hl")}" class="v3-hl" ${a("hl", hlAt, { d: 50 })}>${esc(q)}</span></p>` +
    plines(4, 5) +
    (s.page != null ? `<div class="v3-paper-foot">Page ${esc(s.page)}</div>` : "") +
    `</div></div>` +
    grain(ids.next("noise")) +
    `<div class="v3-vignette"></div>` +
    `<div id="${ids.next("side")}" class="abs v3-side${compact ? " compact" : ""}" ${a("in", s.card_head ? scene.audioFrom + 6 : sideAt, { x: 30 })}>` +
    (s.card_kicker ? `<div class="v3-side-ck">${esc(s.card_kicker)}</div>` : "") +
    (s.card_head ? `<div class="v3-side-ch">${esc(s.card_head)}</div>` : "") +
    `<div class="v3-side-k">${esc(s.side_k ?? "")}</div>` +
    (s.side_1 ? `<div class="v3-side-1">${esc(s.side_1)}</div>` : "") +
    (s.side_2 && !dupe ? `<div id="${ids.next("s2")}" class="v3-side-2" ${a("in", side2At, { y: 12 })}>${esc(s.side_2)}</div>` : "") +
    (s.outcome_line ? `<div id="${ids.next("out")}" class="v3-side-out" ${a("in", outAt, { y: 12 })}>${esc(s.outcome_line)}</div>` : "") +
    `<div class="v3-side-src">${esc(s.side_src ?? "")}${s.label ? `<br>${esc(s.label)}` : ""}</div>` +
    `</div>`
  );
}

function v3AgendaCard(ids, card, at, rowAt) {
  const when = card.when ?? [];
  const rows = (card.rows ?? []).filter(Boolean);
  return (
    `<div id="${ids.next("agenda")}" class="v3-agenda" ${a("pop", at, { y: 40 })}>` +
    `<div class="v3-when"><div class="v3-when-day">${esc(when[0] ?? "")}</div><div class="v3-when-date">${esc(when[1] ?? "")}</div>` +
    (card.time ? `<div class="v3-when-time">${esc(card.time)}</div>` : "") +
    `</div><div class="v3-agenda-body"><div class="v3-agenda-place">${esc(card.place ?? "")}</div>` +
    `<div class="v3-agenda-items">` +
    rows.map((r, i) => `<div id="${ids.next("arow")}" class="v3-arow" ${a("in", rowAt(i), { x: -16 })}><span class="v3-adot"></span>${esc(r)}</div>`).join("") +
    `</div></div></div>`
  );
}

function v3Next(ids, s, scene) {
  return (
    `<div class="v3-stage">` +
    v3Kicker(ids, s.kicker, 3) +
    v3AgendaCard(ids, s, 12, (i) => lineAt(scene, i, 40 + i * 18) + 8) +
    `</div>`
  );
}

function roundCard(ids, c, opts) {
  const [tone, soft] = stampTone(c.outcome);
  const kick = [c.place_short, c.kind_label, c.date_label].filter(Boolean).join(" · ");
  const stamp = c.outcome_label ? String(c.outcome_label).toUpperCase() : "";
  return (
    `<div class="v3-rcard${opts.big ? " big" : ""}">` +
    `<div class="v3-card-kicker">${esc(kick)}</div>` +
    `<div class="v3-rhead">${esc(c.text ?? "")}</div>` +
    `<div class="v3-rfoot">` +
    (stamp ? `<span id="${ids.next("rstamp")}" class="v3-rstamp" style="color:${tone};background:${soft};border-color:${tone}" ${a("stamp", opts.stampAt)}>${esc(stamp)}</span>` : "") +
    (c.chip ? `<span id="${ids.next("chip")}" class="v3-why" ${a("in", opts.stampAt + 10, { x: -12 })}>${esc(c.chip)}</span>` : "") +
    `</div></div>`
  );
}

function v3Round(ids, s, scene) {
  const cards = s.cards ?? [];
  const itemLines = s.item_lines ?? [];
  if (s.layout === "one_at_a_time") {
    const at = lineAt(scene, itemLines[0] ?? 0, 30);
    const dots = (s.count ?? 1) < 2 ? "" : Array.from({ length: s.count }, (_, i) => `<span class="v3-dot${i === s.index ? " on" : ""}"></span>`).join("");
    return (
      `<div class="v3-stage">` +
      `<div style="display:flex;align-items:center;justify-content:space-between">${v3Kicker(ids, s.kicker, 3)}<div class="v3-dots">${dots}</div></div>` +
      `<div id="${ids.next("rc")}" style="margin-top:30px" ${a("pop", 10, { y: 40 })}>${roundCard(ids, cards[0] ?? {}, { big: true, stampAt: at + 24 })}</div>` +
      v3Src(ids, s.src, 30) +
      `</div>`
    );
  }
  const first = lineAt(scene, itemLines[0] ?? 0, 30);
  const cols = cards.length <= 4 ? 2 : 3;
  const grid = cards
    .map((c, i) => {
      const on = lineAt(scene, itemLines[i], first + i * 60);
      const off = i + 1 < cards.length ? lineAt(scene, itemLines[i + 1], on + 60) : -1;
      return (
        `<div id="${ids.next("rpop")}" ${a("pop", 8 + i * 5, { y: 30 })}>` +
        `<div id="${ids.next("lit")}" data-a="lit" data-at="${first}" data-first="${first}" data-on="${on}" data-off="${off}">` +
        roundCard(ids, c, { big: false, stampAt: on + 20 }) +
        `</div></div>`
      );
    })
    .join("");
  return (
    `<div class="v3-stage">` +
    v3Kicker(ids, s.kicker, 3) +
    `<div class="v3-rgrid" style="grid-template-columns:repeat(${cols},1fr)">${grid}</div>` +
    v3Src(ids, s.src, 30) +
    `</div>`
  );
}

function v3Road(ids, s, scene) {
  const steps = s.steps ?? [];
  const n = steps.length;
  const X0 = 220;
  const X1 = 1700;
  const TRACK = 700;
  const drawD = 36;
  const gap = (X1 - X0) / Math.max(1, n - 1);
  const alternate = n > 4;
  const labW = Math.min(380, alternate ? gap * 2 - 24 : gap - 24);
  const startAt = scene.audioFrom + 20;
  const stations = steps
    .map((st, i) => {
      const x = X0 + i * gap;
      const k = s.step_lines?.[i];
      const at = k != null && k >= 0 ? lineAt(scene, k, startAt + i * 30) : startAt + i * 30;
      const last = i === n - 1;
      const above = alternate && i % 2 === 1;
      const mark = st.recorded ? "v3-mark open" : last ? "v3-mark end" : "v3-mark";
      const align = i === 0 ? "left" : last ? "right" : "center";
      const shift = align === "left" ? -14 : align === "right" ? -labW + 14 : -labW / 2;
      // Every station shows (dim) as the track draws; each lights when its
      // own line is read.
      const shown = startAt + Math.round((drawD * i) / Math.max(1, n - 1));
      return (
        `<div id="${ids.next("st")}" class="v3-station" style="left:${x.toFixed(1)}px;top:${TRACK}px" ${a("pop", shown, { y: above ? -20 : 20, damp: 12 })}>` +
        `<div id="${ids.next("stlit")}" data-a="lit" data-at="${shown}" data-first="${shown}" data-on="${Math.max(at, shown + 10)}" data-off="-1" data-lift="0">` +
        `<div class="${mark}"></div>` +
        `<div class="v3-st-lab${above ? " above" : ""}" style="width:${labW.toFixed(0)}px;left:${shift.toFixed(0)}px;text-align:${align}">` +
        `<div class="v3-st-date">${esc(st.date_label)}</div><div class="v3-st-label">${esc(st.label ?? "")}</div></div>` +
        `</div></div>`
      );
    })
    .join("");
  return (
    `<div class="abs" style="left:140px;top:${alternate ? 120 : 160}px;width:1640px">` +
    `<div style="display:flex;align-items:baseline;gap:22px">${v3Kicker(ids, s.title, 3)}${s.place ? `<span class="v3-road-place">${esc(s.place)}</span>` : ""}</div>` +
    `<div id="${ids.next("rh")}" class="v3-road-head" ${a("in", 8, { y: 24, d: 20 })}>${esc(s.head ?? "")}</div>` +
    `<div id="${ids.next("rs")}" class="v3-road-span" ${a("in", 20, { y: 14 })}>` +
    (s.months_label ? `<span class="live">${esc(s.months_label)}</span>` : "") +
    (s.span ? `<span class="v3-road-dates">${esc(s.span)}</span>` : "") +
    `</div></div>` +
    `<div id="${ids.next("track")}" class="v3-track" style="left:${X0}px;width:${X1 - X0}px;top:${TRACK - 2}px" ${a("draw", startAt - 6, { d: drawD + 6 })}></div>` +
    stations
  );
}

function v3Turn(ids, s, scene) {
  const items = (s.items ?? [s]).slice(0, 3);
  return (
    `<div class="v3-stage">` +
    v3Kicker(ids, s.kicker, 3) +
    `<div style="display:grid;gap:22px">` +
    items.map((it, j) => v3AgendaCard(ids, it, 12 + j * 10, (i) => lineAt(scene, j, 40) + 8 + i * 10)).join("") +
    `</div>` +
    v3Src(ids, s.src, 40) +
    `</div>`
  );
}

function v3ClipOverlay(ids, s, scene, ctx) {
  const c = scene.clip ?? {};
  const R = Math.round((Number(c.result_at_s) || 0) * ctx.fps);
  return (
    `<div class="v3-clip-shade"></div>` +
    (c.lower_third ? `<div id="${ids.next("lt")}" class="v3-lower" ${a("in", 6, { x: -30 })}>${esc(c.lower_third)}</div>` : "") +
    (c.credit ? `<div class="v3-credit">${esc(c.credit)}</div>` : "") +
    (R > 0
      ? `<div id="${ids.next("dark")}" class="v3-dark" ${a("in", R, { d: 6 })}></div>` +
        (c.tally ? `<div class="v3-slam-wrap"><div id="${ids.next("slam")}" class="v3-slam" ${a("pop", R + 2, { scale: 1.8, damp: 12 })}>${esc(c.tally)}</div>` : `<div class="v3-slam-wrap">`) +
        (c.label ? `<div id="${ids.next("clabel")}" class="v3-clip-label" ${a("in", R + 16, { y: 12 })}>${esc(c.label)}</div>` : "") +
        `</div>`
      : c.label
        ? `<div class="v3-slam-wrap"><div class="v3-clip-label">${esc(c.label)}</div></div>`
        : "")
  );
}

/** The clip's footage: a root-level clip (HyperFrames times the video itself). */
function clipVideo(scene, i, start, dur) {
  return `<video id="clipvid-${i}" class="clip v3-clipvid" src="assets/${esc(scene.clip.file)}" data-start="${start}" data-duration="${dur}" data-media-start="0" data-has-audio="true" data-volume="1" data-track-index="2" playsinline></video>`;
}

const V3_SCENES = {
  open: (ids, s) => v3Open(ids, s),
  clip: v3ClipOverlay,
  decided: v3Decided,
  matters: v3Matters,
  ident: (ids, s) => v3Ident(ids, s),
  record: (ids, s, scene) => v3Record(ids, s, scene),
  next: (ids, s, scene) => v3Next(ids, s, scene),
  round: (ids, s, scene) => v3Round(ids, s, scene),
  road: (ids, s, scene) => v3Road(ids, s, scene),
  turn: (ids, s, scene) => v3Turn(ids, s, scene),
};

/** Brand bar spans: hidden over the segment card, the page and the footage (the paper fills the frame), and over the close. */
const NO_BRAND = new Set(["ident", "record", "clip", "outro"]);
function v3BrandSpans(timeline, fps, script, weekLabel) {
  const spans = [];
  let cur = null;
  for (const sc of timeline.scenes) {
    if (NO_BRAND.has(sc.kind)) {
      cur = null;
      continue;
    }
    if (!cur) {
      cur = { from: sc.from, to: sc.from + sc.durationInFrames };
      spans.push(cur);
    } else {
      cur.to = sc.from + sc.durationInFrames;
    }
  }
  const inner = `${wordmark(30)}<span class="brand-sep"></span><span class="brand-text">${esc(script.state_name || script.state)} · ${esc(weekLabel)}</span>`;
  return spans
    .map((sp, k) => `<div id="brand-${k}" class="clip v3-brand" data-start="${sec(sp.from, fps)}" data-duration="${sec(sp.to - sp.from, fps)}" data-track-index="4">${inner}</div>`)
    .join("");
}

const CSS_V3 = `
.v3-stage{position:absolute;left:140px;right:140px;top:120px;bottom:190px;display:flex;flex-direction:column;justify-content:center}
.v3-kicker{font-size:26px}
.v3-src{font-family:"Geist";font-size:21px;color:${C.dim};margin-top:26px}
.v3-hook{font-family:"Newsreader";font-weight:600;line-height:1.02;letter-spacing:-.02em;color:${C.white};margin-top:26px;max-width:1560px}
.v3-hook em,.v3-big-label em{font-style:italic;font-weight:500}
.v3-sub{font-family:"Newsreader";font-weight:500;font-size:44px;line-height:1.2;color:${C.dim};margin-top:30px;max-width:1500px}
.v3-card{background:${C.card};border-radius:24px;padding:54px 64px 56px;margin-top:28px;position:relative;box-shadow:0 30px 70px rgba(0,0,0,.35)}
.v3-card-kicker{font-family:"Geist";font-size:25px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${C.muted}}
.v3-card-head{font-family:"Newsreader";font-weight:600;line-height:1.05;letter-spacing:-.015em;color:${C.ink};margin-top:34px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.v3-card-sub{font-family:"Geist";font-size:28px;color:${C.body};margin-top:18px}
.v3-seats{display:flex;flex-wrap:wrap;gap:16px;margin-top:36px}
.v3-seat{display:flex;align-items:center;gap:12px;font-family:"Geist";font-size:31px;font-weight:500;color:${C.ink};border:1px solid ${C.line};background:#f6f9fc;border-radius:999px;padding:12px 26px}
.v3-seat b{font-weight:700}
.v3-seat-dot{width:11px;height:11px;border-radius:11px}
.v3-stamp{position:absolute;right:60px;top:46px;font-family:"Geist";font-weight:700;font-size:40px;letter-spacing:.05em;border:3px solid;border-radius:12px;padding:8px 20px;white-space:nowrap}
.v3-note{font-family:"Newsreader";font-style:italic;font-weight:500;font-size:42px;color:${C.body};margin-top:34px;padding-top:24px;border-top:1px solid ${C.line}}
.v3-big{font-family:"Newsreader";font-weight:600;font-size:250px;line-height:.9;color:${C.live};font-variant-numeric:tabular-nums;letter-spacing:-.03em}
.v3-big-label{font-family:"Newsreader";font-weight:600;font-size:60px;line-height:1.08;color:${C.white}}
.v3-axis{position:absolute;left:140px;right:140px;height:2px;background:rgba(255,255,255,.28);transform-origin:0 50%}
.v3-tick{position:absolute;top:0;width:0}
.v3-tick-bar{position:absolute;left:-3px;width:6px;border-radius:3px}
.v3-tick-dot{position:absolute;left:-9px;width:18px;height:18px;border-radius:18px;box-shadow:0 0 18px rgba(240,166,43,.6)}
.v3-tick-lab{position:absolute;left:-70px;width:140px;text-align:center;top:758px;font-family:"Newsreader";font-weight:600;font-size:40px;line-height:1;white-space:nowrap}
.v3-tick-lab small{display:block;font-family:"Geist";font-weight:500;font-size:17px;color:${C.dim};margin-top:6px}
.v3-tick.last .v3-tick-lab{left:-150px;text-align:right}
.v3-tick.first .v3-tick-lab{left:-10px;text-align:left}
.v3-ident{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:34px;background:#071a2e}
.v3-ident-rule{width:180px;height:2px;background:${C.live}}
.v3-ident-text{font-family:"Newsreader";font-style:italic;font-weight:500;font-size:84px;color:${C.white};letter-spacing:-.01em}
.v3-camera{position:absolute;left:150px;top:90px;width:1000px;height:1000px;transform-origin:42% 58%}
.v3-paper{position:absolute;inset:0 0 -200px 0;background:#f3eee2;border-radius:4px;padding:70px 80px;transform:rotate(-1.6deg);box-shadow:0 40px 90px rgba(0,0,0,.55);background-image:linear-gradient(180deg,rgba(255,255,255,.35),rgba(0,0,0,.04)),repeating-linear-gradient(0deg,rgba(80,60,20,.025) 0 2px,transparent 2px 5px)}
.v3-paper-head{display:flex;justify-content:space-between;gap:24px;font-family:"Newsreader";font-weight:600;font-size:22px;letter-spacing:.08em;text-transform:uppercase;color:#3b3527;border-bottom:2px solid #3b3527;padding-bottom:14px}
.v3-paper-title{font-family:"Newsreader";font-weight:600;font-size:40px;color:#221d12;margin:34px 0 26px}
.v3-pline{height:15px;border-radius:3px;background:rgba(45,38,22,.16);margin:0 0 17px}
.v3-pgap{height:22px}
.v3-pquote{font-family:"Newsreader";font-weight:500;line-height:1.32;color:#1d180e;margin:14px 0 28px}
.v3-hl{background-image:linear-gradient(transparent 18%,rgba(240,166,43,.62) 18%,rgba(240,166,43,.62) 92%,transparent 92%);background-repeat:no-repeat;background-size:0% 100%;-webkit-box-decoration-break:clone;box-decoration-break:clone;padding:0 4px}
.v3-paper-foot{position:absolute;left:80px;right:80px;bottom:250px;text-align:center;font-family:"Newsreader";font-size:22px;color:#5b5341}
.v3-grain{position:absolute;left:0;top:0;pointer-events:none;opacity:.10;mix-blend-mode:overlay}
.v3-vignette{position:absolute;inset:0;pointer-events:none;background:radial-gradient(75% 85% at 35% 50%,transparent 55%,rgba(3,12,24,.75) 100%)}
.v3-side{left:1290px;top:270px;width:530px}
.v3-side.compact{top:150px}
.v3-side-ck{font-family:"Geist";font-weight:600;font-size:19px;letter-spacing:.08em;text-transform:uppercase;color:${C.dim}}
.v3-side-ch{font-family:"Newsreader";font-weight:600;font-size:42px;line-height:1.12;color:${C.white};margin:10px 0 30px;padding-bottom:26px;border-bottom:1px solid rgba(255,255,255,.18)}
.v3-side-k{font-family:"Geist";font-weight:600;font-size:24px;letter-spacing:.14em;text-transform:uppercase;color:${C.live}}
.v3-side-1{font-family:"Newsreader";font-weight:600;font-size:62px;line-height:1.05;color:${C.white};margin-top:20px}
.v3-side.compact .v3-side-1{font-size:52px}
.v3-side-2{font-family:"Newsreader";font-weight:600;font-size:62px;line-height:1.05;color:${C.live};margin-top:16px}
.v3-side-out{font-family:"Newsreader";font-weight:600;font-size:44px;line-height:1.1;color:${C.live};margin-top:22px}
.v3-side-src{font-family:"Geist";font-size:19px;color:${C.dim};margin-top:34px;line-height:1.5}
.v3-agenda{display:flex;background:${C.card};border-radius:22px;overflow:hidden;margin-top:30px;box-shadow:0 30px 70px rgba(0,0,0,.4)}
.v3-when{width:380px;flex:none;background:${C.navy2};color:${C.white};display:flex;flex-direction:column;align-items:center;justify-content:center;padding:56px 0;border-right:6px solid ${C.live}}
.v3-when-day{font-family:"Geist";font-weight:700;font-size:36px;letter-spacing:.12em;color:${C.live}}
.v3-when-date{font-family:"Newsreader";font-weight:600;font-size:108px;line-height:1.1;white-space:nowrap}
.v3-when-time{font-family:"Geist";font-size:30px;color:${C.dim};margin-top:6px}
.v3-agenda-body{padding:60px 64px;flex:1;display:flex;flex-direction:column;justify-content:center}
.v3-agenda-place{font-family:"Newsreader";font-weight:600;font-size:80px;color:${C.ink};line-height:1.08;letter-spacing:-.01em}
.v3-agenda-items{display:grid;gap:22px;margin-top:36px}
.v3-arow{display:flex;align-items:center;gap:18px;font-family:"Geist";font-size:40px;color:${C.body}}
.v3-adot{width:15px;height:15px;border-radius:15px;background:${C.live};flex:none}
.v3-rcard{background:${C.card};border-radius:20px;padding:32px 40px 34px;box-shadow:0 24px 60px rgba(0,0,0,.35);height:100%;display:flex;flex-direction:column}
.v3-rcard.big{padding:58px 64px 60px;border-radius:24px}
.v3-rhead{font-family:"Newsreader";font-weight:600;font-size:46px;line-height:1.12;color:${C.ink};margin-top:12px;letter-spacing:-.01em;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.v3-rcard.big .v3-rhead{font-size:84px;line-height:1.05;margin-top:26px}
.v3-rfoot{display:flex;align-items:center;gap:16px;margin-top:auto;padding-top:22px}
.v3-rcard.big .v3-rfoot{padding-top:36px}
.v3-rstamp{font-family:"Geist";font-weight:700;font-size:27px;letter-spacing:.05em;border:2px solid;border-radius:10px;padding:6px 16px;white-space:nowrap}
.v3-rcard.big .v3-rstamp{font-size:40px;border-width:3px;padding:8px 22px}
.v3-why{font-family:"Geist";font-weight:600;font-size:27px;color:${C.navy};background:${C.live};border-radius:999px;padding:7px 18px;white-space:nowrap}
.v3-rcard.big .v3-why{font-size:36px;padding:10px 26px}
.v3-rgrid{display:grid;gap:26px;margin-top:28px;grid-auto-rows:1fr}
.v3-dots{display:flex;gap:12px}
.v3-dot{width:14px;height:14px;border-radius:14px;background:rgba(255,255,255,.25)}
.v3-dot.on{background:${C.live}}
.v3-road-place{font-family:"Geist";font-weight:500;font-size:24px;color:${C.dim}}
.v3-road-head{font-family:"Newsreader";font-weight:600;font-size:68px;line-height:1.06;color:${C.white};letter-spacing:-.015em;margin-top:18px;max-width:1500px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.v3-road-span{display:flex;align-items:baseline;gap:26px;margin-top:22px;font-family:"Newsreader";font-weight:600}
.v3-road-span .live{font-size:96px;letter-spacing:-.02em;line-height:1}
.v3-road-dates{font-family:"Geist";font-weight:500;font-size:30px;color:${C.dim}}
.v3-track{position:absolute;height:4px;border-radius:4px;background:linear-gradient(90deg,rgba(240,166,43,.35),${C.live});transform-origin:0 50%}
.v3-station{position:absolute;width:0;height:0}
.v3-mark{position:absolute;left:-15px;top:-15px;width:30px;height:30px;border-radius:30px;background:${C.live};box-shadow:0 0 18px rgba(240,166,43,.6)}
.v3-mark.open{background:${C.navy};border:4px solid ${C.live};box-shadow:none}
.v3-mark.end{left:-22px;top:-22px;width:44px;height:44px;border-radius:44px;box-shadow:0 0 26px rgba(240,166,43,.85)}
.v3-st-lab{position:absolute;top:40px}
.v3-st-lab.above{top:auto;bottom:40px}
.v3-st-date{font-family:"Geist";font-weight:600;font-size:25px;color:${C.dim};letter-spacing:.02em}
.v3-st-label{font-family:"Newsreader";font-weight:600;font-size:40px;line-height:1.12;color:${C.white};margin-top:6px}
.v3-clipvid{position:absolute;left:0;top:0;width:${W}px;height:${H}px;object-fit:contain;background:#000;z-index:1}
.v3-clip-shade{position:absolute;inset:0;background:linear-gradient(0deg,rgba(6,24,44,.7) 0%,rgba(6,24,44,0) 38%)}
.v3-lower{position:absolute;left:110px;bottom:200px;font-family:"Geist";font-weight:600;font-size:32px;color:${C.white};background:rgba(10,37,64,.88);border-left:6px solid ${C.live};padding:14px 26px;border-radius:6px}
.v3-credit{position:absolute;right:60px;top:48px;font-family:"Geist";font-weight:500;font-size:20px;color:${C.white};background:rgba(6,24,44,.7);border-radius:8px;padding:6px 14px}
.v3-dark{position:absolute;inset:0;background:rgba(3,12,24,.62)}
.v3-slam-wrap{position:absolute;left:0;right:0;top:250px;display:flex;flex-direction:column;align-items:center;gap:30px}
.v3-slam{font-family:"Newsreader";font-weight:600;font-size:280px;line-height:.9;color:${C.live};letter-spacing:-.03em;text-shadow:0 10px 50px rgba(0,0,0,.5)}
.v3-clip-label{font-family:"Geist";font-weight:600;font-size:26px;color:${C.reported};background:${C.reportedSoft};border:1px solid #ddd4ff;border-radius:999px;padding:9px 22px}
.v3-brand{position:absolute;left:110px;top:44px;display:flex;align-items:center;gap:18px;z-index:5}
`;

export { PHOTOS };
