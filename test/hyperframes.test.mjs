// The HyperFrames path: generator, map baking, the lint/render plumbing.
// Pure: no Docker, no browser, no network.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { estimatedAlignment } from "../lib/captions.mjs";
import {
  DOCKERFILE,
  HF_VERSION,
  IMAGE_TAG,
  QUIET_ENV,
  childEnv,
  dockerRunArgs,
  stillTimes,
} from "../lib/hyperframes.mjs";
import { buildTimeline } from "../lib/timeline.mjs";
import { captionGroups, compositionHtml, mapBox } from "../hyperframes/generate.mjs";
import { STATE_FIPS, countyFor, stateMap } from "../hyperframes/geo.mjs";
import { PHOTOS, photoFor } from "../hyperframes/photos.mjs";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

// A synthetic script with every scene kind (shape of fieldstate.weekly_video.v2).
function fixture(state = "NC", stateName = "North Carolina", fips = ["37183", "37051"]) {
  return {
    schema: "fieldstate.weekly_video.v2",
    state,
    state_name: stateName,
    title: `This week in ${stateName} · Oct 26`,
    week_of: "2026-10-26",
    scenes: [
      {
        id: "open", kind: "title", voice: `This week in ${stateName}.`, cap: `This week in ${stateName}.`,
        screen: { state_name: stateName, week_label: "Week of Oct 26", kicker: "This week in", places_read: 12, read_fips: fips },
      },
      {
        id: "decisions", kind: "decisions", voice: "On Monday, the example board approved an example rezoning.",
        screen: {
          kicker: "Decided · Oct 19", fips: [fips[0]], county: "Cumberland", place: `Example Town, ${state}`,
          items: [{ text: "example rezoning of 12 acres", outcome: "approved", kind_label: "Rezoning", place_short: "Example Town", figure: "12 acres", tier: "Documented" }],
        },
      },
      {
        id: "story", kind: "story", voice: "Example topics are on local agendas.",
        screen: { headline: "Example topics are on local agendas", fips, places: [`Example Town, ${state}`, `Other Town, ${state}`], figure: { value: 2, label: "places" } },
      },
      {
        id: "agenda-0", kind: "agenda", voice: "On Tuesday, the example council takes up an example item.",
        cap: "On Tuesday, October 27 at 7:00 PM, the example council takes up an example item.",
        screen: { place: `Example Town, ${state}`, body: "Town Council", time: "7:00 PM", when: ["TUE", "OCT 27"], fips: fips[1], items: [{ text: "example item", kind_label: "Item" }], n_items: 9 },
      },
      { id: "leg", kind: "legislature", voice: "One tracked bill moved.", screen: { count: 1 } },
      { id: "close", kind: "outro", voice: "We show you the record.", cap: "We show you the record.", screen: { site: "fieldstate.org" } },
    ],
  };
}

function timelineFor(script, withAudio = false) {
  const voiced = script.scenes.map((s, i) => ({
    id: s.id,
    audio: withAudio ? `audio/${String(i).padStart(2, "0")}.mp3` : null,
    alignment: estimatedAlignment(s.voice, s.voice.length / 15),
    audioSeconds: withAudio ? s.voice.length / 15 + 0.05 : undefined,
  }));
  return buildTimeline(script, voiced);
}

test("geo: North Carolina bakes to exactly the Remotion map (src/nc-counties.json)", async () => {
  const old = JSON.parse(await readFile(new URL("../src/nc-counties.json", import.meta.url), "utf8"));
  const m = stateMap("NC");
  assert.equal(m.viewBox, old.viewBox);
  assert.deepEqual(
    m.counties.map(({ id, name, d, x, y }) => ({ id, name, d, x, y })),
    old.counties,
  );
});

