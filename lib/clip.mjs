// The v3 clip beat's footage (fieldstate-site #172, clip spec Oct 30): the
// motion and the vote from the town's meeting video. The engine gives
// `lead.clip` {src, download_url, hosted_url, media_start, duration,
// result_at_s, captions, ...}; this step cuts that stretch to a local file
// BEFORE the HyperFrames project is generated, so the render itself stays
// offline (Docker, --network none).
//
// Source rule: town and vendor sites are fetched only by the engine (as
// FieldstateBot, through sie.http_client, robots obeyed). The render job
// never reads them. It reads the clip only from our own storage: the
// engine's `hosted_url` on the public data host (CLIP_HOSTS). `src` and
// `download_url` are provenance (the town's page and its own Download link)
// and are never fetched here. No hosted_url, or a hosted_url on any other
// host (a Swagit page included), skips the beat with the reason logged, and
// the video renders without it. CLIP_FILE (a local file already cut to the
// stretch) skips the download, for review renders.
import { spawn } from "node:child_process";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

export const CLIP_PATH = "clips/lead.mp4";
export const DEFAULT_USER_AGENT = "FieldstateBot";
/**
 * Our own storage, the only hosts a clip is read from: the public data host
 * (data.fieldstate.org, the R2 bucket the conductor publishes the videos to).
 * The render job reaches the private bucket only through the conductor.
 */
export const CLIP_HOSTS = Object.freeze(["data.fieldstate.org"]);

/**
 * {url} for the clip's copy in our own storage, or {skip: reason}. Only
 * `hosted_url`, only https, only a CLIP_HOSTS host (exactly: no other port,
 * no credentials).
 */
export function clipSource(clip) {
  const raw = clip?.hosted_url;
  if (!raw) return { skip: "no hosted_url (the clip is not in our storage)" };
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return { skip: "hosted_url is not a URL" };
  }
  if (u.protocol !== "https:") return { skip: "hosted_url is not https" };
  if (!CLIP_HOSTS.includes(u.hostname.toLowerCase())) {
    return { skip: `hosted_url host ${u.hostname} is not our storage (${CLIP_HOSTS.join(", ")})` };
  }
  if (u.port || u.username || u.password) return { skip: "hosted_url carries a port or credentials" };
  return { url: u.href };
}

/** ffmpeg arguments that cut [media_start, media_start + duration) to `out`. */
export function clipFfmpegArgs(clip, url, out, userAgent = DEFAULT_USER_AGENT) {
  return [
    "-y", "-loglevel", "error", "-user_agent", userAgent,
    "-ss", Number(clip.media_start || 0).toFixed(2), "-i", url, "-t", Number(clip.duration).toFixed(2),
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
export async function fetchClip(clip, { publicDir, log = console.log, env = process.env, timeoutMs = 180_000, run = exec } = {}) {
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
  const src = clipSource(clip);
  if (!src.url) {
    log(`clip: ${src.skip}; skipped`);
    return null;
  }
  const r = await run("ffmpeg", clipFfmpegArgs(clip, src.url, out, env.CLIP_USER_AGENT || DEFAULT_USER_AGENT), timeoutMs);
  const size = (await stat(out).catch(() => null))?.size ?? 0;
  if (r.code !== 0 || !size) {
    log(`clip: download failed (${r.code}); skipped: ${String(r.err).trim().split("\n").pop()?.slice(0, 200) ?? ""}`);
    return null;
  }
  log(`clip: ${Number(clip.duration).toFixed(1)} s cut from our copy of the recording (${(size / 1e6).toFixed(1)} MB)`);
  return CLIP_PATH;
}
