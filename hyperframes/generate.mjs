// Fieldstate weekly video: script → HyperFrames project.
//
// Input: the engine's script (fieldstate.weekly_video.v2, or the v3 lead
// story's scenes from lib/v3.mjs when VIDEO_TEMPLATE=v3) and the timeline
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
  paper: "#f3eee2",
  ident: "#071a2e",
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

// ── v3: the lead story ───────────────────────────
// Scene kinds open, decided, matters, ident, record, next and round, filled
// from lib/v3.mjs. The look is the design sample of Oct 28; the data comes
// from the script. Times are seconds from the scene start, kept inside the
// scene however long its voice runs.

/** Frames from the scene start, never later than 12 frames before its end. */
function at(scene, fps) {
  return (secs) => Math.max(0, Math.min(Math.round(secs * fps), scene.durationInFrames - 12));
}

const VOTE_WORD = { yes: "Yes", no: "No", absent: "Absent", abstain: "Abstain", recused: "Recused" };

function hookHtml(text) {
  let s = esc(text);
  // The first figure with its unit is gold ("23 months"); a bare "no" is set in italics.
  s = s.replace(/\b(\d[\d,.]*(?:\s+[a-z]+)?)/, '<span class="live">$1</span>');
  s = s.replace(/\bno\b/, "<em>no</em>");
  return s;
}

function v3OpenScene(ids, s, scene, ctx) {
  const t = at(scene, ctx.fps);
  const size = String(s.hook || "").length > 44 ? 84 : 104;
  return (
    `<div class="abs" style="left:140px;top:${s.sub ? 220 : 280}px;width:1560px">` +
    kicker(ids, s.kicker || "", t(0.2)) +
    `<div id="${ids.next("hook")}" class="v3-hook" style="font-size:${size}px" ${a("in", t(0.5), { y: 30, d: 22 })}>${hookHtml(s.hook)}</div>` +
    (s.sub ? `<div id="${ids.next("hsub")}" class="v3-hook-sub" ${a("in", t(1.6), { y: 20 })}>${esc(s.sub)}</div>` : "") +
    `<div id="${ids.next("src")}" class="v3-src" ${a("in", t(2.4))}>${esc(s.src || "")}</div>` +
    `</div>`
  );
}

function v3DecidedScene(ids, s, scene, ctx) {
  const t = at(scene, ctx.fps);
  const seats = s.seats ?? [];
  const step = Math.min(0.35, 2.4 / Math.max(1, seats.length));
  const chips = seats
    .map((m, i) => {
      const tone = m.vote === "yes" ? C.doc : m.vote === "no" ? C.deny : C.muted;
      return (
        `<div id="${ids.next("seat")}" class="v3-seat${seats.length > 7 ? " small" : ""}" ${a("pop", t(2.2 + i * step), { y: 20 })}>` +
        `<span class="v3-seat-dot" style="background:${tone}"></span>${esc(m.name)}<b style="color:${tone}">${esc(VOTE_WORD[m.vote] ?? m.vote)}</b></div>`
      );
    })
    .join("");
  const ok = s.outcome === "approved" || s.outcome === "approved_with_conditions";
  const tone = ok ? C.doc : C.deny;
  const stampAt = seats.length ? 2.6 + seats.length * step : 2.2;
  return (
    `<div class="abs" style="left:140px;top:190px;width:1640px">` +
    kicker(ids, s.kicker || "What happened", t(0.1)) +
    `<div id="${ids.next("dcard")}" class="v3-card" ${a("pop", t(0.4), { y: 40 })}>` +
    `<div class="v3-card-top"><span class="v3-card-kicker">${esc(s.card_kicker || "")}</span>${tag(s.tier)}</div>` +
    `<div class="v3-card-head">${esc(s.head || "")}</div>` +
    `<div class="v3-card-sub">${esc(s.sub || "")}</div>` +
    (chips ? `<div class="v3-seats">${chips}</div>` : "") +
    `<div id="${ids.next("dstamp")}" class="v3-stamp" style="color:${tone};border-color:${tone}" ${a("stamp", t(stampAt))}>${esc(s.stamp || "")}</div>` +
    `</div></div>`
  );
}

