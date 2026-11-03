// Isometric building drawings for the weekly video v3 (Nov 3). Pure.
//
// One drawing describes one case: the quick round's cards, the lead's "What
// happened" card and The long road's last station each get a single lot with
// the building its case is about. Never a packed town: a cluster of buildings
// implies a density the record doesn't show.
//
// The kernel and parts follow fieldstate-site lib/isoKit.js (branch
// claude/town-tile, Nov 2), and the kind rules follow its classifier
// (lib/townTile.js classifyCase). Both are copied here, not imported: the
// render never reads the site repository. The method is the iso-figure
// skill's (MrBongoC/ai-iso-skill, MIT) and the ISO-GLOW look: every flat
// shape is an ordinary SVG rect or path drawn in a face's own 2D
// coordinates, and one `matrix()` lays it on its plane. A box is its three
// visible faces. Our own code.
//
// Axes: +x runs down-right on screen, +y down-left, +z up. The viewer sees
// the top (TOP), the y = max face (FRONT, lower left) and the x = max face
// (SIDE, lower right). Paint back to front: smaller x + y first, lower z
// first.
//
// Parts return shape lists, never markup: { t: 'rect', tf, w, h, r, c },
// { t: 'path', tf, d, c }, { t: 'circle', tf, cx, cy, r, c }. `tf` is the
// plane's matrix; `c` the class list (f = opaque face, ft/fl/fr =
// top/front/side, d = detail line, lot, road). isoSvg() writes them all the
// same way: one render path. The look (navy faces, light hairlines, one lit
// colour) is CSS in hyperframes/generate.mjs (CSS_V3, .v3-iso).

export const C = Math.cos(Math.PI / 6);
export const S = Math.sin(Math.PI / 6);

/** One lot, in scene units. Every part is drawn inside one lot. */
export const CELL = 40;

function r3(n) {
  const v = Math.round(n * 1000) / 1000;
  return Object.is(v, -0) ? 0 : v;
}

/** A scene point (x, y, z) on the screen: [sx, sy]. Linear, so it projects directions too. */
export function P(x, y, z = 0) {
  return [r3((x - y) * C), r3((x + y) * S - z)];
}

/**
 * The SVG transform that lays a group's 2D coordinates on a plane through O
 * spanned by U (local x) and V (local y).
 */
export function plane(O, U, V) {
  const o = P(...O);
  const u = P(...U);
  const v = P(...V);
  return `matrix(${u[0]} ${u[1]} ${v[0]} ${v[1]} ${o[0]} ${o[1]})`;
}

/** z = const; local x along +x, local y along +y. Pass the plane's back corner. */
export const TOP = (x, y, z) => plane([x, y, z], [1, 0, 0], [0, 1, 0]);
/** y = const (faces lower left); local x along +x, local y down. Pass its top-left corner. */
export const FRONT = (x, y, z) => plane([x, y, z], [1, 0, 0], [0, 0, -1]);
/** x = const (faces lower right); local x along -y, local y down. Pass its top-left corner. */
export const SIDE = (x, y, z) => plane([x, y, z], [0, -1, 0], [0, 0, -1]);

const rect = (tf, w, h, c, r = 0) => ({ t: "rect", tf, w: r3(w), h: r3(h), r: r3(r), c });
const path = (tf, d, c) => ({ t: "path", tf, d, c });

/** A box at (x, y, z), w along x, d along y, h up: its side, front and top faces, in paint order. */
export function box(x, y, z, w, d, h, { r = 0, c = "" } = {}) {
  const rr = Math.min(r, h / 4);
  const add = c ? ` ${c}` : "";
  return [
    rect(SIDE(x + w, y + d, z + h), d, h, `f fr${add}`, rr),
    rect(FRONT(x, y + d, z + h), w, h, `f fl${add}`, rr),
    rect(TOP(x, y, z + h), w, d, `f ft${add}`, r),
  ];
}

function n(v) {
  return String(r3(v));
}

/**
 * Small rectangles in a grid on a face, as one detail path: `cols` x `rows`
 * openings of size ww x wh, spread across a face w x h with margins mx, my.
 */
