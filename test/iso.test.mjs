// The isometric figures (lib/iso.mjs) and where v3 uses them: the projection,
// the site's classifier (its own expectations, fieldstate-site
// scripts/townTile.test.mjs on claude/town-tile), the card's kind, no
// building for non-site kinds, the denied path, the v3 scenes, and v2
// untouched. Pure: no browser, no network.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { estimatedAlignment } from "../lib/captions.mjs";
import {
  C,
  P,
  PARTS,
  S,
  TOP,
  box,
  caseFigure,
  caseKindOfKicker,
  caseKindOfLabel,
  caseKindOfText,
  classifyCase,
  figureShapes,
  figureView,
  grantedText,
  isoSvg,
  plane,
} from "../lib/iso.mjs";
import { buildTimeline } from "../lib/timeline.mjs";
import { v3RenderScript } from "../lib/v3.mjs";
import { ILLUSTRATION, compositionHtml, roundFigure } from "../hyperframes/generate.mjs";
import { ncScript, txScript } from "./fixtures/v3.mjs";

function render(script) {
  const rs = v3RenderScript(script, { log: () => {} });
  const voiced = rs.scenes.map((s) => ({ id: s.id, audio: null, alignment: s.silent ? null : estimatedAlignment(s.voice, s.voice.length / 15) }));
  const timeline = buildTimeline(rs, voiced);
  const { html } = compositionHtml({ script: rs, timeline, transcript: null });
  return { rs, timeline, html };
}

function sceneHtml(html, kind, nth = 0) {
  const parts = html.split(/(?=<div id="scene-\d+" class="clip scene")/).filter((p) => p.includes(`data-kind="${kind}"`));
  return parts[nth] ?? "";
}

// ── the kernel ──────────────────────────────────────────────────────────────

test("projection: x down-right, y down-left, z up, at 30 degrees; linear", () => {
  assert.deepEqual(P(0, 0, 0), [0, 0]);
  assert.deepEqual(P(10, 0, 0), [Math.round(10 * C * 1000) / 1000, 5]);
  assert.deepEqual(P(0, 10, 0), [-Math.round(10 * C * 1000) / 1000, 5]);
  assert.deepEqual(P(0, 0, 10), [0, -10]);
  assert.ok(Math.abs(S - 0.5) < 1e-12);
  const [a, b, sum] = [P(3, 7, 2), P(5, -1, 4), P(8, 6, 6)];
  assert.ok(Math.abs(a[0] + b[0] - sum[0]) < 0.002 && Math.abs(a[1] + b[1] - sum[1]) < 0.002);
});

test("plane(): the SVG matrix that lays local (u, v) on its plane", () => {
  const m = /^matrix\(([^)]+)\)$/.exec(plane([4, 6, 2], [1, 0, 0], [0, 1, 0]));
  const [ma, mb, mc, md, me, mf] = m[1].split(" ").map(Number);
  for (const [u, v] of [[0, 0], [3, 0], [0, 5], [2, 7]]) {
    const want = P(4 + u, 6 + v, 2);
    assert.ok(Math.abs(ma * u + mc * v + me - want[0]) < 0.01 && Math.abs(mb * u + md * v + mf - want[1]) < 0.01);
  }
  assert.equal(TOP(0, 0, 0), plane([0, 0, 0], [1, 0, 0], [0, 1, 0]));
  // A box is its side, front and top faces, painted in that order.
  assert.deepEqual(box(0, 0, 0, 10, 10, 5).map((f) => f.c), ["f fr", "f fl", "f ft"]);
});

test("every part draws inside one lot; one scale for every figure", () => {
  for (const [kind, part] of Object.entries(PARTS)) assert.ok(part(0, 0, {}).filter(Boolean).length > 0, kind);
  const office = figureView({ use: "office", state: "built" });
  const house = figureView({ use: "house", state: "built" });
  assert.equal(office.w, house.w, "the same width in scene units");
  assert.ok(office.h > house.h, "an office stands taller than a house");
  // One house, never the site's cluster of three.
  const roofs = figureShapes({ use: "house", state: "built" }, "bld").filter((s) => /\broof rf\b/.test(s.c));
  assert.equal(roofs.length, 1);
});

// ── the site's classifier, with the site's own expectations ─────────────────

const site = (outcome, title, extra = {}) => ({ outcome, case_kind: "zoning", title, ...extra });

