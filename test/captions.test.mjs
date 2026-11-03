import assert from "node:assert/strict";
import test from "node:test";

import { cuesFromCaption, cuesFromWords, estimatedAlignment, toVtt, wordsFromAlignment } from "../lib/captions.mjs";
import { buildTimeline } from "../lib/timeline.mjs";

function align(text, perChar = 0.05) {
  const chars = [...text];
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => i * perChar),
    character_end_times_seconds: chars.map((_, i) => (i + 1) * perChar),
  };
}

test("words carry their own times, shifted by the scene start", () => {
  const w = wordsFromAlignment(align("On Monday, the board"), 10);
  assert.deepEqual(w.map((x) => x.text), ["On", "Monday,", "the", "board"]);
  assert.equal(w[0].start, 10);
  assert.ok(Math.abs(w[3].end - (10 + 20 * 0.05)) < 1e-9);
});

test("cues break at sentence ends and stay short", () => {
  // 0.07 s per character is speech pace; faster and a 4-word tail is an
  // orphan (under 1.2 s) that merges into the cue before it (fix 1).
  const words = wordsFromAlignment(align("This is Fieldstate. The week ahead in North Carolina, for the week of October 19.", 0.07));
  const cues = cuesFromWords(words, { maxChars: 42 });
  assert.equal(cues[0].text, "This is Fieldstate.");
  for (const c of cues) assert.ok(c.text.length <= 42, c.text);
  assert.equal(cues.map((c) => c.text).join(" "), words.map((w) => w.text).join(" "));
});

test("VTT is well formed", () => {
  const vtt = toVtt([{ start: 0, end: 1.234, text: "Hello." }, { start: 61.5, end: 62, text: "Bye." }]);
  assert.equal(vtt, "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.234\nHello.\n\n2\n00:01:01.500 --> 00:01:02.000\nBye.\n");
});

test("a cap line keeps digits even when the voice spells them", () => {
  const script = {
    scenes: [{ id: "a", kind: "agenda", voice: "October nineteenth.", cap: "October 19." }],
  };
  const voiced = [{ id: "a", audio: null, alignment: estimatedAlignment(script.scenes[0].voice, 2) }];
  const t = buildTimeline(script, voiced);
  assert.equal(t.cues.map((c) => c.text).join(" "), "October 19.");
  assert.ok(!t.cues.some((c) => c.text.includes("nineteenth")));
});

test("cuesFromCaption breaks long lines and covers the voice window", () => {
  const cues = cuesFromCaption("On Monday, October 19, the board meets.", 1, 5, { maxChars: 24 });
  assert.ok(cues.length > 1);
  assert.equal(cues.map((c) => c.text).join(" "), "On Monday, October 19, the board meets.");
  assert.ok(Math.abs(cues[0].start - 1) < 1e-9);
  assert.ok(Math.abs(cues[cues.length - 1].end - 5) < 1e-9);
});

test("timeline: scenes follow each other; captions line up with the voice", () => {
  const script = {
    scenes: [
      { id: "intro", kind: "title", voice: "This is Fieldstate." },
      { id: "outro", kind: "outro", voice: "That's the week." },
    ],
  };
  const voiced = script.scenes.map((s) => ({ id: s.id, audio: null, alignment: estimatedAlignment(s.voice, 2) }));
  const t = buildTimeline(script, voiced);
  assert.equal(t.scenes[0].from, 0);
  assert.equal(t.scenes[1].from, t.scenes[0].durationInFrames);
  assert.equal(t.totalFrames, t.scenes[0].durationInFrames + t.scenes[1].durationInFrames);
  // Title holds a little longer than its voice.
  assert.ok(t.scenes[0].durationInFrames >= Math.ceil((0.3 + 2 + 0.7 + 1.2) * 30));
  const second = t.cues.find((c) => c.text.startsWith("That's"));
  assert.ok(second.start >= t.scenes[1].from / 30);
  assert.throws(() => buildTimeline(script, voiced.slice().reverse()), /mismatch/);
});

test("a scene is never shorter than its measured audio file", () => {
  const script = { scenes: [{ id: "a", kind: "agenda", voice: "x", cap: "x" }] };
  const alignment = { characters: ["x"], character_start_times_seconds: [0], character_end_times_seconds: [2] };
  const short = buildTimeline(script, [{ id: "a", audio: null, alignment }]);
  const long = buildTimeline(script, [{ id: "a", audio: null, alignment, audioSeconds: 3.5 }]);
  assert.equal(long.scenes[0].durationInFrames - short.scenes[0].durationInFrames, 45);
});

// Surface review of the v3 renders (fieldstate-site #172, Oct 30, fix 1):
// no cue ends on an abbreviation's period, and no orphan cue is left alone.
import { breaksAfter, mergeOrphans } from "../lib/captions.mjs";

