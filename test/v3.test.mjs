// Weekly video v3 (fieldstate-site #172): the template gate, the v3 spine
// from the script, the surface's 8-fix review, the clip beat, and v2
// unchanged byte for byte. Pure: no Docker, no browser, no network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { estimatedAlignment, toVtt } from "../lib/captions.mjs";
import { clipDownloadUrl, clipFfmpegArgs, fetchClip } from "../lib/clip.mjs";
import { buildTimeline, lineWindows } from "../lib/timeline.mjs";
import {
  ON_THE_VOTES_WE_HOLD,
  V3_RENDER_SCHEMA,
  coverageHonoured,
  templateFor,
  v3Problem,
  v3RenderScript,
} from "../lib/v3.mjs";
import { compositionHtml } from "../hyperframes/generate.mjs";
import { asV3Schema, ncScript, syntheticClip, txScript } from "./fixtures/v3.mjs";

function render(script, { clipFile = null } = {}) {
  const logs = [];
  const rs = v3RenderScript(script, { log: (l) => logs.push(l), clipFile });
  const voiced = rs.scenes.map((s) => ({
    id: s.id,
    audio: null,
    alignment: s.silent ? null : estimatedAlignment(s.voice, s.voice.length / 15),
  }));
  const timeline = buildTimeline(rs, voiced);
  const { html } = compositionHtml({ script: rs, timeline, transcript: null });
  return { rs, timeline, html, logs, kinds: rs.scenes.map((s) => s.kind) };
}

/** The HTML of one scene (by kind, nth). */
function sceneHtml(html, kind, nth = 0) {
  const parts = html.split(/(?=<div id="scene-\d+" class="clip scene")/).filter((p) => p.includes(`data-kind="${kind}"`));
  return parts[nth] ?? "";
}

// ── the gate ────────────────────────────────────────────────────────────────

test("gate: a v2 script renders v2, with or without a v3 block; v3 only when the script says so", () => {
  const nc = ncScript();
  const bare = { ...nc };
  delete bare.v3;
  assert.equal(templateFor(bare, {}), "v2");
  assert.equal(templateFor(nc, {}), "v2", "a v2 script that carries v3 still renders v2 by default");
  assert.equal(templateFor(nc, { VIDEO_TEMPLATE: "v3" }), "v3", "local review renders can ask for v3");
  assert.equal(templateFor(bare, { VIDEO_TEMPLATE: "v3" }), "v2", "no v3 block, no v3");
  assert.equal(templateFor(asV3Schema(nc), {}), "v3", "the engine turns v3 on with the script's schema");
  assert.equal(templateFor({ ...nc, v3: { schema: "fieldstate.weekly_video.v3", error: "KeyError" } }, { VIDEO_TEMPLATE: "v3" }), "v3");
  assert.match(v3Problem({ ...nc, v3: { schema: "fieldstate.weekly_video.v3", error: "KeyError" } }), /v3 build failed/);
  assert.match(v3Problem({ ...nc, scenes: nc.scenes.filter((s) => s.kind !== "outro") }), /closing scene/);
});