export function grid(tf, w, h, { cols, rows, ww, wh, mx = 2, my = 2, c = "d" }) {
  if (cols < 1 || rows < 1) return null;
  const gx = cols > 1 ? (w - 2 * mx - cols * ww) / (cols - 1) : 0;
  const gy = rows > 1 ? (h - 2 * my - rows * wh) / (rows - 1) : 0;
  const x0 = cols > 1 ? mx : (w - ww) / 2;
  const y0 = rows > 1 ? my : (h - wh) / 2;
  let d = "";
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      d += `M${n(x0 + i * (ww + gx))} ${n(y0 + j * (wh + gy))}h${n(ww)}v${n(wh)}h${n(-ww)}Z`;
    }
  }
  return path(tf, d, c);
}

/** Horizontal lines across a face (ribbon windows, vent slits). */
function hlines(tf, x0, x1, ys, c = "d") {
  return path(tf, ys.map((y) => `M${n(x0)} ${n(y)}H${n(x1)}`).join(""), c);
}

/** Vertical lines down a face (ribs, columns, door slats). */
function vlines(tf, xs, y0, y1, c = "d") {
  return path(tf, xs.map((x) => `M${n(x)} ${n(y0)}V${n(y1)}`).join(""), c);
}

function range(from, to, step) {
  const out = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(v);
  return out;
}

/** A pitched roof with its ridge along x, over the footprint (x, y, w, d) at wall height z. */
function gableX(x, y, z, w, d, rh) {
  return [
    rect(plane([x, y, z], [1, 0, 0], [0, d / 2, rh]), w, 1, "f roof rb"),
    rect(plane([x, y + d / 2, z + rh], [1, 0, 0], [0, d / 2, -rh]), w, 1, "f roof rf"),
    path(SIDE(x + w, y + d, z), `M0 0H${n(d)}L${n(d / 2)} ${n(-rh)}Z`, "f fr"),
  ];
}

/** A pitched roof with its ridge along y: the gable end faces front. */
function gableY(x, y, z, w, d, rh) {
  return [
    rect(plane([x, y, z], [0, 1, 0], [w / 2, 0, rh]), d, 1, "f roof rb"),
    rect(plane([x + w / 2, y, z + rh], [0, 1, 0], [w / 2, 0, -rh]), d, 1, "f roof rf"),
    path(FRONT(x, y + d, z), `M0 0H${n(w)}L${n(w / 2)} ${n(-rh)}Z`, "f fl"),
  ];
}

// Size buckets as the site's kit. The video draws every part at its default
// (M): a size comes only from a stated acreage or unit count, which a card
// doesn't carry, and the site's large house is a cluster of three, which is
// the density this module never draws.
const FOOT = { S: 0.82, M: 1, L: 1.14 };
const RISE = { S: 0.7, M: 1, L: 1.4 };

function scale(size) {
  return { f: FOOT[size] || 1, h: RISE[size] || 1 };
}

/** The footprint of a part, centred in the lot at (X, Y). */
function seat(X, Y, w, d, dx = 0, dy = 0) {
  return { x: X + (CELL - w) / 2 + dx, y: Y + (CELL - d) / 2 + dy };
}

/** The ground plate every piece stands on. */
export function lot(X, Y) {
  return [rect(TOP(X + 1.5, Y + 1.5, 0), CELL - 3, CELL - 3, "lot", 1.5)];
}

function oneHouse(x, y, s) {
  const w = 15 * s;
  const d = 13 * s;
  const h = 7.5 * s;
  const rh = 6 * s;
  const front = FRONT(x, y + d, h);
  const side = SIDE(x + w, y + d, h);
  return [
    ...box(x, y, 0, w, d, h),
    path(front, `M${n(w * 0.62)} ${n(h)}V${n(h * 0.42)}H${n(w * 0.62 + 2.6 * s)}V${n(h)}`, "d"),
    grid(front, w * 0.5, h, { cols: 1, rows: 1, ww: 2.8 * s, wh: 2.4 * s, mx: 2, my: 2 }),
    grid(side, d, h, { cols: 2, rows: 1, ww: 2.4 * s, wh: 2.4 * s, mx: 2.6 * s, my: 2.2 * s }),
    ...gableX(x, y, h, w, d, rh),
  ];
}

/** Single-family house: one house on its lot (the site's L cluster is never drawn here). */
export function house(X, Y, { size } = {}) {
  const s = size === "S" ? 0.86 : 1.12;
  const at = seat(X, Y, 15 * s, 13 * s);
  return oneHouse(at.x, at.y, s);
}

