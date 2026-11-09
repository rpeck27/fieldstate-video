// The v3 clip beat's footage (fieldstate-site #172, clip spec Oct 30): the
// motion and the vote from the town's meeting video. The engine gives
// `lead.clip` {src, download_url, hosted_url, media_start, duration,
// result_at_s, captions, ...}; this step cuts that stretch to a local file
// BEFORE the HyperFrames project is generated, so the render itself stays
// offline (Docker, --network none).
//
// Source rule: town and vendor sites are fetched only by the engine (as
// FieldstateBot, through sie.http_client, robots obeyed). The render job
// never reads them. It reads the clip only from our own storage, the
// engine's `hosted_url`:
//   - the conductor's clip route (CONDUCTOR_URL + CLIP_ROUTE, the same origin
//     this job already gets its script from): the stretch the engine cut as
//     FieldstateBot and keeps in the PRIVATE bucket until the week's video is
//     approved (fieldstate-site #172, Nov 6). It is downloaded with this
//     run's OIDC token, the way the script is, and `hosted_cut` says the file
//     is the stretch itself;
//   - or the public data host (CLIP_HOSTS).
// `src` and `download_url` are provenance (the town's page and its own
// Download link) and are never fetched here. No hosted_url, or a hosted_url
// on any other host (a Swagit page included), skips the beat with the reason
// logged, and the video renders without it. The log never names the town or
// the meeting. CLIP_FILE (a local file already cut to the stretch) skips the
// download, for review renders.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { oidcToken } from "./conductor.mjs";

export const CLIP_PATH = "clips/lead.mp4";
/** The engine's cut, as downloaded from the conductor, before ffmpeg. */
export const CLIP_SRC_PATH = "clips/lead-src.mp4";
/** The conductor's route for the cut clip (sie-engine weekly_video.ts). */
export const CLIP_ROUTE = "/video/render/clip";
/** The most the conductor route may send (the conductor keeps at most 40 MB). */
export const CLIP_MAX_BYTES = 40 * 1024 * 1024;
export const DEFAULT_USER_AGENT = "FieldstateBot";
/**
 * Our own storage, the only hosts a clip is read from: the public data host
 * (data.fieldstate.org, the R2 bucket the conductor publishes the videos to).
 * The render job reaches the private bucket only through the conductor.
 */
export const CLIP_HOSTS = Object.freeze(["data.fieldstate.org"]);