function v3MattersScene(ids, s, scene, ctx) {
  const t = at(scene, ctx.fps);
  const strip = s.strip ?? [];
  const X0 = 140;
  const X1 = 1780;
  const t0 = Date.parse(strip[0]?.date);
  const t1 = Date.parse(strip[strip.length - 1]?.date);
  const span = Math.max(1, t1 - t0);
  const step = Math.min(0.22, 4.0 / Math.max(1, strip.length));
  const lastSplit = strip.reduce((k, v, i) => (v.no > 0 ? i : k), -1);
  const seen = {};
  const ticks = strip
    .map((v, i) => {
      let x = X0 + ((Date.parse(v.date) - t0) / span) * (X1 - X0);
      seen[v.date] = (seen[v.date] || 0) + 1;
      x += (seen[v.date] - 1) * 16; // same-night votes side by side
      const split = v.no > 0;
      const col = split ? C.deny : C.live;
      const h = split ? 120 : 160;
      const label = v.this_case
        ? `<div class="v3-tick-lab end" style="color:${C.live}">${v.yes}–${v.no}<small>${esc(shortDateText(v.date))}</small></div>`
        : split && i === lastSplit
          ? `<div class="v3-tick-lab" style="color:#ffb3ad">${v.yes}–${v.no}<small>${esc(shortDateText(v.date))}</small></div>`
          : "";
      return (
        `<div id="${ids.next("tick")}" class="v3-tick" style="left:${x.toFixed(1)}px" ${a("pop", t(1.0 + i * step), { y: 30, damp: 11 })}>` +
        `<div class="v3-tick-bar" style="background:${col};height:${h}px;top:${790 - h}px"></div>` +
        `<div class="v3-tick-dot" style="background:${col}"></div>${label}</div>`
      );
    })
    .join("");
  const [l1, l2] = s.label ?? ["", ""];
  return (
    `<div class="abs" style="left:140px;top:170px;width:1640px">` +
    kicker(ids, s.kicker || "Why it matters", t(0.1)) +
    `<div style="display:flex;align-items:baseline;gap:30px;margin-top:18px">` +
    `<div class="v3-big"><span id="${ids.next("big")}" ${a("count", t(0.6), { to: s.count ?? 0, dec: 0, d: 120 })}>0</span></div>` +
    `<div id="${ids.next("biglab")}" class="v3-big-label" ${a("in", t(0.8), { x: -20 })}>${esc(l1)}<br>${esc(l2)}</div>` +
    `</div></div>` +
    `<div id="${ids.next("axis")}" class="v3-axis" ${a("in", t(0.6))}></div>` +
    ticks +
    `<div id="${ids.next("msrc")}" class="abs v3-src" style="left:140px;top:906px;margin:0" ${a("in", t(5.4))}>${esc(s.src || "")}</div>`
  );
}

