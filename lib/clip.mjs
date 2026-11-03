// The v3 clip beat's footage (fieldstate-site #172, clip spec Oct 30): the
// motion and the vote from the town's own meeting video. The engine gives
// `lead.clip` {src, media_start, duration, result_at_s, captions, ...}; this
// step cuts that stretch to a local file BEFORE the HyperFrames project is
// generated, so the render itself stays offline (Docker, --network none).
//
// Source rule (the surface's): the town's own Download link. For a Swagit
// video page (".../videos/<id>") that is ".../videos/<id>/download", which
// answers with a redirect to the city's signed file; ffmpeg follows it and
// reads only the stretch it needs (range requests). Any failure returns null
// and the video renders without the clip beat. CLIP_FILE (a local file
// already cut to the stretch) skips the download, for review renders.
import { spawn } from "node:child_process";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

export const CLIP_PATH = "clips/lead.mp4";
export const DEFAULT_USER_AGENT = "FieldstateBot";
const SWAGIT_PAGE = /^https:\/\/[a-z0-9.-]+\.swagit\.com\/videos\/\d+\/?$/i;

/** The town's own download link for the clip's recording. */
export function clipDownloadUrl(clip) {
  if (clip?.download_url) return String(clip.download_url);
  const src = String(clip?.src ?? "");
  if (SWAGIT_PAGE.test(src)) return `${src.replace(/\/$/, "")}/download`;
  return src;
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
 * clip; the render then goes on without the clip beat.
 */
export async function fetchClip(clip, { publicDir, log = console.log, env = process.env, timeoutMs = 180_000 } = {}) {
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
  const url = clipDownloadUrl(clip);
  if (!/^https:\/\//i.test(url)) {
    log("clip: no https download link; skipped");
    return null;
  }
  const r = await exec("ffmpeg", clipFfmpegArgs(clip, url, out, env.CLIP_USER_AGENT || DEFAULT_USER_AGENT), timeoutMs);
  const size = (await stat(out).catch(() => null))?.size ?? 0;
  if (r.code !== 0 || !size) {
    log(`clip: download failed (${r.code}); skipped: ${String(r.err).trim().split("\n").pop()?.slice(0, 200) ?? ""}`);
    return null;
  }
  log(`clip: ${Number(clip.duration).toFixed(1)} s cut from the town's recording (${(size / 1e6).toFixed(1)} MB)`);
  return CLIP_PATH;
}