test("classifier parity: uses in words, district codes, the old district never counts", () => {
  assert.equal(classifyCase(site("approved", "An ordinance granting a new Specific Use Permit for a multi-family use on property zoned Planned Development District No. 407")).kind, "multifamily");
  assert.equal(classifyCase(site("approved", "An ordinance granting CR Community Retail District on property zoned R-5(A) Single Family District")).kind, "commercial");
  assert.equal(classifyCase(site("approved", "", { headline_plain: "Rezoning of Chalk Hill Road property from R-5(A) to CR retail" })).kind, "commercial");
  assert.equal(classifyCase(site("approved", "granting a new planned development district for LI Light Industrial District uses on property zoned A(A) Agricultural District")).kind, "industrial");
  assert.equal(classifyCase(site("approved", "granting an amendment to Specific Use Permit No. 2420 for a private school use on property zoned RR Regional Retail District and MU-2 Mixed Use District")).kind, "civic");
  assert.equal(classifyCase(site("approved", "Data center campus on 40 acres")).kind, "datacenter");
  assert.equal(classifyCase(site("approved", "Rezoning W-3704: RS9 to RM12-S, 1.14 acres")).kind, "multifamily");
  assert.equal(classifyCase(site("approved", "(1) an ordinance granting NO(A) Neighborhood Office District; and (2) an ordinance terminating Specific Use Permit No. 45 for a branch library on property zoned R-1ac(A)")).kind, "office");
  assert.equal(grantedText("Rezoning from R-5(A) to TH-3(A) townhouses"), "Rezoning to TH-3(A) townhouses");
  assert.equal(classifyCase({ outcome: "approved", case_kind: "plan_amendment", title: "amend the City of Dallas Thoroughfare Plan to change the designation of Crouch Road" }).kind, "road");
  assert.equal(classifyCase({ outcome: "approved", case_kind: "rezoning", title: "Rezoning Petition: 2026-032 by Savalex Homes LLC" }).kind, "generic");
  const denied = classifyCase(site("denied", "granting TH-3(A) Townhouse District on property zoned R-5(A)"));
  assert.deepEqual([denied.kind, denied.use], ["empty", "townhomes"]);
  for (const outcome of ["withdrawn", "continued", "tabled", "deferred", ""]) assert.equal(classifyCase(site(outcome, "granting CR Community Retail District")), null, outcome);
  assert.equal(classifyCase({ outcome: "approved", case_kind: "contract", title: "Warehouse lease contract" }), null);
  assert.equal(classifyCase({ outcome: "approved", case_kind: "zoning", title: "granting amendments to Division 51A-7.900 of the Dallas Development Code to create a new subdistrict" }), null);
});

// ── a card's kind ───────────────────────────────────────────────────────────

test("kind from the card: the kicker's kind label, else (no kicker) the headline's words", () => {
  assert.equal(caseKindOfKicker("Union County, NC · Rezoning · RZ-2026-010"), "rezoning");
  assert.equal(caseKindOfKicker("Fort Worth · Zoning · Oct 20"), "zoning");
  assert.equal(caseKindOfKicker("Frisco · Site plan · Oct 20"), "site_plan");
  assert.equal(caseKindOfKicker("Dallas · Special use permit · Oct 20"), "special_use");
  assert.equal(caseKindOfLabel("subdivision_plat"), "subdivision_plat");
  for (const k of ["Plano · Contract · Oct 20", "Dallas · Item · Oct 20", "Dallas · Budget · Oct 20", "Union · Moratorium · Oct 19", "Dallas · Sign district · SD-26-000"]) {
    assert.equal(caseKindOfKicker(k), null, k);
  }
  assert.equal(caseKindOfText("Charlotte City Council rezoning petition by Pence Road Development LLC"), "rezoning");
  assert.equal(caseKindOfText("Renaming of an example bridge"), null);
  // The headline's words only count when the beat has no kicker at all.
  assert.equal(caseFigure({ kicker: "Dallas · Item · Oct 20", head: "Rezoning for a warehouse", outcome: "approved" }), null);
  assert.equal(caseFigure({ head: "Rezoning for a warehouse", outcome: "approved" }).use, "industrial");
  // The engine's own case kind wins.
  assert.equal(caseFigure({ kicker: "X · Item", head: "light industrial use", outcome: "approved", caseKind: "rezoning" }).use, "industrial");
  assert.equal(caseFigure({ kicker: "X · Rezoning", head: "light industrial use", outcome: "approved", caseKind: "text_amendment" }), null);
});