/** A row of attached townhomes, each with its gable to the street. */
export function townhomes(X, Y, { size } = {}) {
  const count = size === "S" ? 3 : size === "L" ? 5 : 4;
  const uw = size === "L" ? 6 : 7;
  const d = 15;
  const h = 10;
  const rh = 3.6;
  const at = seat(X, Y, uw * count, d);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const x = at.x + i * uw;
    const front = FRONT(x, at.y + d, h);
    out.push(...box(x, at.y, 0, uw, d, h));
    out.push(path(front, `M${n(uw * 0.3)} ${n(h)}V${n(h * 0.55)}H${n(uw * 0.3 + 2)}V${n(h)}`, "d"));
    out.push(grid(front, uw, h * 0.45, { cols: 1, rows: 1, ww: 2.6, wh: 2.2, mx: 2, my: 1.6 }));
    out.push(...gableY(x, at.y, h, uw, d, rh));
  }
  const side = SIDE(at.x + uw * count, at.y + d, h);
  out.push(grid(side, d, h, { cols: 3, rows: 2, ww: 2, wh: 2, mx: 2.4, my: 1.8 }));
  return out;
}

function storeys(h) {
  return Math.max(2, Math.round(h / 5));
}

/** Apartment block: a taller box with a window on every floor. */
export function multifamily(X, Y, { size, shop = false } = {}) {
  const { f, h: k } = scale(size);
  const w = 25 * f;
  const d = 21 * f;
  const h = 22 * k;
  const at = seat(X, Y, w, d);
  const front = FRONT(at.x, at.y + d, h);
  const side = SIDE(at.x + w, at.y + d, h);
  const floors = storeys(h);
  const upper = shop ? h - 5 : h;
  const out = [
    ...box(at.x, at.y, 0, w, d, h),
    grid(front, w, upper, { cols: Math.round(w / 4.2), rows: Math.max(1, floors - (shop ? 1 : 0)), ww: 1.8, wh: 2.2, mx: 2.2, my: 2 }),
    grid(side, d, upper, { cols: Math.round(d / 4.2), rows: Math.max(1, floors - (shop ? 1 : 0)), ww: 1.8, wh: 2.2, mx: 2.2, my: 2 }),
    path(TOP(at.x, at.y, h), `M1.6 1.6H${n(w - 1.6)}V${n(d - 1.6)}H1.6Z`, "d"),
  ];
  if (shop) {
    out.push(hlines(front, 0, w, [h - 5]));
    out.push(hlines(side, 0, d, [h - 5]));
    out.push(path(front, `M2 ${n(h - 0.01)}V${n(h - 3.6)}H${n(w * 0.55)}V${n(h - 0.01)}`, "d"));
    out.push(path(side, `M2 ${n(h - 0.01)}V${n(h - 3.6)}H${n(d - 2)}V${n(h - 0.01)}`, "d"));
  } else {
    out.push(path(front, `M${n(w / 2 - 1.6)} ${n(h)}V${n(h - 3.4)}H${n(w / 2 + 1.6)}V${n(h)}`, "d"));
  }
  return out;
}

/** Mixed use: the apartment block over a ground floor of shops. */
export function mixed(X, Y, opts = {}) {
  return multifamily(X, Y, { ...opts, shop: true });
}

/** A low shop block with a parapet, a shop window and a striped awning. */
export function commercial(X, Y, { size } = {}) {
  const { f } = scale(size);
  const w = 27 * f;
  const d = 21 * f;
  const h = 9;
  const at = seat(X, Y, w, d, 0, -1.5);
  const front = FRONT(at.x, at.y + d, h);
  const side = SIDE(at.x + w, at.y + d, h);
  // The awning: a strip sloping out from the front wall, over the shop window.
  const ax = at.x + 2;
  const aw = w - 4;
  const awning = plane([ax, at.y + d, 6.2], [1, 0, 0], [0, 3, -1.6]);
  const stripes = range(aw / 8, aw - 0.1, aw / 8);
  return [
    ...box(at.x, at.y, 0, w, d, h),
    hlines(front, 0, w, [2.4]),
    hlines(side, 0, d, [2.4]),
    path(front, `M3 ${n(h)}V${n(h - 2.6)}H${n(w - 8)}V${n(h)}M${n(w - 6)} ${n(h)}V${n(h - 3)}H${n(w - 3)}V${n(h)}`, "d"),
    grid(side, d, h - 2.4, { cols: 3, rows: 1, ww: 2.6, wh: 2.2, mx: 3, my: 2.6 }),
    path(TOP(at.x, at.y, h), `M1.4 1.4H${n(w - 1.4)}V${n(d - 1.4)}H1.4Z`, "d"),
    rect(awning, aw, 1, "f fa"),
    vlines(awning, stripes, 0, 1),
  ];
}

