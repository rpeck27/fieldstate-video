// The clip beat's footage from the conductor (fieldstate-site #172, Nov 6):
// the engine cuts the stretch as FieldstateBot into the private bucket, and
// this job fetches it with its OIDC token before the offline render. No
// network: fetch and ffmpeg are stand-ins.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { CLIP_PATH, CLIP_ROUTE, clipFfmpegArgs, clipSource, downloadConductorClip, fetchClip } from "../lib/clip.mjs";

const CONDUCTOR = "https://fieldstate-shadow-conductor.rpeck27.workers.dev";
const ROUTE = `${CONDUCTOR}${CLIP_ROUTE}?render_id=20261114-0123456789abcdef`;
const ENV = {
  CONDUCTOR_URL: CONDUCTOR,
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.test/req?x=1",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-bearer",
};
const CLIP = {
  src: "https://southlaketx.new.swagit.com/videos/123",
  download_url: "https://southlaketx.new.swagit.com/videos/123/download",
  hosted_url: ROUTE,
  hosted_cut: true,
  media_start: 4210.5,
  duration: 17.25,
};

/** A fetch stand-in: the OIDC token endpoint, then the conductor's clip route. */
function fakeFetch({ status = 200, body = "engine-cut-bytes", headers = {} } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("https://token.actions.test/")) {
      return new Response(JSON.stringify({ value: "oidc-jwt" }), { status: 200 });
    }
    if (String(url).startsWith(CONDUCTOR)) {
      return new Response(status === 200 ? body : JSON.stringify({ error: "no_clip" }), {
        status,
        headers: { "Content-Type": status === 200 ? "video/mp4" : "application/json", ...headers },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { impl, calls };
}

test("clip source: the conductor's clip route only on CONDUCTOR_URL's origin", () => {
  assert.deepEqual(clipSource(CLIP, ENV), { url: ROUTE, conductor: true });
  // No CONDUCTOR_URL (a local render): the route is not trusted.
  assert.match(clipSource(CLIP, {}).skip, /another host than CONDUCTOR_URL/);
  for (const bad of [
    `https://evil.test${CLIP_ROUTE}?render_id=x`,
    `http://fieldstate-shadow-conductor.rpeck27.workers.dev${CLIP_ROUTE}`,
    `https://fieldstate-shadow-conductor.rpeck27.workers.dev:8443${CLIP_ROUTE}`,
    `https://u:p@fieldstate-shadow-conductor.rpeck27.workers.dev${CLIP_ROUTE}`,
    `${CONDUCTOR}/video/render/script`,
    `${CONDUCTOR}${CLIP_ROUTE}/x`,
  ]) {
    assert.ok(clipSource({ hosted_url: bad }, ENV).skip, bad);
  }
  // An http CONDUCTOR_URL is never trusted with the token.
  assert.ok(clipSource({ hosted_url: `http://c.test${CLIP_ROUTE}` }, { CONDUCTOR_URL: "http://c.test" }).skip);
  // The data host still works as before.
  const ok = "https://data.fieldstate.org/videos/clips/tx/x.mp4";
  assert.deepEqual(clipSource({ hosted_url: ok }, ENV), { url: ok });
});

test("ffmpeg on the engine's cut: a local file from 0, no user agent", () => {
  const local = clipFfmpegArgs(CLIP, "/w/public/clips/lead-src.mp4", "/w/out.mp4", "FieldstateBot", { local: true });
  assert.deepEqual(local.slice(local.indexOf("-ss"), local.indexOf("-ss") + 2), ["-ss", "0.00"]);
  assert.deepEqual(local.slice(local.indexOf("-t"), local.indexOf("-t") + 2), ["-t", "17.25"]);
  assert.ok(!local.includes("-user_agent"));
  // Not marked as the stretch: the recording's own start.
  const whole = clipFfmpegArgs({ ...CLIP, hosted_cut: false }, "/w/x.mp4", "/w/o.mp4", "FieldstateBot", { local: true });
  assert.deepEqual(whole.slice(whole.indexOf("-ss"), whole.indexOf("-ss") + 2), ["-ss", "4210.50"]);
});

test("download: the run's OIDC token goes to the conductor only, no redirects, size capped", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fs-clip-dl-"));
  try {
    const out = path.join(dir, "src.mp4");
    const f = fakeFetch();
    assert.equal(await downloadConductorClip(ROUTE, out, { fetchImpl: f.impl, env: ENV }), 16);
    assert.equal(await readFile(out, "utf8"), "engine-cut-bytes");
    assert.equal(f.calls.length, 2);
    assert.match(f.calls[0].url, /audience=fieldstate-video/);
    assert.equal(f.calls[1].url, ROUTE);
    assert.equal(f.calls[1].init.headers.Authorization, "Bearer oidc-jwt");
    assert.equal(f.calls[1].init.redirect, "error");
    await assert.rejects(downloadConductorClip(ROUTE, out, { fetchImpl: fakeFetch({ status: 404 }).impl, env: ENV }), /http 404/);
    await assert.rejects(
      downloadConductorClip(ROUTE, out, { fetchImpl: fakeFetch({ headers: { "Content-Length": "999" } }).impl, env: ENV, maxBytes: 10 }),
      /too large/,
    );
    await assert.rejects(downloadConductorClip(ROUTE, out, { fetchImpl: fakeFetch().impl, env: ENV, maxBytes: 10 }), /too large/);
    await assert.rejects(downloadConductorClip(ROUTE, out, { fetchImpl: fakeFetch().impl, env: {} }), /no OIDC token/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fetchClip: the engine's cut is fetched, normalised from 0 and the download removed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fs-clip-"));
  try {
    const calls = [];
    const run = async (cmd, a) => {
      calls.push([cmd, a]);
      assert.equal(await readFile(a[a.indexOf("-i") + 1], "utf8"), "engine-cut-bytes");
      await writeFile(a.at(-1), "normalised");
      return { code: 0, err: "" };
    };
    const logs = [];
    const f = fakeFetch();
    const got = await fetchClip(CLIP, { publicDir: dir, log: (l) => logs.push(l), env: ENV, run, fetchImpl: f.impl });
    assert.equal(got, CLIP_PATH);
    assert.equal(await readFile(path.join(dir, CLIP_PATH), "utf8"), "normalised");
    await assert.rejects(stat(path.join(dir, "clips", "lead-src.mp4"))); // the download is not baked in
    const a = calls[0][1];
    assert.equal(a[a.indexOf("-ss") + 1], "0.00");
    assert.ok(!a.some((x) => /swagit|workers\.dev/.test(String(x))));
    // Nothing fetched but the token and the conductor's route; the town's
    // site never.
    assert.deepEqual(f.calls.map((c) => new URL(c.url).hostname), ["token.actions.test", new URL(CONDUCTOR).hostname]);
    // The log names neither the town nor the meeting.
    assert.ok(logs.every((l) => !/swagit|southlake|render_id/i.test(l)), logs.join("\n"));
    assert.ok(logs.some((l) => /the engine's cut fetched from the conductor/.test(l)));

    // The conductor has no clip: skipped and logged, ffmpeg never runs.
    const before = calls.length;
    const logs2 = [];
    const none = await fetchClip(CLIP, { publicDir: dir, log: (l) => logs2.push(l), env: ENV, run, fetchImpl: fakeFetch({ status: 404 }).impl });
    assert.equal(none, null);
    assert.equal(calls.length, before);
    assert.ok(logs2.some((l) => /conductor clip http 404; skipped/.test(l)));
    await assert.rejects(stat(path.join(dir, "clips", "lead-src.mp4")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
