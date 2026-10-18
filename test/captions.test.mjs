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
  const words = wordsFromAlignment(align("This is Fieldstate. The week ahead in North Carolina, for the week of October 19."));
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