/** An office tower with ribbon windows and a plant room on the roof. */
export function office(X, Y, { size } = {}) {
  const { f, h: k } = scale(size);
  const w = 19 * f;
  const d = 19 * f;
  const h = 30 * k;
  const at = seat(X, Y, w, d);
  const front = FRONT(at.x, at.y + d, h);
  const side = SIDE(at.x + w, at.y + d, h);
  const bands = range(3, h - 3, 3.2);
  return [
    ...box(at.x, at.y, 0, w, d, h),
    hlines(front, 1.2, w - 1.2, bands),
    hlines(side, 1.2, d - 1.2, bands),
    ...box(at.x + w * 0.3, at.y + d * 0.3, h, w * 0.4, d * 0.4, 2.6),
  ];
}

/** A warehouse: long and low, roll-up doors on the front, ribbed side. */
export function industrial(X, Y, { size } = {}) {
  const { f } = scale(size);
  const w = 32 * f;
  const d = 25 * f;
  const h = 10.5;
  const at = seat(X, Y, w, d);
  const front = FRONT(at.x, at.y + d, h);
  const side = SIDE(at.x + w, at.y + d, h);
  const doors = [0.14, 0.42, 0.7].map((t) => w * t);
  const dw = w * 0.17;
  let doorPath = "";
  for (const x of doors) doorPath += `M${n(x)} ${n(h)}V${n(h - 6)}H${n(x + dw)}V${n(h)}`;
  const slats = range(h - 5, h - 1, 1.3);
  const slatPath = doors.map((x) => slats.map((y) => `M${n(x)} ${n(y)}H${n(x + dw)}`).join("")).join("");
  return [
    ...box(at.x, at.y, 0, w, d, h),
    path(front, doorPath, "d"),
    path(front, slatPath, "d"),
    vlines(side, range(2.5, d - 2.5, 2.5), 1.2, h),
    path(TOP(at.x, at.y, h), `M${n(w * 0.2)} 3V${n(d - 3)}M${n(w * 0.5)} 3V${n(d - 3)}M${n(w * 0.8)} 3V${n(d - 3)}`, "d"),
  ];
}

/** A data center: a long low box with rows of vents and fan units on the roof. */
export function datacenter(X, Y, { size } = {}) {
  const { f } = scale(size);
  const w = 34 * f;
  const d = 19 * f;
  const h = 8;
  const at = seat(X, Y, w, d);
  const front = FRONT(at.x, at.y + d, h);
  const side = SIDE(at.x + w, at.y + d, h);
  const slit = (span, y) => range(1.6, span - 2.6, 1.6).map((x) => `M${n(x)} ${n(y)}h1`).join("");
  const out = [
    ...box(at.x, at.y, 0, w, d, h),
    path(front, slit(w, 2.2) + slit(w, 3.6) + slit(w, 5), "d"),
    path(side, slit(d, 2.2) + slit(d, 3.6) + slit(d, 5), "d"),
  ];
  const units = 3;
  const uw = 6;
  for (let i = 0; i < units; i += 1) {
    const ux = at.x + 3 + i * ((w - 6 - uw) / (units - 1));
    const uy = at.y + (d - uw) / 2;
    out.push(...box(ux, uy, h, uw, uw, 2.4));
    out.push({ t: "circle", tf: TOP(ux, uy, h + 2.4), cx: uw / 2, cy: uw / 2, r: 2, c: "d" });
  }
  return out;
}