test("geo: any state bakes from the same code; unknown states refuse", () => {
  const tx = stateMap("tx");
  assert.equal(tx.counties.length, 254);
  assert.equal(countyFor(tx, "48113")?.name, "Dallas");
  assert.equal(countyFor(tx, "Galveston County")?.id, "48167");
  assert.equal(Object.keys(STATE_FIPS).length, 51);
  assert.throws(() => stateMap("XX"), /no map/);
});

test("map box: a wide state keeps the pilot's width; a tall one is fitted", () => {
  const nc = mapBox(stateMap("NC"), 1080, 680);
  assert.equal(nc.width, 1080);
  assert.equal(nc.left, 0);
  const tx = mapBox(stateMap("TX"), 1080, 680);
  assert.equal(tx.height, 680);
  assert.ok(tx.width < 1080 && tx.left > 0);
});

test("composition: no URL of any kind, so nothing can be fetched at render time", () => {
  for (const [st, name, fips] of [["NC", "North Carolina", ["37183", "37051"]], ["TX", "Texas", ["48113", "48167"]]]) {
    const script = fixture(st, name, fips);
    const { html } = compositionHtml({ script, timeline: timelineFor(script, true), transcript: null });
    assert.doesNotMatch(html, /https?:\/\//i, `${st}: a URL in the composition`);
    assert.doesNotMatch(html, /\/\/[a-z0-9.-]+\.[a-z]{2,}\//i, `${st}: a protocol-relative URL`);
    for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) assert.match(m[1], /^assets\//, m[1]);
    for (const m of html.matchAll(/url\("([^"]+)"\)/g)) assert.match(m[1], /^assets\/fonts\//, m[1]);
    assert.doesNotMatch(html, /Math\.random|Date\.now|setInterval|fetch\(/);
  }
});

test("composition: timing follows the voiced timeline (scene and audio starts)", () => {
  const script = fixture();
  const tl = timelineFor(script, true);
  const { html, duration } = compositionHtml({ script, timeline: tl, transcript: null });
  assert.equal(duration, Number((tl.totalFrames / tl.fps).toFixed(4)));
  assert.match(html, new RegExp(`id="root" data-composition-id="main" data-start="0" data-duration="${duration}"`));
  tl.scenes.forEach((sc, i) => {
    const start = Number((sc.from / tl.fps).toFixed(4));
    const dur = Number((sc.durationInFrames / tl.fps).toFixed(4));
    assert.match(html, new RegExp(`id="scene-${i}" class="clip scene"[^>]*data-start="${start}" data-duration="${dur}"`));
    const audioStart = Number(((sc.from + sc.audioFrom) / tl.fps).toFixed(4));
    const window = Number((start + dur - audioStart).toFixed(4));
    assert.match(html, new RegExp(`<audio id="vo-${i}" class="clip" src="assets/audio/${String(i).padStart(2, "0")}\\.mp3" data-start="${audioStart}" data-duration="${window}"`));
  });
  // Every timed element and every animated element has a unique id.
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test("composition: Texas needs only its script (no North Carolina left in the template)", () => {
  const script = fixture("TX", "Texas", ["48113", "48167"]);
  const { html } = compositionHtml({ script, timeline: timelineFor(script), transcript: null });
  assert.doesNotMatch(html, /North Carolina|General Assembly|, NC\b/);
  assert.match(html, />Texas</);
});

test("captions: one group per cue, never overlapping, never over the closing card", () => {
  const cues = [
    { text: "One.", start: 0.3, end: 1.0 },
    { text: "Two.", start: 1.1, end: 2.0 },
    { text: "Three.", start: 9.5, end: 10.5 },
  ];
  const g = captionGroups(cues, 9.0);
  assert.equal(g.length, 2);
  assert.ok(g[0].start + g[0].duration <= g[1].start + 1e-9);
  assert.ok(g[1].start + g[1].duration <= 9.0 + 1e-9);
  assert.ok(Math.abs(g[0].start - 0.25) < 1e-9);
});

test("photos: same list as the Remotion render; keyed by the script's state", async () => {
  const ts = await readFile(new URL("../src/photos.ts", import.meta.url), "utf8");
  for (const p of PHOTOS) {
    assert.ok(ts.includes(`file: "${p.file}"`), p.file);
    assert.ok(ts.includes(`place: "${p.place}"`), p.place);
    assert.ok(ts.includes(`credit: "${p.credit}"`), p.credit);
  }
  assert.equal((ts.match(/file: "/g) || []).length, PHOTOS.length);
  assert.ok(photoFor(null, "Cumberland", "NC"));
  assert.equal(photoFor(null, "Cumberland", "TX"), null);
});

test("render plumbing: pinned version, no network, no secrets passed on", async () => {
  assert.match(HF_VERSION, /^\d+\.\d+\.\d+$/, "hyperframes must be pinned exactly in package.json");
  assert.equal(pkg.dependencies.hyperframes, HF_VERSION);
  assert.equal(IMAGE_TAG, `hyperframes-renderer:${HF_VERSION}`);
  const dockerfile = await readFile(DOCKERFILE, "utf8");
  assert.ok(dockerfile.includes(`hyperframes@${HF_VERSION} dist/docker/Dockerfile.render`), "Dockerfile.render header names the pinned version");
  assert.doesNotMatch(dockerfile, /chrome-headless-shell@stable/);
  const args = dockerRunArgs({ projectDir: "/tmp/p", outFile: "/tmp/o/video.mp4", workers: 4 });
  const net = args.indexOf("--network");
  assert.equal(args[net + 1], "none");
  assert.ok(args.includes("--strict"));
  assert.ok(args.includes(":ro") || args.some((a) => a.endsWith(":/project:ro")));
  for (const k of Object.keys(QUIET_ENV)) assert.ok(args.includes(`${k}=1`), k);
  for (const banned of ["publish", "cloud", "auth", "lambda", "cloudrun"]) assert.ok(!args.includes(banned));
  const prev = { ...process.env };
  process.env.ELEVENLABS_API_KEY = "x";
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "y";
  try {
    const env = childEnv();
    assert.equal(env.ELEVENLABS_API_KEY, undefined);
    assert.equal(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, undefined);
    assert.equal(env.HYPERFRAMES_NO_TELEMETRY, "1");
  } finally {
    for (const k of ["ELEVENLABS_API_KEY", "ACTIONS_ID_TOKEN_REQUEST_TOKEN"]) {
      if (k in prev) process.env[k] = prev[k];
      else delete process.env[k];
    }
  }
});

test("stills: the same moments the Remotion path picks", () => {
  const tl = timelineFor(fixture());
  const t = stillTimes(tl);
  assert.ok(Math.abs(t.poster - (Math.min(tl.scenes[0].durationInFrames - 1, 45) + 0.5) / 30) < 1e-9);
  const card = tl.scenes.find((s) => s.kind === "decisions");
  assert.ok(Math.abs(t.stills[1][1] - (card.from + Math.floor(card.durationInFrames * 0.8) + 0.5) / 30) < 1e-9);
  assert.deepEqual(t.stills.map((s) => s[0]), ["still-open.jpg", "still-card.jpg", "still-close.jpg"]);
});

test("render.mjs: Remotion stays the default; HyperFrames only on RENDERER=hyperframes", async () => {
  const src = await readFile(new URL("../render.mjs", import.meta.url), "utf8");
  assert.match(src, /const wanted = \(env\.RENDERER \|\| "remotion"\)/);
  assert.match(src, /if \(wanted === "hyperframes"\) \{\s*try \{/);
  // The HyperFrames module is loaded only inside that try: it can never stop a Remotion render.
  assert.doesNotMatch(src, /^import .*lib\/hyperframes\.mjs/m);
  const wf = await readFile(new URL("../.github/workflows/render.yml", import.meta.url), "utf8");
  assert.match(wf, /RENDERER: \$\{\{ vars\.RENDERER \}\}/);
  assert.match(wf, /^name: Render weekly video$/m);
  assert.match(wf, /id-token: write/);
});