test("a cue never breaks after an abbreviation's period", () => {
  for (const w of ["Rd.", "St.", "Ave.", "No.", "Mr.", "p.", "U.", "Oct.", "(No."]) assert.equal(breaksAfter(w), false, w);
  for (const w of ["held.", "approved.", "none.", "Carolina.", "19.", "no.", "street.", "it.”"]) assert.equal(breaksAfter(w), true, w);
  assert.equal(breaksAfter("record;", true), true);
  assert.equal(breaksAfter("record;", false), false);
  const words = wordsFromAlignment(align("The board approved a rezoning at 1200 Main Rd. in Dallas, five votes to one.", 0.07));
  const cues = cuesFromWords(words, { maxChars: 42 });
  assert.ok(!cues.some((c) => /\bRd\.$/.test(c.text)), JSON.stringify(cues.map((c) => c.text)));
  assert.equal(cues.map((c) => c.text).join(" "), words.map((w) => w.text).join(" "));
  const fromCap = cuesFromCaption("Rezoning at 1200 Main Rd. was approved.", 0, 4, { maxChars: 60 });
  assert.deepEqual(fromCap.map((c) => c.text), ["Rezoning at 1200 Main Rd. was approved."]);
});

test("orphan cues merge into the cue before them", () => {
  const cues = [
    { start: 0, end: 3, text: "The board took it up again on Monday and" },
    { start: 3, end: 3.4, text: "approved." },
    { start: 3.4, end: 6, text: "That is fifteen votes in a row without a" },
    { start: 6, end: 6.5, text: "no vote." },
    { start: 6.5, end: 9, text: "Three items are on the posted agenda." },
  ];
  const merged = mergeOrphans(cues);
  assert.deepEqual(merged.map((c) => c.text), [
    "The board took it up again on Monday and approved.",
    "That is fifteen votes in a row without a no vote.",
    "Three items are on the posted agenda.",
  ]);
  assert.deepEqual(merged.map((c) => [c.start, c.end]), [[0, 3.4], [3.4, 6.5], [6.5, 9]]);
  assert.equal(cues.length, 5); // pure
  // A short cue of three words that lasts long enough stands on its own.
  assert.equal(mergeOrphans([{ start: 0, end: 2, text: "Five votes to none." }, { start: 2, end: 4, text: "The board agreed." }]).length, 2);
  // Under 1.2 s is an orphan even with enough words; the first cue is kept as it is.
  assert.equal(mergeOrphans([{ start: 0, end: 2, text: "Five votes to none." }, { start: 2, end: 3, text: "The board agreed today." }]).length, 1);
  assert.equal(mergeOrphans([{ start: 0, end: 0.5, text: "Rd." }]).length, 1);
  // The two builders both merge their orphans.
  const words = wordsFromAlignment(align("On October 19, the board approved it. Hold.", 0.08));
  assert.ok(!cuesFromWords(words).some((c) => c.text === "Hold."));
  assert.deepEqual(cuesFromCaption("The board approved it. Yes.", 0, 3).map((c) => c.text), ["The board approved it. Yes."]);
});

// v3 lines break at a clause, not mid-clause (fieldstate-site #172, Nov 3
// ask 5): opt-in, so every v2 cue is what it was.
test("v3 caption lines break after a clause when they run long; v2 is unchanged", () => {
  const cap = "The last divided vote, on the votes we hold, was in November 2024: 3–2.";
  assert.deepEqual(cuesFromCaption(cap, 0, 8).map((c) => c.text),
    ["The last divided vote, on the votes we", "hold, was in November 2024: 3–2."]);
  assert.deepEqual(cuesFromCaption(cap, 0, 8, { clauses: true }).map((c) => c.text),
    ["The last divided vote,", "on the votes we hold,", "was in November 2024: 3–2."]);
  // Never a break that leaves fewer than three words before it, never past 42.
  const short = cuesFromCaption("On October 19, the Union County Board of Commissioners approved a rezoning.", 0, 8, { clauses: true });
  assert.equal(short[0].text, "On October 19,");
  for (const c of short) assert.ok(c.text.length <= 42, c.text);
  assert.deepEqual(cuesFromCaption("Yes, the board agreed to the full rezoning of the Example Road site.", 0, 8, { clauses: true }).map((c) => c.text),
    cuesFromCaption("Yes, the board agreed to the full rezoning of the Example Road site.", 0, 8).map((c) => c.text));
  // The words and their order never change.
  for (const c of [cap, "Not one no vote in 23 months: the Union County Board of Commissioners, 16 recorded votes in a row, on the votes we hold."]) {
    assert.equal(cuesFromCaption(c, 0, 9, { clauses: true }).map((x) => x.text).join(" "), c);
  }
});