/** Civic or institutional: a hall with columns, a cupola and a flagpole. */
export function civic(X, Y, { size } = {}) {
  const { f } = scale(size);
  const w = 26 * f;
  const d = 19 * f;
  const h = 12;
  const at = seat(X, Y, w, d, 0, -2);
  const front = FRONT(at.x, at.y + d, h);
  const side = SIDE(at.x + w, at.y + d, h);
  const cols = range(w * 0.22, w * 0.78 + 0.01, (w * 0.56) / 4);
  return [
    ...box(at.x, at.y, 0, w, d, h),
    hlines(front, 0, w, [2.2]),
    vlines(front, cols, 2.2, h),
    grid(side, d, h - 2.2, { cols: 3, rows: 1, ww: 2, wh: 3.4, mx: 3, my: 3.2 }),
    ...box(at.x + w / 2 - 3, at.y + d / 2 - 3, h, 6, 6, 4.5),
    ...gableX(at.x + w / 2 - 3, at.y + d / 2 - 3, h + 4.5, 6, 6, 3),
    // The flagpole stands in front of the hall, at the front-left corner of the lot.
    path(FRONT(X + 5, Y + CELL - 5, 0), "M0 0V-21", "d pole"),
    rect(FRONT(X + 5, Y + CELL - 5, 21), 5, 3.2, "f fl flag"),
  ];
}

/** A road case (a thoroughfare plan change): a strip of road across the lot. */
export function road(X, Y) {
  const tf = TOP(X, Y + 12, 0.4);
  const dashes = range(2, CELL - 5, 6).map((x) => `M${n(x)} 8h3`).join("");
  return [
    rect(tf, CELL, 16, "road"),
    path(tf, `M0 1.2H${CELL}M0 14.8H${CELL}`, "d"),
    path(tf, dashes, "d road-mark"),
  ];
}

/** Anything the record doesn't let us name: a plain block with a few windows. */
export function generic(X, Y, { size } = {}) {
  const { f } = scale(size);
  const w = 21 * f;
  const d = 21 * f;
  const h = 14;
  const at = seat(X, Y, w, d);
  const front = FRONT(at.x, at.y + d, h);
  const side = SIDE(at.x + w, at.y + d, h);
  return [
    ...box(at.x, at.y, 0, w, d, h),
    grid(front, w, h, { cols: 3, rows: 2, ww: 2.2, wh: 2.4, mx: 3, my: 2.6 }),
    grid(side, d, h, { cols: 3, rows: 2, ww: 2.2, wh: 2.4, mx: 3, my: 2.6 }),
  ];
}

/** An empty lot: outlined in dashes, with two survey stakes. */
export function empty(X, Y) {
  const inset = 5;
  const span = CELL - inset * 2;
  const stake = (x, y) => [path(FRONT(x, y, 0), "M0 0V-6", "d stake"), rect(FRONT(x, y, 6), 2.2, 1.6, "f fl flag")];
  return [
    path(TOP(X + inset, Y + inset, 0.3), `M0 0H${span}V${span}H0Z`, "d dash"),
    ...stake(X + inset, Y + inset),
    ...stake(X + CELL - inset, Y + CELL - inset),
  ];
}

/** Every part by kind. */
export const PARTS = { house, townhomes, multifamily, mixed, commercial, office, industrial, datacenter, civic, road, generic, empty };

/** The tallest point a part reaches above the ground, for fitting the viewBox. */
export function partHeight(kind, size) {
  const k = RISE[size] || 1;
  switch (kind) {
    case "house": return 15;
    case "townhomes": return 14;
    case "multifamily":
    case "mixed": return 22 * k;
    case "office": return 30 * k + 2.6;
    case "industrial": return 10.5;
    case "datacenter": return 10.4;
    case "civic": return 21 + 3.2;
    case "generic": return 14;
    case "empty": return 7.6;
    default: return 1;
  }
}

/**
 * The viewBox that holds every given scene point, with a margin on each side
 * (a share of that axis's span; 0.1 by default): { x, y, w, h, text }.
 */
export function fitView(points, margin = 0.1) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y, z = 0] of points) {
    const [sx, sy] = P(x, y, z);
    minX = Math.min(minX, sx);
    maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy);
    maxY = Math.max(maxY, sy);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0, text: "0 0 0 0" };
  const padX = (maxX - minX) * margin;
  const padY = (maxY - minY) * margin;
  const x = r3(minX - padX);
  const y = r3(minY - padY);
  const w = r3(maxX - minX + padX * 2);
  const h = r3(maxY - minY + padY * 2);
  return { x, y, w, h, text: `${x} ${y} ${w} ${h}` };
}

// ── which building: the site's classifier (lib/townTile.js classifyCase) ─────

// Case kinds decided on a site. Code changes (text_amendment), annexations,
// budgets, contracts, renamings and the rest are not buildings on a lot.
export const SITE_KINDS = new Set(["rezoning", "zoning", "special_use", "variance", "site_plan", "subdivision_plat", "plan_amendment"]);