function shortDateText(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ""
    : `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function v3IdentScene(ids, s) {
  return (
    `<div class="v3-ident">` +
    `<div id="${ids.next("rule")}" class="v3-ident-rule" ${a("in", 0, { x: -60, d: 10 })}></div>` +
    `<div id="${ids.next("itext")}" class="v3-ident-text" ${a("in", 3, { y: 20, d: 12 })}>${esc(s.title || "")}</div>` +
    `<div id="${ids.next("rule")}" class="v3-ident-rule" ${a("in", 0, { x: 60, d: 10 })}></div>` +
    `</div>`
  );
}

function paperLines(n, seed) {
  const widths = [96, 88, 93, 71, 98, 84, 90, 62];
  return Array.from({ length: n }, (_, i) => `<div class="v3-pline" style="width:${widths[(i + seed) % 8]}%"></div>`).join("");
}

function v3RecordScene(ids, s, scene, ctx) {
  const t = at(scene, ctx.fps);
  if (s.no_quote) {
    return (
      `<div class="abs" style="left:140px;top:300px;width:1500px">` +
      kicker(ids, s.side_k || "From the record", t(0.1)) +
      `<div id="${ids.next("nq")}" class="v3-noquote" ${a("in", t(0.4), { y: 24, d: 20 })}>${esc(s.side_1 || "")}</div>` +
      `</div>`
    );
  }
  ctx.grain = true;
  const q = String(s.quote || "");
  const size = q.length <= 140 ? 46 : q.length <= 260 ? 38 : 32;
  const before = q.length <= 140 ? [5, 3] : q.length <= 260 ? [3, 2] : [2, 0];
  const after = q.length <= 260 ? 4 : 2;
  const long = String(s.side_1 || "").length > 48;
  return (
    `<div id="${ids.next("cam")}" class="v3-camera" ${a("push", 0, { scale: 1.07, y: -40 })}>` +
    `<div class="v3-paper">` +
    `<div class="v3-paper-head"><span>${esc(s.paper_head || "")}</span><span>${esc(s.paper_id || "")}</span></div>` +
    `<div class="v3-paper-title">${esc(s.paper_title || "")}</div>` +
    paperLines(before[0], 0) +
    `<div class="v3-pgap"></div>` +
    paperLines(before[1], 3) +
    `<p class="v3-pquote" style="font-size:${size}px"><span id="${ids.next("hl")}" class="v3-hl" ${a("hl", t(2.6), { d: 50 })}>${esc(q)}</span></p>` +
    paperLines(after, 5) +
    `<div class="v3-paper-foot">Page ${esc(s.page ?? "")}</div>` +
    `</div></div>` +
    `<div class="v3-grain"></div><div class="v3-vignette"></div>` +
    `<div id="${ids.next("side")}" class="abs v3-side" ${a("in", t(4.6), { x: 30 })}>` +
    `<div class="v3-side-k">${esc(s.side_k || "")}</div>` +
    `<div class="v3-side-1${long ? " small" : ""}">${esc(s.side_1 || "")}</div>` +
    (s.side_2 ? `<div id="${ids.next("side2")}" class="v3-side-2" ${a("in", t(6.6), { y: 12 })}>${esc(s.side_2)}</div>` : "") +
    `<div class="v3-side-src">${esc(s.side_src || "")}<br>${esc(s.label || "Quoted as posted · retypeset for video")}</div>` +
    `</div>`
  );
}

function v3NextScene(ids, s, scene, ctx) {
  const t = at(scene, ctx.fps);
  const rows = (s.rows ?? [])
    .map(
      (r, i) =>
        `<div id="${ids.next("arow")}" class="v3-arow" ${a("in", t(1.6 + i * 0.6), { x: -16 })}><span class="v3-adot"></span>${esc(r)}</div>`,
    )
    .join("");
  return (
    `<div class="abs" style="left:140px;top:200px;width:1640px">` +
    kicker(ids, s.kicker || "What's next", t(0.1)) +
    `<div id="${ids.next("ncard")}" class="v3-agenda" ${a("pop", t(0.5), { y: 40 })}>` +
    `<div class="v3-when"><div class="v3-when-day">${esc(s.when?.[0] ?? "")}</div><div class="v3-when-date">${esc(s.when?.[1] ?? "")}</div><div class="v3-when-time">${esc(s.time || "")}</div></div>` +
    `<div class="v3-agenda-body"><div class="v3-agenda-place">${esc(s.place || "")}</div><div class="v3-agenda-items">${rows}</div></div>` +
    `</div></div>`
  );
}

function v3RoundScene(ids, s, scene, ctx) {
  const t = at(scene, ctx.fps);
  const items = s.items ?? [];
  const step = Math.min(1.2, Math.max(0.4, (scene.durationInFrames / ctx.fps - 2) / Math.max(1, items.length)));
  const cards = items
    .map((it, i) => {
      const out = it.outcome ? OUTCOME[it.outcome] ?? "Decided" : "Decided";
      const ok = it.outcome === "approved" || it.outcome === "approved_with_conditions";
      const head = [it.kind_label, it.place_short].filter(Boolean).join(" · ");
      return (
        `<div id="${ids.next("rcard")}" class="v3-rcard" ${a("pop", t(0.5 + i * step), { y: 30, damp: 16 })}>` +
        `<div class="card-head"><span class="card-kicker">${esc(head)}</span>${tag(it.tier)}</div>` +
        `<div class="v3-rtext">${esc(it.text)}</div>` +
        `<div class="v3-rfoot"><span class="v3-rout" style="color:${ok ? C.doc : C.deny};border-color:${ok ? C.doc : C.deny}">${esc(out)}</span>` +
        (it.chip ? `<span class="v3-chip">${esc(it.chip)}</span>` : "") +
        `</div></div>`
      );
    })
    .join("");
  return (
    `<div class="abs" style="left:140px;top:160px;width:1640px">` +
    kicker(ids, s.kicker || "Also decided", t(0.1)) +
    `<div class="v3-round${items.length > 2 ? " grid" : ""}">${cards}</div>` +
    `</div>`
  );
}

/** v3 scenes that hide the brand bar so the paper fills the frame. */
export const NO_BRAND_KINDS = new Set(["ident", "record"]);
const V3_KINDS = new Set(["open", "decided", "matters", "ident", "record", "next", "round"]);

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
    case "open":
      return v3OpenScene(ids, s, scene, ctx);
    case "decided":
      return v3DecidedScene(ids, s, scene, ctx);
    case "matters":
      return v3MattersScene(ids, s, scene, ctx);
    case "ident":
      return v3IdentScene(ids, s);
    case "record":
      return v3RecordScene(ids, s, scene, ctx);
    case "next":
      return v3NextScene(ids, s, scene, ctx);
    case "round":
      return v3RoundScene(ids, s, scene, ctx);
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

// v3 styles, added to the page only when a v3 scene is in it (a v2 page is
// byte for byte what it was). From the design sample of Oct 28.
const CSS_V3 = `
.v3-hook{font-family:"Newsreader";font-weight:600;line-height:1.02;letter-spacing:-.02em;color:${C.white};margin-top:26px;max-width:1560px}
.v3-hook em,.v3-big-label em{font-style:italic;font-weight:500}
.v3-hook-sub{font-family:"Newsreader";font-weight:500;font-size:46px;line-height:1.2;color:${C.white};margin-top:30px;max-width:1500px}
.v3-src{font-family:"Geist";font-size:20px;color:${C.dim};margin-top:34px}
.v3-card{background:${C.card};border-radius:22px;padding:40px 48px 44px;margin-top:30px;position:relative;box-shadow:0 30px 70px rgba(0,0,0,.35)}
.v3-card-top{display:flex;align-items:center;gap:18px;padding-right:330px}
.v3-card-kicker{font-family:"Geist";font-size:22px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${C.muted}}
.v3-card-head{font-family:"Newsreader";font-weight:600;font-size:64px;line-height:1.06;letter-spacing:-.015em;color:${C.ink};margin-top:12px;max-width:1180px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.v3-card-sub{font-family:"Geist";font-size:22px;color:${C.body};margin-top:14px}
.v3-seats{display:flex;flex-wrap:wrap;gap:14px;margin-top:30px;max-width:1300px}
.v3-seat{display:flex;align-items:center;gap:12px;font-family:"Geist";font-size:26px;font-weight:500;color:${C.ink};border:1px solid ${C.line};background:#f6f9fc;border-radius:999px;padding:10px 20px}
.v3-seat.small{font-size:21px;padding:8px 16px;gap:10px}
.v3-seat b{font-weight:700}
.v3-seat-dot{width:10px;height:10px;border-radius:10px}
.v3-stamp{position:absolute;right:44px;top:40px;font-family:"Geist";font-weight:700;font-size:34px;letter-spacing:.05em;border:3px solid;border-radius:12px;padding:8px 20px;white-space:nowrap}
.v3-big{font-family:"Newsreader";font-weight:600;font-size:260px;line-height:.9;color:${C.live};font-variant-numeric:tabular-nums;letter-spacing:-.03em}
.v3-big-label{font-family:"Newsreader";font-weight:600;font-size:60px;line-height:1.08;color:${C.white}}
.v3-axis{position:absolute;left:140px;right:140px;top:790px;height:2px;background:rgba(255,255,255,.28)}
.v3-tick{position:absolute;top:0;width:0}
.v3-tick-bar{position:absolute;left:-3px;width:6px;border-radius:3px}
.v3-tick-dot{position:absolute;left:-9px;top:781px;width:18px;height:18px;border-radius:18px;box-shadow:0 0 18px rgba(240,166,43,.6)}
.v3-tick-lab{position:absolute;left:-60px;width:220px;top:808px;font-family:"Newsreader";font-weight:600;font-size:40px;line-height:1;white-space:nowrap}
.v3-tick-lab small{display:block;font-family:"Geist";font-weight:500;font-size:17px;color:${C.dim};margin-top:6px}
.v3-tick-lab.end{left:-210px;text-align:right}
.v3-ident{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:34px;background:${C.ident}}
.v3-ident-rule{width:180px;height:2px;background:${C.live}}
.v3-ident-text{font-family:"Newsreader";font-style:italic;font-weight:500;font-size:84px;color:${C.white};letter-spacing:-.01em}
.v3-camera{position:absolute;left:150px;top:90px;width:1000px;height:1000px;transform-origin:42% 58%}
.v3-paper{position:absolute;inset:0 0 -200px 0;background:${C.paper};border-radius:4px;padding:70px 80px;transform:rotate(-1.6deg);box-shadow:0 40px 90px rgba(0,0,0,.55);background-image:linear-gradient(180deg,rgba(255,255,255,.35),rgba(0,0,0,.04)),repeating-linear-gradient(0deg,rgba(80,60,20,.025) 0 2px,transparent 2px 5px)}
.v3-paper-head{display:flex;justify-content:space-between;gap:24px;font-family:"Newsreader";font-weight:600;font-size:22px;letter-spacing:.08em;text-transform:uppercase;color:#3b3527;border-bottom:2px solid #3b3527;padding-bottom:14px}
.v3-paper-title{font-family:"Newsreader";font-weight:600;font-size:40px;color:#221d12;margin:34px 0 26px}
.v3-pline{height:15px;border-radius:3px;background:rgba(45,38,22,.16);margin:0 0 17px}
.v3-pgap{height:22px}
.v3-pquote{font-family:"Newsreader";font-weight:500;line-height:1.32;color:#1d180e;margin:14px 0 28px}
.v3-hl{background-image:linear-gradient(transparent 18%,rgba(240,166,43,.62) 18%,rgba(240,166,43,.62) 92%,transparent 92%);background-repeat:no-repeat;background-size:0% 100%;-webkit-box-decoration-break:clone;box-decoration-break:clone;padding:0 4px}
.v3-paper-foot{position:absolute;left:80px;right:80px;bottom:250px;text-align:center;font-family:"Newsreader";font-size:22px;color:#5b5341}
.v3-grain{position:absolute;inset:0;pointer-events:none;opacity:.10;mix-blend-mode:overlay;background-image:url("assets/grain.svg")}
.v3-vignette{position:absolute;inset:0;pointer-events:none;background:radial-gradient(75% 85% at 35% 50%,transparent 55%,rgba(3,12,24,.75) 100%)}
.v3-side{left:1310px;top:290px;width:520px}
.v3-side-k{font-family:"Geist";font-weight:600;font-size:24px;letter-spacing:.14em;text-transform:uppercase;color:${C.live}}
.v3-side-1{font-family:"Newsreader";font-weight:600;font-size:64px;line-height:1.05;color:${C.white};margin-top:20px}
.v3-side-1.small{font-size:44px;line-height:1.1}
.v3-side-2{font-family:"Newsreader";font-weight:600;font-size:56px;line-height:1.05;color:${C.live};margin-top:16px}
.v3-side-src{font-family:"Geist";font-size:19px;color:${C.dim};margin-top:34px;line-height:1.5}
.v3-noquote{font-family:"Newsreader";font-weight:600;font-size:84px;line-height:1.08;letter-spacing:-.015em;color:${C.white};margin-top:26px}
.v3-agenda{display:flex;background:${C.card};border-radius:22px;overflow:hidden;margin-top:30px;box-shadow:0 30px 70px rgba(0,0,0,.4);max-width:1300px}
.v3-when{width:270px;flex:none;background:${C.navy2};color:${C.white};display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px 0;border-right:5px solid ${C.live}}
.v3-when-day{font-family:"Geist";font-weight:700;font-size:26px;letter-spacing:.12em;color:${C.live}}
.v3-when-date{font-family:"Newsreader";font-weight:600;font-size:68px;line-height:1.1;white-space:nowrap}
.v3-when-time{font-family:"Geist";font-size:20px;color:${C.dim}}
.v3-agenda-body{padding:34px 40px;flex:1}
.v3-agenda-place{font-family:"Newsreader";font-weight:600;font-size:52px;color:${C.ink};line-height:1.1}
.v3-agenda-items{display:grid;gap:16px;margin-top:22px}
.v3-arow{display:flex;align-items:center;gap:14px;font-family:"Geist";font-size:30px;color:${C.body}}
.v3-adot{width:11px;height:11px;border-radius:11px;background:${C.live};flex:none}
.v3-round{display:grid;gap:22px;margin-top:30px;max-width:1300px}
.v3-round.grid{grid-template-columns:1fr 1fr;max-width:none}
.v3-rcard{background:${C.card};border-radius:18px;padding:24px 30px 24px;box-shadow:0 24px 60px rgba(0,0,0,.35);border:1px solid ${C.line}}
.v3-rtext{font-family:"Newsreader";font-size:36px;font-weight:600;color:${C.ink};margin-top:8px;line-height:1.15;letter-spacing:-.01em;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.v3-rfoot{display:flex;align-items:center;gap:14px;margin-top:16px}
.v3-rout{font-family:"Geist";font-weight:700;font-size:20px;letter-spacing:.04em;text-transform:uppercase;border:2px solid;border-radius:9px;padding:4px 12px}
.v3-chip{font-family:"Geist";font-weight:600;font-size:20px;color:${C.navy};background:${C.live};border-radius:999px;padding:6px 14px}
.brand{position:absolute;left:110px;top:44px;display:flex;align-items:center;gap:18px;z-index:5}
`;

const GRAIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>
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
  const ctx = { fps, map, state: script.state, title: script.title, photos: new Set(), grain: false };
  const close = timeline.scenes.find((s) => s.kind === "outro");
  const open = timeline.scenes.find((s) => s.kind === "title") ?? timeline.scenes.find((s) => s.kind === "open");
  const v3 = timeline.scenes.some((s) => V3_KINDS.has(s.kind));
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
  const brandInner = `${wordmark(30)}<span class="brand-sep"></span><span class="brand-text">${esc(script.state_name || script.state)} · ${esc(weekLabel)}</span>`;
  let brand =
    brandUntil > 0
      ? `<div id="brand" class="clip" data-start="0" data-duration="${brandUntil}" data-track-index="4">${brandInner}</div>`
      : "";
  if (v3) {
    // v3: the brand bar steps aside for the segment card and the page.
    brand = brandSpans(timeline, brandUntil)
      .map(([start, dur], i) => `<div id="brand-${i}" class="clip brand" data-start="${start}" data-duration="${dur}" data-track-index="4">${brandInner}</div>`)
      .join("");
  }
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
  return { html, photos: [...ctx.photos], duration, captionGroups: groups.length, grain: ctx.grain };
}

/** [start, duration] seconds the brand bar shows: up to the close, minus ident and record scenes. */
export function brandSpans(timeline, until) {
  const fps = timeline.fps;
  const spans = [];
  let from = 0;
  for (const sc of timeline.scenes) {
    const s0 = sec(sc.from, fps);
    if (s0 >= until) break;
    if (NO_BRAND_KINDS.has(sc.kind)) {
      if (s0 > from) spans.push([from, Number((s0 - from).toFixed(4))]);
      from = sec(sc.from + sc.durationInFrames, fps);
    }
  }
  if (until > from) spans.push([from, Number((until - from).toFixed(4))]);
  return spans;
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
  if (out.grain) await writeFile(path.join(outDir, "assets", "grain.svg"), GRAIN_SVG);
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