test("render.mjs: the v2 path runs only when the template is v2; v3 falls back to it", async () => {
  const src = await readFile(new URL("../render.mjs", import.meta.url), "utf8");
  assert.match(src, /template = \(await import\("\.\/lib\/v3\.mjs"\)\)\.templateFor\(script, env\)/);
  assert.match(src, /if \(template === "v3"\) \{\s*try \{/);
  assert.match(src, /if \(templateUsed === "v2"\) \{/);
  assert.doesNotMatch(src, /^import .*lib\/v3\.mjs/m, "v3 is loaded only inside the try: it can never stop a v2 render");
  const wf = await readFile(new URL("../.github/workflows/render.yml", import.meta.url), "utf8");
  assert.doesNotMatch(wf, /VIDEO_TEMPLATE/, "render.yml is unchanged: the script decides");
});

// ── v2 byte for byte ────────────────────────────────────────────────────────

test("v2: examples/nc-2026-10-19.json renders the same composition as before v3 (sha256 pinned)", async () => {
  const script = JSON.parse(await readFile(new URL("../examples/nc-2026-10-19.json", import.meta.url), "utf8"));
  // As render.mjs builds it without a voice (15 characters a second).
  const voiced = script.scenes.map((s) => ({ id: s.id, audio: null, alignment: estimatedAlignment(s.voice, s.voice.length / 15) }));
  const tl = buildTimeline(script, voiced);
  const { html } = compositionHtml({ script, timeline: tl, transcript: null });
  const sha = (t) => createHash("sha256").update(t).digest("hex");
  // Hashes of main at 3f27415 (before this change), generated the same way.
  assert.equal(sha(html), "48be1d924ee9b8b8adc0d8fce5726ba45ef399b42fe63ea27246635060a4fc90");
  assert.equal(sha(toVtt(tl.cues)), "8a41e89cb2d7928aa9919c9ddc7b0170a457171551143bb6351c5b20c7ae0a2b");
  assert.doesNotMatch(html, /v3-|data-a="hl"|data-a="lit"/);
  for (const s of tl.scenes) assert.equal(s.lineFrames, undefined);
});

// ── the spine ───────────────────────────────────────────────────────────────

test("NC shape: open, decided, matters, page, next, round, then The long road and the close", () => {
  const { kinds, rs, logs } = render(ncScript());
  assert.equal(rs.schema, V3_RENDER_SCHEMA);
  assert.deepEqual(kinds, ["open", "decided", "matters", "ident", "record", "next", "round", "ident", "road", "outro"]);
  assert.deepEqual(rs.scenes.filter((s) => s.kind === "ident").map((s) => s.screen.title), ["From the record", "The long road"]);
  assert.ok(logs.some((l) => /your_turn/.test(l)), "your turn is logged as not built yet");
});

test("TX shape: open, decided (no page), next, the highlighted round, From the record, the close", () => {
  const { kinds } = render(txScript());
  assert.deepEqual(kinds, ["open", "decided", "next", "round", "ident", "record", "outro"]);
});

test("the engine's real NC golden (sie-engine tests/fixtures/weekly_video_v3), when V3_GOLDEN_NC points at it", { skip: !process.env.V3_GOLDEN_NC }, async () => {
  const script = JSON.parse(await readFile(process.env.V3_GOLDEN_NC, "utf8"));
  // Since Nov 3 the engine writes v3 at the top: the script renders v3. Its
  // one round item was withdrawn, so there is no round; the Charlotte track
  // reads Withdrawn once.
  assert.equal(templateFor(script, {}), "v3");
  const { kinds, html } = render(script);
  assert.deepEqual(kinds, ["open", "decided", "matters", "ident", "record", "next", "ident", "road", "outro"]);
  assert.equal((sceneHtml(html, "road").match(/class="v3-station"/g) || []).length, 3);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("placement only: every line on screen and in the voice is the engine's, in order", () => {
  for (const script of [ncScript(), txScript()]) {
    const { rs, timeline } = render(script);
    const engineCaps = new Set();
    const walk = (o) => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") {
        if (typeof o.cap === "string" && typeof o.voice === "string") engineCaps.add(o.cap);
        Object.values(o).forEach(walk);
      }
    };
    walk(script.v3);
    for (const s of rs.scenes) {
      if (s.kind === "outro") continue;
      for (const l of s.lines) assert.ok(engineCaps.has(l.cap), `not an engine line: ${l.cap}`);
      assert.equal(s.voice, s.lines.map((l) => l.voice).join(" "));
    }
    // Each line's own captions fall inside its own window.
    const sc = timeline.scenes.find((s) => s.kind === "decided");
    assert.equal(sc.lineFrames.length, sc.lines.length);
    for (let k = 1; k < sc.lineFrames.length; k++) assert.ok(sc.lineFrames[k][0] > sc.lineFrames[k - 1][0]);
  }
});

test("lineWindows: lines map onto the voice by their share of the characters", () => {
  const lines = [{ voice: "abcd" }, { voice: "efghijkl" }];
  const al = estimatedAlignment("abcd efghijkl", 13);
  const w = lineWindows(lines, al, 13);
  assert.equal(w[0][0], 0);
  assert.ok(Math.abs(w[1][0] - 5) < 1.01);
  assert.equal(w[1][1], 13);
});

// ── coverage_ok ─────────────────────────────────────────────────────────────

test("coverage_ok false: the open says \"on the votes we hold\" as the engine wrote it, or the claim is dropped", () => {
  const { rs, html } = render(ncScript());
  const open = rs.scenes[0];
  assert.equal(open.kind, "open");
  assert.match(open.cap, new RegExp(ON_THE_VOTES_WE_HOLD));
  assert.match(sceneHtml(html, "open"), /on the votes we hold/);
  // A line that lost the qualifier: the claim is not shown at all.
  const bad = ncScript();
  bad.v3.cold_open.lines = [{ cap: "Not one no vote in 23 months.", voice: "Not one no vote in twenty-three months." }];
  bad.v3.cold_open.screen.sub = "The Example County Board of Commissioners, 6 recorded votes in a row.";
  const got = render(bad);
  assert.notEqual(got.kinds[0], "open");
  assert.ok(got.logs.some((l) => /claim dropped/.test(l)));
  // The same line with coverage_ok true is fine.
  bad.v3.cold_open.coverage_ok = true;
  assert.equal(render(bad).kinds[0], "open");
  // why_matters follows the same rule.
  const wm = ncScript();
  wm.v3.lead.why_matters.lines = [{ cap: "6 of 7 recorded votes had no vote against.", voice: "Six of seven recorded votes had no vote against." }];
  assert.ok(!render(wm).kinds.includes("matters"));
  assert.equal(coverageHonoured({ coverage_ok: true, lines: [] }), true);
});

// ── the surface's 8-fix review (Oct 30) ──────────────────────────────────────

test("fix 2: no reason on record puts the line under the stamp and skips the page", () => {
  const { rs, html } = render(txScript());
  const dec = rs.scenes.find((s) => s.kind === "decided");
  const note = "The record has the vote but not yet the reasons.";
  assert.equal(dec.screen.note, note);
  assert.equal(dec.lines.at(-1).cap, note, "said as the decided card's last line");
  assert.match(sceneHtml(html, "decided"), /class="v3-note"[^>]*>The record has the vote but not yet the reasons\./);
  assert.equal(rs.scenes.filter((s) => s.kind === "record").length, 1, "only the wheel's page, not the lead's");
  assert.ok(!rs.scenes.some((s) => s.cap === note), "no scene of its own");
  // skip_record wins even if a quote were present.
  const t = txScript();
  t.v3.lead.why_decided = ncScript().v3.lead.why_decided;
  assert.equal(render(t).kinds.filter((k) => k === "record").length, 1);
});

test("fix 3: three or fewer round items one at a time; more are lit in turn on one grid", () => {
  const nc = render(ncScript());
  const rounds = nc.rs.scenes.filter((s) => s.kind === "round");
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].screen.layout, "one_at_a_time");
  assert.equal(rounds[0].lines[0].cap, "Also decided this week.");
  assert.equal(rounds[0].screen.cards.length, 1);
  const three = ncScript();
  three.v3.round = [0, 1, 2].map((i) => ({ ...three.v3.round[0], matter_id: 100 + i }));
  const r3 = render(three).rs.scenes.filter((s) => s.kind === "round");
  assert.equal(r3.length, 3, "one scene per card");
  assert.deepEqual(r3.map((s) => s.lines.length), [2, 1, 1], "the round's opening line rides on the first card");
  const tx = render(txScript());
  const grid = tx.rs.scenes.filter((s) => s.kind === "round");
  assert.equal(grid.length, 1);
  assert.equal(grid[0].screen.layout, "highlight");
  const h = sceneHtml(tx.html, "round");
  const lit = [...h.matchAll(/data-a="lit" data-at="\d+" data-first="(\d+)" data-on="(\d+)" data-off="(-?\d+)"/g)].map((m) => m.slice(1).map(Number));
  assert.equal(lit.length, 4);
  for (let i = 1; i < 4; i++) assert.ok(lit[i][1] > lit[i - 1][1], "each card lights when its own line is read");
  for (let i = 0; i < 3; i++) assert.equal(lit[i][2], lit[i + 1][1], "and dims when the next one starts");
  assert.equal(lit[3][2], -1);
  // Without round_layout, the same rule.
  const none = txScript();
  delete none.v3.round_layout;
  assert.equal(render(none).rs.scenes.filter((s) => s.kind === "round")[0].screen.layout, "highlight");
  // Items the engine held (card_hold) never show.
  const held = txScript();
  held.v3.checks.round_held = [{ matter_id: 9102, why: "stamp_conflict" }];
  assert.ok(!render(held).html.includes("Renaming of an example bridge"));
});

test("fix 4 and 5: scenes fill the stage; one source line per scene, no tier chip per card", () => {
  const { html } = render(txScript());
  for (const kind of ["decided", "round"]) {
    const h = sceneHtml(html, kind);
    assert.match(h, /class="v3-stage"/);
    assert.doesNotMatch(h, /class="tag"/, `${kind}: no per-card Documented chip`);
    assert.equal((h.match(/class="v3-src"/g) || []).length, 1, `${kind}: one source line`);
  }
  assert.match(sceneHtml(html, "decided"), /City Council · from the meeting record · Documented/);
  // The card's sub-line is not repeated when the source line says it.
  assert.doesNotMatch(sceneHtml(html, "decided"), /class="v3-card-sub"/);
});

test("fix 7: the wheel's page names its case and how it ended", () => {
  const { html } = render(txScript());
  const h = sceneHtml(html, "record");
  for (const t of ["Dallas · Sign district · SD-26-000", "Special sign district at 100 Example Avenue", "SD-26-000", "Quoted as posted · retypeset for video"]) {
    assert.ok(h.includes(t), t);
  }
  assert.equal((h.match(/The board approved it on October 14, 5–0\./g) || []).length, 1, "the outcome line once, not twice");
  assert.match(h, /data-a="hl"/);
  assert.match(h, /data-a="push"/);
});

test("the wheel: a segment without a template is skipped and logged; a known one with nothing to place too", () => {
  const { logs, html, rs } = render(txScript());
  assert.ok(logs.some((l) => /wheel segment scoreboard has no template; skipped/.test(l)));
  assert.ok(!html.includes("The scoreboard"));
  assert.equal(rs.scenes.filter((s) => s.kind === "ident").length, 1);
  const empty = ncScript();
  empty.v3.wheel.picked[0].lines = [];
  const got = render(empty);
  assert.ok(!got.kinds.includes("road"));
  assert.ok(got.logs.some((l) => /long_road has no lines or screen/.test(l)));
});

test("The long road: a station per step, the recorded step open, each lit when its line is read", () => {
  const { html, timeline } = render(ncScript());
  const h = sceneHtml(html, "road");
  assert.equal((h.match(/class="v3-station"/g) || []).length, 4);
  assert.equal((h.match(/class="v3-mark open"/g) || []).length, 1);
  assert.equal((h.match(/class="v3-mark end"/g) || []).length, 1);
  assert.match(h, /15 months/);
  const road = timeline.scenes.find((s) => s.kind === "road");
  const on = [...h.matchAll(/data-a="lit"[^>]*data-on="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(on.length, 4);
  road.screen.step_lines.forEach((k, i) => {
    assert.ok(k >= 0, "every station has its line");
    assert.ok(on[i] >= road.lineFrames[k][0] && on[i] <= road.lineFrames[k][0] + 60, `station ${i} lights as its line is read`);
  });
  for (let i = 1; i < on.length; i++) assert.ok(on[i] > on[i - 1]);
});

// ── the clip beat ───────────────────────────────────────────────────────────

test("clip null: no clip scene and no video", () => {
  const { html, kinds } = render(txScript());
  assert.ok(!kinds.includes("clip"));
  assert.doesNotMatch(html, /<video/);
});

test("clip present without fetched media: skipped and logged", () => {
  const t = txScript();
  t.v3.lead.clip = syntheticClip();
  const { kinds, logs } = render(t);
  assert.ok(!kinds.includes("clip"));
  assert.ok(logs.some((l) => /media was not fetched/.test(l)));
});

test("clip present: the footage, verbatim captions, credit, label and the tally at result_at_s", () => {
  const t = txScript();
  t.v3.lead.clip = syntheticClip();
  const { rs, html, timeline } = render(t, { clipFile: "clips/lead.mp4" });
  assert.deepEqual(rs.scenes.slice(0, 3).map((s) => s.kind), ["open", "clip", "decided"]);
  const sc = timeline.scenes.find((s) => s.kind === "clip");
  assert.ok(sc.durationInFrames >= 17 * 30, "the scene lasts the footage");
  assert.equal(sc.voice, "", "nothing is voiced over the chamber audio");
  const start = sc.from / 30;
  const video = html.match(/<video [^>]*>/)?.[0] ?? "";
  assert.match(video, /src="assets\/clips\/lead\.mp4"/);
  assert.match(video, new RegExp(`data-start="${Number(start.toFixed(4))}"`));
  assert.match(video, /data-has-audio="true"/);
  assert.match(video, /data-media-start="0"/);
  const h = sceneHtml(html, "clip");
  assert.match(h, />Video: City of Example</);
  assert.match(h, />Unconfirmed · from the meeting video</);
  assert.match(h, />Example · Planning and Zoning Commission</);
  const slam = h.match(/class="v3-slam" data-a="pop" data-at="(\d+)"/);
  assert.ok(slam && Number(slam[1]) === 15 * 30 + 2, "the tally lands on the chair's result");
  // The recording's own captions, word for word ("5-1" as spoken), at their times.
  for (const c of syntheticClip().captions) {
    const cue = timeline.cues.find((x) => x.text === c.text);
    assert.ok(cue, c.text);
    assert.ok(Math.abs(cue.start - (start + c.start)) < 1e-6);
  }
  // The brand bar steps aside for the footage.
  for (const m of html.matchAll(/id="brand-\d+" class="clip v3-brand" data-start="([\d.]+)" data-duration="([\d.]+)"/g)) {
    const [a, d] = [Number(m[1]), Number(m[2])];
    assert.ok(a + d <= start + 1e-3 || a >= start + sc.durationInFrames / 30 - 1e-3);
  }
});

test("clip fetch: the town's own download link, the stretch only, never fatal", async () => {
  assert.equal(clipDownloadUrl({ src: "https://southlaketx.new.swagit.com/videos/123" }), "https://southlaketx.new.swagit.com/videos/123/download");
  assert.equal(clipDownloadUrl({ src: "https://example.gov/v.mp4", download_url: "https://example.gov/d.mp4" }), "https://example.gov/d.mp4");
  const args = clipFfmpegArgs({ media_start: 130, duration: 17 }, "https://x.test/v", "/tmp/o.mp4");
  assert.deepEqual(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2), ["-ss", "130.00"]);
  assert.deepEqual(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2), ["-t", "17.00"]);
  assert.equal(args[args.indexOf("-user_agent") + 1], "FieldstateBot");
  const logs = [];
  assert.equal(await fetchClip({ src: "x", duration: 0 }, { publicDir: "/tmp/none", log: (l) => logs.push(l), env: {} }), null);
  assert.equal(await fetchClip({ src: "http://insecure.test/v", duration: 5 }, { publicDir: "/tmp/fs-clip-test", log: (l) => logs.push(l), env: {} }), null);
  assert.ok(logs.some((l) => /no https/.test(l)));
});

// ── the composition ─────────────────────────────────────────────────────────

test("v3 composition: offline, unique ids, its own motion and CSS only in v3, brand off the page", () => {
  const t = txScript();
  t.v3.lead.clip = syntheticClip();
  for (const { html, timeline } of [render(ncScript()), render(t, { clipFile: "clips/lead.mp4" })]) {
    assert.doesNotMatch(html, /https?:\/\//i);
    for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) assert.match(m[1], /^assets\//, m[1]);
    assert.doesNotMatch(html, /Math\.random|Date\.now|setInterval|fetch\(/);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length);
    assert.match(html, /kind === "hl"/, "runtime-v3 inlined");
    assert.match(html, /\.v3-stage\{/);
    // The brand bar is hidden over every segment card and page.
    const hidden = timeline.scenes.filter((s) => ["ident", "record"].includes(s.kind));
    for (const m of html.matchAll(/class="clip v3-brand" data-start="([\d.]+)" data-duration="([\d.]+)"/g)) {
      const [a, d] = [Number(m[1]), Number(m[2])];
      for (const s of hidden) assert.ok(a + d <= s.from / 30 + 1e-3 || a >= (s.from + s.durationInFrames) / 30 - 1e-3);
    }
  }
});