// A case that changes the code's own text rather than a site is not a
// building either. A variance from the code is about a site and stays.
const CODE_TEXT = /\b(?:amend\w*|correct\w*)\b[^.;]{0,120}\b(?:development code|chapter\s+\d+[a-z]?|division\s+\d)|\btext amendment\b/i;

const BUILT = new Set(["approved", "approved_with_conditions"]);
const DENIED = new Set(["denied"]);

function tidy(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

/**
 * The part of a record's text that says what was granted: the old district
 * ("on property zoned …", "from <old> to <new>") and anything terminated are
 * cut, so a rezoning away from single-family homes never draws a house.
 */
export function grantedText(text) {
  let t = tidy(text);
  t = t.replace(/\b(?:property|properties|land|tracts?|lots?)\s+(?:presently\s+|currently\s+)?zoned\b[^;]*/gi, " ");
  t = t.replace(/\b(?:terminating|repealing|removing)\b[^;]*/gi, " ");
  t = t.replace(/\bfrom\s+(?:an?\s+)?[A-Z][A-Za-z0-9().-]*(?:\s+[A-Z][A-Za-z0-9().-]*)*?\s+to\s+/g, " to ");
  t = t.replace(/\b[A-Z]{1,4}-?\d*(?:\.\d)?(?:\([A-Z]{1,3}\))?\s+to\s+(?=[A-Z]{1,4}-?\d)/g, " to ");
  return tidy(t);
}

// Uses named in words, strongest first. The first that matches decides.
const USE_RULES = [
  ["datacenter", /\bdata\s*cent(?:er|re)s?\b/i, "data center"],
  ["multifamily", /\bmulti-?family\b|\bapartments?\b|\bmulti-?unit\b|\bsenior (?:housing|living)\b/i, "multifamily homes"],
  ["townhomes", /\btown\s?(?:house|home)s?\b/i, "townhomes"],
  ["house", /\bsingle[- ]family\b|\bgroup dwelling\b|\bduplex(?:es)?\b|\bsubdivision\b/i, "homes"],
  ["industrial", /\bindustrial\b|\bwarehouse\b|\bmini-?warehouse\b|\bself[- ]storage\b|\bdistribution (?:center|facility)\b|\bmanufactur\w*\b|\btruck (?:parking|stop|terminal)\b|\boutside storage\b|\blogistics\b/i, "industrial"],
  ["civic", /\bschool\b|\bchurch\b|\bplace of worship\b|\bcommunity center\b|\brecreation (?:center|club|area)\b|\blibrary\b|\bfire station\b|\bpolice station\b|\bgovernment installation\b|\bmuseum\b|\bhospital\b/i, "civic or institutional"],
  ["office", /\boffices?\b|\bmedical (?:lab|laboratory|clinic)\b|\blaboratory\b/i, "office"],
  ["commercial", /\bretail\b|\bshopping cent(?:er|re)\b|\brestaurants?\b|\bbars?\b|\bdance hall\b|\blive music\b|\bnightclub\b|\balcohol(?:ic)?\b|\bstores?\b|\bgrocery\b|\bdrive-(?:through|thru|in)\b|\bhotel\b|\bmotel\b|\bcommercial\b|\bshopfront\b|\bcar wash\b|\bgas station\b|\bconvenience\b/i, "commercial"],
  ["mixed", /\bmixed[- ]use\b|\bmix of uses\b/i, "mixed use"],
];

// District codes, read only from the granted text.
const CODE_RULES = [
  ["multifamily", /\b(?:MF-?\d|RM-?\d)/, "a multifamily district"],
  ["townhomes", /\bTH-?\d/, "a townhouse district"],
  ["house", /\b(?:R-?\d+(?:\.\d)?(?:\([A-Z]\))?|RS-?\d+|SF-?\d+)(?![\w-])/, "a single-family district"],
  ["mixed", /\b(?:[A-Z]{0,2}MU-?\d|MX-?\d)/, "a mixed-use district"],
  ["industrial", /\b(?:LI|IR|IM|HI|I-\d)\b/, "an industrial district"],
  ["office", /\b(?:O-\d|OI|O-I)\b/, "an office district"],
  ["commercial", /\b(?:CR|CS|GR|RR|NS|CA-\d|B-\d|HB|C-\d)\b/, "a commercial district"],
];

const ROAD = /\bthoroughfare\b|\broadway\b|\bstreet plan\b|\blanes?\b.*\broad\b|\bwiden\w*\b/i;

/**
 * The site's kind for one case, or null when the case is not drawn: the
 * same function as fieldstate-site lib/townTile.js classifyCase.
 * { kind, why } (denied: { kind: 'empty', why, use }).
 */
export function classifyCase({ outcome, case_kind: caseKind, title, headline, headline_plain: plain }) {
  const key = tidy(outcome).toLowerCase();
  if (!BUILT.has(key) && !DENIED.has(key)) return null;
  const kind = tidy(caseKind).toLowerCase();
  if (!SITE_KINDS.has(kind)) return null;
  const all = [title, plain, headline].map(tidy).filter(Boolean);
  if (!all.length) return null;
  if (all.some((t) => CODE_TEXT.test(t))) return null;
  const use = (() => {
    if (kind === "plan_amendment") {
      return all.some((t) => ROAD.test(t)) ? { kind: "road", why: "a road plan" } : { kind: "generic", why: "a plan change" };
    }
    const granted = all.map(grantedText).join(" · ");
    for (const [k, re, why] of USE_RULES) if (re.test(granted)) return { kind: k, why };
    for (const [k, re, why] of CODE_RULES) if (re.test(granted)) return { kind: k, why };
    return { kind: "generic", why: "" };
  })();
  if (DENIED.has(key)) return { kind: "empty", why: use.why, use: use.kind };
  return use;
}

// ── a card's case kind ──────────────────────────────────────────────────────

// The engine's kind labels (the card kicker's middle part: "Charlotte ·
// Zoning · Oct 19") back to the record's case kinds. A label not here
// ("Item", "Contract", "Budget", "Moratorium", "Sign district") is not a site
// kind: no building.
const LABEL_KIND = {
  rezoning: "rezoning",
  zoning: "zoning",
  "zoning case": "zoning",
  "special use": "special_use",
  "special use permit": "special_use",
  "specific use permit": "special_use",
  "conditional use": "special_use",
  "conditional use permit": "special_use",
  variance: "variance",
  "site plan": "site_plan",
  plat: "subdivision_plat",
  "subdivision plat": "subdivision_plat",
  subdivision: "subdivision_plat",
  "preliminary plat": "subdivision_plat",
  "final plat": "subdivision_plat",
  "plan amendment": "plan_amendment",
  "comprehensive plan amendment": "plan_amendment",
  "land use plan amendment": "plan_amendment",
};

/** A kind label ("Site plan", "special_use") as a case kind, or null. */
export function caseKindOfLabel(label) {
  const t = tidy(label).toLowerCase().replace(/_/g, " ");
  if (!t) return null;
  return LABEL_KIND[t] ?? null;
}

/**
 * The case kind a card's kicker names ("Union County, NC · Rezoning ·
 * RZ-2026-010" → rezoning), or null. The first part that is a known kind
 * label decides; `known` says whether any part was a kind label at all
 * (a label like "Contract" is known and not a site).
 */
export function caseKindOfKicker(kicker) {
  const parts = tidy(kicker).split(/\s+·\s+/).filter(Boolean);
  for (const p of parts) {
    const k = caseKindOfLabel(p);
    if (k) return k;
  }
  return null;
}

// A headline that says its own kind ("Charlotte City Council rezoning
// petition by …"): only for a beat with no kicker (The long road).
const TEXT_KINDS = [
  ["rezoning", /\brezon(?:e|ing)s?\b/i],
  ["special_use", /\bspecial use\b|\bspecific use permit\b|\bconditional use\b/i],
  ["variance", /\bvariances?\b/i],
  ["site_plan", /\bsite plans?\b/i],
  ["subdivision_plat", /\b(?:preliminary |final )?plats?\b|\bsubdivision\b/i],
  ["plan_amendment", /\b(?:comprehensive |land use |future land use )?plan amendments?\b/i],
  ["zoning", /\bzoning (?:case|petition|request|application)\b/i],
];

/** A case kind from a headline's own words, or null. */
export function caseKindOfText(text) {
  const t = tidy(text);
  for (const [k, re] of TEXT_KINDS) if (re.test(t)) return k;
  return null;
}

// ── one case's figure ───────────────────────────────────────────────────────

const REFUSED = new Set(["denied", "failed"]);
const WITHDRAWN = new Set(["withdrawn"]);

/**
 * The drawing for one case, or null when nothing is drawn.
 *
 *   { use, why, state }   use: the part the record names (house, industrial,
 *                         …, generic); state:
 *     "built"   approved: the building stands on its lot
 *     "refused" denied or voted down: an empty dashed lot, the requested
 *               building as a dashed ghost (when `ghost` is on)
 *     "empty"   withdrawn (or refused with `ghost` off): the empty lot only
 *
 * The kind: `caseKind` when the engine gives it, else the card's kicker,
 * else (only with no kicker) the headline's own words. The use: the site's
 * classifier on the headline. Not a site kind, a code-text case, or an
 * outcome that isn't a decision (deferred, continued): null.
 */
export function caseFigure({ kicker = "", head = "", outcome = "", caseKind = "", ghost = true } = {}) {
  const kind = caseKindOfLabel(caseKind) || tidy(caseKind).toLowerCase() || caseKindOfKicker(kicker) || (tidy(kicker) ? null : caseKindOfText(head));
  if (!kind || !SITE_KINDS.has(kind)) return null;
  const out = tidy(outcome).toLowerCase();
  const decided = BUILT.has(out) || REFUSED.has(out) || WITHDRAWN.has(out);
  if (!decided) return null;
  // The use the case asked for, read as the site reads an approval.
  const use = classifyCase({ outcome: "approved", case_kind: kind, title: head });
  if (!use) return null;
  if (BUILT.has(out)) return { use: use.kind, why: use.why, state: "built" };
  if (REFUSED.has(out) && ghost) return { use: use.kind, why: use.why, state: "refused" };
  return { use: use.kind, why: use.why, state: "empty" };
}

// ── SVG ─────────────────────────────────────────────────────────────────────

// Every figure is drawn at one scale: the same width in scene units (the lot
// and a margin), and as tall as its own building, so a house stays smaller
// than an office wherever both appear.
const PAD = 3.5;
const HALF = r3(CELL * C);

/**
 * The viewBox for a figure: { x, y, w, h, text }. Every figure's `w` is the
 * same; `h` is the lot plus its building's height (an empty lot: its stakes).
 */
export function figureView(fig) {
  const top = !fig || fig.state === "empty" ? partHeight("empty") : Math.max(partHeight(fig.use), fig.state === "refused" ? partHeight("empty") : 0);
  const x = r3(-HALF - PAD);
  const y = r3(-top - PAD);
  const w = r3(2 * (HALF + PAD));
  const h = r3(CELL + top + 2 * PAD);
  return { x, y, w, h, text: `${x} ${y} ${w} ${h}` };
}

function shapeSvg(s) {
  if (!s) return "";
  const tf = ` transform="${s.tf}"`;
  if (s.t === "rect") return `<rect${tf} width="${s.w}" height="${s.h}"${s.r ? ` rx="${s.r}"` : ""} class="${s.c}"/>`;
  if (s.t === "path") return `<path${tf} d="${s.d}" class="${s.c}"/>`;
  if (s.t === "circle") return `<circle${tf} cx="${s.cx}" cy="${s.cy}" r="${s.r}" class="${s.c}"/>`;
  return "";
}

/** The shapes of a figure's layer: "lot" (the plate, and the dashes and stakes of an empty lot) or "bld" (the building or its ghost). */
export function figureShapes(fig, layer) {
  if (!fig) return [];
  if (layer === "lot") return [...lot(0, 0), ...(fig.state === "built" ? [] : empty(0, 0))];
  if (fig.state === "empty") return [];
  const part = PARTS[fig.use] || generic;
  return part(0, 0, {}).filter(Boolean);
}

/**
 * One layer of a figure as inline SVG (no xmlns: the composition is HTML,
 * and nothing in it names a URL). `lit` draws it in the one lit colour.
 */
export function isoSvg(fig, layer, { lit = false } = {}) {
  const shapes = figureShapes(fig, layer);
  if (!shapes.length) return "";
  const cls = ["v3-iso-svg", lit ? "lit" : "", layer === "bld" && fig.state === "refused" ? "ghost" : ""].filter(Boolean).join(" ");
  return `<svg class="${cls}" viewBox="${figureView(fig).text}" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${shapes.map(shapeSvg).join("")}</svg>`;
}