test("no building for contracts, budgets, renamings or code text; none for an undecided outcome", () => {
  const tx = txScript();
  const figs = tx.v3.round.map((it) => roundFigure({ ...it.screen, outcome: it.outcome }));
  assert.deepEqual(figs.map((f) => f && `${f.use}/${f.state}`), [null, "townhomes/built", null, "industrial/built"]);
  assert.equal(caseFigure({ kicker: "X · Rezoning", head: "amendments to Chapter 51A of the Development Code", outcome: "approved" }), null);
  // The engine's case_kind on a round item wins over its kind label, both ways.
  const card = (it, case_kind) => roundFigure({ ...it.screen, outcome: it.outcome, case_kind });
  const [contract, townhomes] = tx.v3.round;
  assert.equal(card(townhomes, "contract"), null, "a site label, but the engine says contract");
  assert.deepEqual(card(contract, null), figs[0], "no case_kind: the kind label decides, as before");
  assert.equal(card({ ...townhomes, screen: { ...townhomes.screen, kind_label: null } }, "rezoning").use, "townhomes");
  for (const outcome of ["deferred", "continued", "tabled", "", null]) assert.equal(caseFigure({ kicker: "X · Rezoning", head: "retail", outcome }), null, String(outcome));
});

test("denied: an empty dashed lot and the requested building as a dashed ghost; withdrawn: the empty lot", () => {
  const denied = caseFigure({ kicker: "Dallas, TX · Variance", head: "Variance from the alcohol distance rule for an example restaurant", outcome: "denied" });
  assert.deepEqual(denied, { use: "commercial", why: "commercial", state: "refused" });
  assert.equal(caseFigure({ kicker: "X · Rezoning", head: "townhomes", outcome: "failed" }).state, "refused");
  assert.equal(caseFigure({ kicker: "X · Rezoning", head: "townhomes", outcome: "denied", ghost: false }).state, "empty");
  assert.equal(caseFigure({ kicker: "X · Zoning", head: "townhomes", outcome: "withdrawn" }).state, "empty");
  const lotSvg = isoSvg(denied, "lot");
  assert.match(lotSvg, /class="d dash"/, "the dashed outline");
  assert.match(lotSvg, /class="d stake"/, "the survey stakes");
  const ghost = isoSvg(denied, "bld");
  assert.match(ghost, /^<svg class="v3-iso-svg ghost"/);
  assert.equal(isoSvg(caseFigure({ kicker: "X · Zoning", head: "townhomes", outcome: "withdrawn" }), "bld"), "", "a withdrawn case draws no building");
  const built = caseFigure({ kicker: "X · Rezoning", head: "light industrial use", outcome: "approved" });
  assert.doesNotMatch(isoSvg(built, "lot"), /dash|stake/, "a built lot has no dashes");
  // Inline SVG names no URL (no xmlns): the composition stays offline.
  assert.doesNotMatch(isoSvg(built, "bld", { lit: true }), /https?:/);
});

// ── the v3 scenes ───────────────────────────────────────────────────────────

