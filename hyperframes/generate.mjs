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
  const weekLabel = open?.screen?.week_label || `week of ${script.week_of}`;
  const brandUntil = close ? sec(close.from, fps) : duration;
  const audio = [];
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
  const brand =
    brandUntil > 0
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
${CSS}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-fps="${fps}" data-width="${W}" data-height="${H}">
<div id="wash"></div>
${scenes}
${brand}
${caps}
${audio.join("\n")}
</div>
<script type="application/json" id="fs-data">${data}</script>
<script>
${runtime}
</script>
</body>
</html>
`;
  return { html, photos: [...ctx.photos], duration, captionGroups: groups.length };
}

const RUNTIME_JS = await readFile(path.join(HERE, "runtime.js"), "utf8");

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
    if (!scene.audio) continue;
    await mkdir(path.join(outDir, "assets", "audio"), { recursive: true });
    await copyFile(path.join(audioRoot, scene.audio), path.join(outDir, "assets", scene.audio));
  }
  return out;
}

export { PHOTOS };