/** The conductor's origin from CONDUCTOR_URL (https only), or null. */
function conductorOrigin(env) {
  try {
    const u = new URL(String(env?.CONDUCTOR_URL || ""));
    return u.protocol === "https:" && !u.username && !u.password ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * {url, conductor?} for the clip's copy in our own storage, or {skip: reason}.
 * Only `hosted_url`, only https, no credentials, and either exactly the
 * conductor's clip route on CONDUCTOR_URL's origin (the run's OIDC token goes
 * nowhere else) or a CLIP_HOSTS host (no other port).
 */
export function clipSource(clip, env = {}) {
  const raw = clip?.hosted_url;
  if (!raw) return { skip: "no hosted_url (the clip is not in our storage)" };
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return { skip: "hosted_url is not a URL" };
  }
  if (u.protocol !== "https:") return { skip: "hosted_url is not https" };
  if (u.username || u.password) return { skip: "hosted_url carries a port or credentials" };
  const conductor = conductorOrigin(env);
  if (conductor && u.origin === conductor && u.pathname === CLIP_ROUTE) return { url: u.href, conductor: true };
  if (u.pathname === CLIP_ROUTE) return { skip: "hosted_url is a clip route on another host than CONDUCTOR_URL" };
  if (!CLIP_HOSTS.includes(u.hostname.toLowerCase())) {
    return { skip: `hosted_url host ${u.hostname} is not our storage (${CLIP_HOSTS.join(", ")})` };
  }
  if (u.port) return { skip: "hosted_url carries a port or credentials" };
  return { url: u.href };
}

/**
 * Download the engine's cut from the conductor with this run's OIDC token
 * (lib/conductor.mjs) to `out`. Throws on any failure; the caller logs it
 * and goes on without the clip.
 */
export async function downloadConductorClip(url, out, { fetchImpl = fetch, env = process.env, maxBytes = CLIP_MAX_BYTES } = {}) {
  const token = await oidcToken(fetchImpl, env);
  // No redirect is followed: the token is for the conductor only.
  const resp = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "error" });
  if (!resp.ok) throw new Error(`conductor clip http ${resp.status}`);
  const declared = Number(resp.headers.get("Content-Length") ?? "NaN");
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("conductor clip too large");
  if (!resp.body) throw new Error("conductor clip empty");
  let seen = 0;
  const cap = new Transform({
    transform(chunk, _enc, done) {
      seen += chunk.length;
      done(seen > maxBytes ? new Error("conductor clip too large") : null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(resp.body), cap, createWriteStream(out));
  const size = (await stat(out)).size;
  if (!size) throw new Error("conductor clip empty");
  return size;
}

/**
 * ffmpeg arguments that cut [media_start, media_start + duration) to `out`.
 * A local input (the engine's cut, already the stretch: `hosted_cut`) starts
 * at 0 and gets no user agent.
 */
export function clipFfmpegArgs(clip, url, out, userAgent = DEFAULT_USER_AGENT, { local = false } = {}) {
  const start = local && clip.hosted_cut ? 0 : Number(clip.media_start || 0);
  return [
    "-y", "-loglevel", "error", ...(local ? [] : ["-user_agent", userAgent]),
    "-ss", start.toFixed(2), "-i", url, "-t", Number(clip.duration).toFixed(2),
    "-map", "0:v:0", "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-movflags", "+faststart", out,
  ];
}

function exec(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, err: e.message });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, err });
    });
  });
}

/**
 * Cut the clip into `publicDir/clips/lead.mp4`. Returns the path relative to
 * `publicDir` ("clips/lead.mp4"), or null (logged) when there is no usable
 * clip; the render then goes on without the clip beat. `run` is the ffmpeg
 * runner (tests pass a stand-in; nothing else reaches the network).
 */
export async function fetchClip(clip, { publicDir, log = console.log, env = process.env, timeoutMs = 180_000, run = exec, fetchImpl = fetch } = {}) {
  if (!clip) return null;
  if (!(Number(clip.duration) > 0)) {
    log("clip: no duration; skipped");
    return null;
  }
  const out = path.join(publicDir, CLIP_PATH);
  await mkdir(path.dirname(out), { recursive: true });
  if (env.CLIP_FILE) {
    await copyFile(env.CLIP_FILE, out);
    log("clip: local CLIP_FILE used");
    return CLIP_PATH;
  }
  const src = clipSource(clip, env);
  if (!src.url) {
    log(`clip: ${src.skip}; skipped`);
    return null;
  }
  let input = src.url;
  const local = !!src.conductor;
  const srcFile = path.join(publicDir, CLIP_SRC_PATH);
  if (local) {
    // The engine's cut, from the private bucket through the conductor:
    // fetched here, before the offline render, never during it.
    try {
      const got = await downloadConductorClip(src.url, srcFile, { fetchImpl, env });
      log(`clip: the engine's cut fetched from the conductor (${(got / 1e6).toFixed(1)} MB)`);
    } catch (err) {
      await rm(srcFile, { force: true });
      log(`clip: ${err.message}; skipped`);
      return null;
    }
    input = srcFile;
  }
  const r = await run("ffmpeg", clipFfmpegArgs(clip, input, out, env.CLIP_USER_AGENT || DEFAULT_USER_AGENT, { local }), timeoutMs);
  if (local) await rm(srcFile, { force: true });
  const size = (await stat(out).catch(() => null))?.size ?? 0;
  if (r.code !== 0 || !size) {
    log(`clip: download failed (${r.code}); skipped: ${String(r.err).trim().split("\n").pop()?.slice(0, 200) ?? ""}`);
    return null;
  }
  log(`clip: ${Number(clip.duration).toFixed(1)} s cut from our copy of the recording (${(size / 1e6).toFixed(1)} MB)`);
  return CLIP_PATH;
}