test("lead: a medium building top right, rising before the stamp, with the illustration line", () => {
  const { html } = render(ncScript());
  const h = sceneHtml(html, "decided");
  assert.match(h, /class="v3-iso-plate lead"/);
  assert.equal((h.match(/class="v3-iso-svg lit"/g) || []).length, 2, "the lit lot and the rising building");
  assert.ok(h.includes(`>${ILLUSTRATION}<`));
  const rise = Number(h.match(/id="[^"]*-rise-\d+" class="v3-iso-layer" data-a="in" data-at="(\d+)"/)[1]);
  const stamp = Number(h.match(/class="v3-stamp"[^>]*data-a="stamp" data-at="(\d+)"/)[1]);
  assert.ok(rise + 20 <= stamp, "the building is up before the stamp lands");
  // The denied lead: the dashed ghost, still captioned.
  const d = sceneHtml(render(txScript()).html, "decided");
  assert.match(d, /class="v3-iso-svg lit ghost"/);
  assert.match(d, /class="d dash"/);
  assert.ok(d.includes(`>${ILLUSTRATION}<`));
});

test("round: one at a time the building rises as the card is read; the grid lights it with its card", () => {
  const nc = sceneHtml(render(ncScript()).html, "round");
  // The NC round card is a withdrawn rezoning: its lot, empty, nothing rising.
  assert.match(nc, /class="v3-rcard has-iso big"/);
  assert.doesNotMatch(nc, /-rise-/);
  const three = ncScript();
  three.v3.round = [{ ...three.v3.round[0], outcome: "approved", text: "Rezoning for 40 townhomes", screen: { ...three.v3.round[0].screen, text: "Rezoning for 40 townhomes", outcome_label: "approved" } }];
  const { html, timeline } = render(three);
  const r = sceneHtml(html, "round");
  const sc = timeline.scenes.find((s) => s.kind === "round");
  const rise = Number(r.match(/-rise-\d+" class="v3-iso-layer" data-a="in" data-at="(\d+)"/)[1]);
  const at = sc.lineFrames[sc.screen.item_lines[0]][0];
  assert.ok(rise >= at && rise <= at + 10, "rises as the card's own line is read");
  // The highlight grid: a building on the two site cards only, lit with the card.
  const g = sceneHtml(render(txScript()).html, "round");
  assert.equal((g.match(/class="v3-rcard has-iso"/g) || []).length, 2);
  // The engine's case_kind on a round item reaches the card (lib/v3.mjs).
  const tx = txScript();
  tx.v3.round[1] = { ...tx.v3.round[1], case_kind: "contract" };
  assert.equal((sceneHtml(render(tx).html, "round").match(/class="v3-rcard has-iso"/g) || []).length, 1);
  const lit = [...g.matchAll(/data-a="lit" data-at="\d+" data-first="\d+" data-on="(\d+)" data-off="(-?\d+)"/g)].map((m) => [m[1], m[2]]);
  const glow = [...g.matchAll(/data-a="glow" data-at="\d+" data-on="(\d+)" data-off="(-?\d+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(glow, [lit[1], lit[3]], "each figure lights and dims with its own card");
  assert.match(g, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test("The long road: the last station shows the lot; the building rises only when approved", () => {
  const nc = sceneHtml(render(ncScript()).html, "road");
  assert.match(nc, /class="abs v3-road-lot"/);
  assert.doesNotMatch(nc, /-rise-/, "withdrawn: the empty lot");
  assert.ok(!nc.includes(ILLUSTRATION));
  const approved = ncScript();
  approved.v3.wheel.picked[0].data.outcome = "approved";
  approved.v3.wheel.picked[0].screen.head = "Example City rezoning for 240 apartments";
  const { html, timeline } = render(approved);
  const h = sceneHtml(html, "road");
  const rise = Number(h.match(/-rise-\d+" class="v3-iso-layer" data-a="in" data-at="(\d+)"/)[1]);
  const road = timeline.scenes.find((s) => s.kind === "road");
  const last = road.lineFrames[road.screen.step_lines.at(-1)][0];
  assert.ok(rise >= last, "after the last station's line");
  assert.ok(h.includes(ILLUSTRATION));
  const denied = ncScript();
  denied.v3.wheel.picked[0].data.outcome = "denied";
  assert.doesNotMatch(sceneHtml(render(denied).html, "road"), /-rise-|ghost/, "denied: the empty lot, no ghost");
  // The outcome falls back to the deciding step when data.outcome is missing.
  const fallback = ncScript();
  delete fallback.v3.wheel.picked[0].data.outcome;
  assert.equal(render(fallback).rs.scenes.find((s) => s.kind === "road").screen.outcome, "withdrawn");
});

test("v3 still renders offline with unique ids; v2 has none of it", async () => {
  for (const script of [ncScript(), txScript()]) {
    const { html } = render(script);
    assert.doesNotMatch(html, /https?:\/\//i);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length);
    assert.match(html, /kind === "glow"/, "runtime-v3 knows the glow");
    assert.match(html, /\.v3-iso-svg\{/);
  }
  const v2 = JSON.parse(await readFile(new URL("../examples/nc-2026-10-19.json", import.meta.url), "utf8"));
  const voiced = v2.scenes.map((s) => ({ id: s.id, audio: null, alignment: estimatedAlignment(s.voice, s.voice.length / 15) }));
  const { html } = compositionHtml({ script: v2, timeline: buildTimeline(v2, voiced), transcript: null });
  assert.doesNotMatch(html, /v3-iso|data-a="glow"|<svg class="v3-iso/);
});

test("the engine's real NC golden, when V3_GOLDEN_NC points at it: an industrial lead, the withdrawn round and road as empty lots", { skip: !process.env.V3_GOLDEN_NC }, async () => {
  const { html } = render(JSON.parse(await readFile(process.env.V3_GOLDEN_NC, "utf8")));
  const d = sceneHtml(html, "decided");
  assert.ok(d.includes(ILLUSTRATION));
  assert.match(d, /class="d"/);
  assert.doesNotMatch(d, /ghost|class="d dash"/);
  // The engine holds a withdrawn round item, so this week has no round: the
  // round is checked only when there is one.
  for (const kind of ["round", "road"]) {
    const h = sceneHtml(html, kind);
    if (kind === "round" && !h) continue;
    assert.match(h, /class="d dash"/, `${kind}: the empty lot`);
    assert.doesNotMatch(h, /-rise-/, `${kind}: nothing rises on a withdrawn case`);
  }
  assert.doesNotMatch(html, /https?:\/\//);
});
