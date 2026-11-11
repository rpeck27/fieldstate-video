// Weekly video v3 (fieldstate-site #172): the template gate, the v3 spine
// from the script, the surface's 8-fix review, the clip beat, and v2
// unchanged byte for byte. Pure: no Docker, no browser, no network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { estimatedAlignment, toVtt } from "../lib/captions.mjs";
import { CLIP_HOSTS, clipFfmpegArgs, clipSource, fetchClip } from "../lib/clip.mjs";
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
import { RENDERED_V2, RENDERED_V3, voiceFacts } from "../lib/conductor.mjs";
import { renderV3 } from "../lib/render-v3.mjs";
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
  // The engine's v3.voice_chars / est_duration_s (the conductor's record)
  // count exactly what this render voices (sie-engine voice_budget).
  const { rs, timeline } = render(script);
  assert.equal(script.v3.voice_chars, rs.scenes.reduce((n, s) => n + s.voice.length, 0));
  assert.ok(Math.abs(script.v3.est_duration_s - timeline.durationS) <= 1, `${script.v3.est_duration_s} vs ${timeline.durationS}`);
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

test("Your turn: one card, each row comes in as its own line is read (as What's next)", () => {
  const t = ncScript();
  // The engine's shape (sie-engine weekly_video_v3.your_turn): one agenda
  // card whose rows follow the spoken lines one for one.
  t.v3.your_turn = {
    kind: "speak_at_next_meeting",
    lines: [
      { cap: "To speak when the Example Town Council meets on Monday, October 26, sign up at the door.",
        voice: "To speak when the Example Town Council meets on Monday, October twenty-sixth, sign up at the door." },
      { cap: "Each speaker has 3 minutes.", voice: "Each speaker has three minutes." },
      { cap: "You can also send written comments.", voice: "You can also send written comments." },
    ],
    screen: { kicker: "Your turn", when: ["MON", "Oct 26"], time: "Time not posted", place: "Example Town Council",
      rows: ["Sign up at the door", "3 minutes each", "Written comments accepted"], src: "Speaking rules as posted" },
  };
  const { html, timeline, kinds } = render(t);
  assert.equal(kinds.at(-2), "turn");
  const sc = timeline.scenes.find((s) => s.kind === "turn");
  const h = sceneHtml(html, "turn");
  const rows = [...h.matchAll(/class="v3-arow" data-a="in" data-at="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows, sc.lineFrames.map(([f]) => f + 8), "row i comes in with line i");
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i] > rows[i - 1] + 30, "not all off the first line");
  // The same rule as What's next's card.
  const nx = timeline.scenes.find((s) => s.kind === "next");
  const nrows = [...sceneHtml(html, "next").matchAll(/class="v3-arow" data-a="in" data-at="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(nrows, nx.lineFrames.slice(0, nrows.length).map(([f]) => f + 8));
  // Several cards (screen.items): each card's rows follow that card's line.
  const multi = ncScript();
  multi.v3.your_turn = { ...t.v3.your_turn, screen: { kicker: "Your turn", src: "x",
    items: [{ when: ["MON", "Oct 26"], place: "A", rows: ["r1", "r2"] }, { when: ["TUE", "Oct 27"], place: "B", rows: ["r3"] }] } };
  const m = render(multi);
  const msc = m.timeline.scenes.find((s) => s.kind === "turn");
  const mrows = [...sceneHtml(m.html, "turn").matchAll(/class="v3-arow" data-a="in" data-at="(\d+)"/g)].map((x) => Number(x[1]));
  assert.deepEqual(mrows, [msc.lineFrames[0][0] + 8, msc.lineFrames[0][0] + 18, msc.lineFrames[1][0] + 8]);
});

// ── voice spend when v3 falls back to v2 ────────────────────────────────────

async function v3Run({ synthFailAt = -1, renderFails = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "fs-v3run-"));
  await mkdir(path.join(root, "public", "audio"), { recursive: true });
  await mkdir(path.join(root, "out"), { recursive: true });
  const spent = { chars: 0 };
  const sent = [];
  let calls = 0;
  const synth = async (text) => {
    if (calls++ === synthFailAt) throw Object.assign(new Error("ElevenLabs 500"), { status: 500 });
    sent.push(text);
    return { audio: Buffer.from("mp3"), alignment: estimatedAlignment(text, text.length / 15) };
  };
  const renderImpl = async () => {
    if (renderFails) throw Object.assign(new Error("hyperframes render exited 1"), { step: "render" });
    return { stills: [] };
  };
  let err = null;
  let got = null;
  try {
    got = await renderV3({
      script: asV3Schema(ncScript()), env: {}, log: () => {}, root, out: path.join(root, "out"), noVoice: false,
      synth, normalize: (a, b) => copyFile(a, b), probeSeconds: async () => 1, workers: 1, spent, renderImpl,
    });
  } catch (e) {
    err = e;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  return { spent, sent, err, got };
}

test("v3 voice spend is counted even when a later v3 step fails and the run falls back to v2", async () => {
  // HyperFrames fails after every v3 scene was voiced: every character counts.
  const late = await v3Run({ renderFails: true });
  assert.ok(late.err && /hyperframes render exited 1/.test(late.err.message));
  assert.ok(late.sent.length >= 5);
  assert.equal(late.spent.chars, late.sent.reduce((n, t) => n + t.length, 0));
  // ElevenLabs fails on the third scene: the two it voiced count, the failed one does not.
  const mid = await v3Run({ synthFailAt: 2 });
  assert.equal(mid.err?.step, "v3-voice");
  assert.equal(mid.sent.length, 2);
  assert.equal(mid.spent.chars, mid.sent[0].length + mid.sent[1].length);
  // A v3 render that succeeds reports the same count it spent.
  const ok = await v3Run();
  assert.equal(ok.err, null);
  assert.equal(ok.got.chars, ok.spent.chars);
  assert.equal(ok.spent.chars, late.spent.chars);
});

test("done call: the voice is everything sent, and the schema is what actually rendered", async () => {
  // Fallback: v3 voiced 1368, then v2 voiced 769 for the video that shipped.
  assert.deepEqual(voiceFacts({ v2Chars: 769, v3Chars: 1368, sampleChars: 0, templateUsed: "v2" }),
    { voice_chars: 2137, voice_chars_v3: 1368, voice_chars_v2: 769, rendered_schema: RENDERED_V2 });
  assert.deepEqual(voiceFacts({ v3Chars: 1368, sampleChars: 300, templateUsed: "v3" }),
    { voice_chars: 1668, voice_chars_v3: 1368, voice_chars_v2: 0, rendered_schema: RENDERED_V3 });
  assert.equal(voiceFacts({ v2Chars: 769 }).rendered_schema, RENDERED_V2);
  // render.mjs reports it so: v3's running count (never reset by a fallback),
  // v2's, the samples, and the template it actually used.
  const src = await readFile(new URL("../render.mjs", import.meta.url), "utf8");
  assert.match(src, /\.\.\.voiceFacts\(\{ v2Chars: chars, v3Chars: v3Spent\.chars, sampleChars, templateUsed \}\)/);
  assert.match(src, /spent: v3Spent,/);
  assert.doesNotMatch(src, /v3Chars = got\.chars/);
  // v2 counts a scene as soon as ElevenLabs returns it, before anything that can fail.
  assert.match(src, /pronunciationDictionaryLocators: locators \|\| undefined,\n\s+\}\);\n\s+chars \+= scene\.voice\.length;/);
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
  assert.match(h, />From the meeting video</);
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

test("clip fetch: only our own storage, the stretch only, never fatal (ffmpeg mocked, no network)", async () => {
  assert.deepEqual(CLIP_HOSTS, ["data.fieldstate.org"]);
  const ok = "https://data.fieldstate.org/videos/clips/tx/2026-10-26/lead-src.mp4";
  assert.deepEqual(clipSource({ hosted_url: ok }), { url: ok });
  // The town's page and its Download link are provenance, never fetched.
  const swagit = { src: "https://southlaketx.new.swagit.com/videos/123", download_url: "https://southlaketx.new.swagit.com/videos/123/download" };
  assert.match(clipSource(swagit).skip, /no hosted_url/);
  assert.match(clipSource({ ...swagit, hosted_url: swagit.download_url }).skip, /southlaketx\.new\.swagit\.com is not our storage/);
  for (const bad of ["http://data.fieldstate.org/x.mp4", "https://data.fieldstate.org.evil.test/x.mp4",
    "https://evil.test/data.fieldstate.org/x.mp4", "https://data.fieldstate.org:8443/x.mp4", "https://u:p@data.fieldstate.org/x.mp4", "nonsense"]) {
    assert.ok(clipSource({ hosted_url: bad }).skip, bad);
  }
  const args = clipFfmpegArgs({ media_start: 130, duration: 17 }, ok, "/tmp/o.mp4");
  assert.deepEqual(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2), ["-ss", "130.00"]);
  assert.deepEqual(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2), ["-t", "17.00"]);
  assert.equal(args[args.indexOf("-i") + 1], ok);

  const dir = await mkdtemp(path.join(tmpdir(), "fs-clip-"));
  try {
    const calls = [];
    const run = async (cmd, a) => {
      calls.push([cmd, a]);
      await writeFile(a.at(-1), "mp4"); // stands in for the cut stretch
      return { code: 0, err: "" };
    };
    const logs = [];
    const opts = { publicDir: dir, log: (l) => logs.push(l), env: {}, run };
    // A Swagit URL is refused: no ffmpeg call, the beat is skipped and logged.
    assert.equal(await fetchClip({ ...swagit, hosted_url: swagit.download_url, duration: 17 }, opts), null);
    assert.equal(await fetchClip({ ...swagit, duration: 17 }, opts), null);
    assert.equal(calls.length, 0);
    assert.ok(logs.some((l) => /is not our storage \(data\.fieldstate\.org\); skipped/.test(l)) && logs.some((l) => /no hosted_url .*; skipped/.test(l)));
    // The data host is accepted and is the only URL ffmpeg is given.
    assert.equal(await fetchClip({ ...swagit, hosted_url: ok, media_start: 130, duration: 17 }, opts), "clips/lead.mp4");
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "ffmpeg");
    assert.equal(calls[0][1][calls[0][1].indexOf("-i") + 1], ok);
    assert.ok(!calls[0][1].some((x) => /swagit/.test(String(x))));
    // A failed cut is never fatal; no duration is skipped before anything runs.
    const fail = async () => ({ code: 1, err: "403 Forbidden" });
    await rm(path.join(dir, "clips"), { recursive: true, force: true });
    assert.equal(await fetchClip({ hosted_url: ok, duration: 17 }, { ...opts, run: fail }), null);
    assert.equal(await fetchClip({ hosted_url: ok, duration: 0 }, opts), null);
    assert.ok(logs.some((l) => /download failed \(1\)/.test(l)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
