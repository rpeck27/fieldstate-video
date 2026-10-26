// The HyperFrames render path (engine brief Oct 26, 2026: HyperFrames pilot).
//
//   generate   script + timeline → out/hf/ (hyperframes/generate.mjs)
//   captions   our captions.vtt → transcript.json (`hyperframes transcribe`,
//              import only: no model, no network) → burned in
//   lint       `hyperframes lint`; any error stops this path
//   image      the pinned render image (hyperframes/Dockerfile.render),
//              tagged as `hyperframes render --docker` expects
//   render     the same container `--docker` runs, plus --network none
//   frames     poster and review stills cut from the finished MP4 (ffmpeg)
//
// Any failure throws an Error with `.step`; render.mjs then renders the same
// voiced timeline with Remotion. No HeyGen account, no cloud render, no
// publish: those commands are never called here.
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { toVtt } from "./captions.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The pinned CLI version (package.json, exact). The image is built for it. */
export const HF_VERSION = require("../package.json").dependencies.hyperframes;
export const IMAGE_TAG = `hyperframes-renderer:${HF_VERSION}`;
export const DOCKERFILE = path.join(ROOT, "hyperframes", "Dockerfile.render");

/** No telemetry, no update check, no self-install: on the host and inside. */
export const QUIET_ENV = {
  HYPERFRAMES_NO_TELEMETRY: "1",
  DO_NOT_TRACK: "1",
  HYPERFRAMES_NO_UPDATE_CHECK: "1",
  HYPERFRAMES_NO_AUTO_INSTALL: "1",
};

export class StepError extends Error {
  constructor(step, message) {
    super(message);
    this.step = step;
  }
}

/** Run a command; resolve { code, stdout, stderr }. Output is echoed unless quiet. */
// The voice key and the job's OIDC request token never reach these tools.
const WITHHELD = ["ELEVENLABS_API_KEY", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL"];

export function childEnv(extra = {}) {
  const env = { ...process.env, ...QUIET_ENV, ...extra };
  for (const k of WITHHELD) delete env[k];
  return env;
}

function exec(cmd, args, { quiet = false, cwd = ROOT, env = {}, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: childEnv(env) });
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, timeoutMs)
      : null;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
      if (!quiet) process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      if (!quiet) process.stderr.write(d);
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: timedOut ? "timeout" : code, stdout, stderr });
    });
  });
}

const hf = (args, opts) => exec("npx", ["--no-install", "hyperframes", ...args], opts);

/** The CLI on the host must be the pinned one (npm ci installs it). */
export async function checkCli() {
  const r = await hf(["--version"], { quiet: true });
  const got = (r.stdout + r.stderr).match(/\d+\.\d+\.\d+/)?.[0];
  if (r.code !== 0 || got !== HF_VERSION) {
    throw new StepError("setup", `hyperframes CLI ${got || "missing"}, expected ${HF_VERSION}`);
  }
  return got;
}

/**
 * Captions: write our VTT into the project and import it with
 * `hyperframes transcribe <file.vtt>` (a format import: each cue becomes one
 * timed entry; no speech model runs). Returns the transcript entries.
 */
export async function importCaptions(projectDir, cues) {
  const vtt = path.join(projectDir, "captions.vtt");
  await writeFile(vtt, toVtt(cues));
  const r = await hf(["transcribe", vtt, "--dir", projectDir, "--json"], { quiet: true });
  if (r.code !== 0) throw new StepError("captions", `transcribe --import exited ${r.code}: ${tail(r.stderr || r.stdout)}`);
  let file = path.join(projectDir, "transcript.json");
  try {
    const out = JSON.parse(r.stdout.trim().split("\n").pop());
    if (out.transcriptPath) file = out.transcriptPath;
  } catch {
    // fall back to the default path
  }
  const entries = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(entries) || entries.length !== cues.length) {
    throw new StepError("captions", `imported ${entries?.length ?? 0} captions, expected ${cues.length}`);
  }
  return entries;
}

/** `hyperframes lint`: errors stop the render; warnings are logged. */
export async function lint(projectDir) {
  const r = await hf(["lint", projectDir, "--json"], { quiet: true });
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    throw new StepError("lint", `lint gave no report (exit ${r.code}): ${tail(r.stderr)}`);
  }
  const errors = (report.findings ?? []).filter((f) => f.severity === "error");
  if (!report.ok || report.errorCount > 0 || errors.length) {
    const what = errors.slice(0, 5).map((f) => `${f.code}: ${f.message}`).join(" | ");
    throw new StepError("lint", `${report.errorCount ?? errors.length} lint error(s): ${what}`);
  }
  return { warnings: report.warningCount ?? 0, codes: [...new Set((report.findings ?? []).map((f) => f.code))] };
}

/** Build the pinned render image once per runner (cached locally after). */
export async function ensureImage({ log = console.log } = {}) {
  const have = await exec("docker", ["image", "inspect", IMAGE_TAG], { quiet: true });
  if (have.code === 0) return { built: false };
  log(`building ${IMAGE_TAG} from hyperframes/Dockerfile.render`);
  const r = await exec("docker", [
    "build", "--platform", "linux/amd64",
    "--build-arg", `HYPERFRAMES_VERSION=${HF_VERSION}`,
    "--build-arg", "TARGETARCH=amd64",
    "-t", IMAGE_TAG, "-f", DOCKERFILE, path.dirname(DOCKERFILE),
  ], { quiet: true, timeoutMs: 20 * 60_000 });
  if (r.code !== 0) throw new StepError("image", `docker build exited ${r.code}: ${tail(r.stderr || r.stdout)}`);
  return { built: true };
}

/**
 * The container `hyperframes render --docker` runs (same image, same
 * arguments), with --network none and the quiet env. 1080p30, quality
 * "looks" (the CLI default), software GL (the --docker default).
 */
export function dockerRunArgs({ projectDir, outFile, workers, quality = "looks", fps = 30 }) {
  const quietEnv = Object.entries(QUIET_ENV).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  return [
    "run", "--rm", "--network", "none", "--platform", "linux/amd64", "--shm-size=2g",
    ...quietEnv,
    "-v", `${path.resolve(projectDir)}:/project:ro`,
    "-v", `${path.resolve(path.dirname(outFile))}:/output`,
    IMAGE_TAG, "/project",
    "--output", `/output/${path.basename(outFile)}`,
    "--fps", String(fps), "--quality", quality, "--format", "mp4",
    ...(workers ? ["--workers", String(workers)] : []),
    "--no-browser-gpu", "--strict",
  ];
}

export async function renderDocker({ projectDir, outFile, workers, timeoutMs = 30 * 60_000 }) {
  await mkdir(path.dirname(outFile), { recursive: true });
  const name = `fs-render-${process.pid}-${Date.now()}`;
  const args = dockerRunArgs({ projectDir, outFile, workers });
  args.splice(1, 0, "--name", name);
  const r = await exec("docker", args, { timeoutMs });
  if (r.code === "timeout") await exec("docker", ["rm", "-f", name], { quiet: true });
  if (r.code !== 0) throw new StepError("render", `hyperframes render exited ${r.code}: ${tail(r.stderr)}`);
  const size = (await stat(outFile).catch(() => null))?.size ?? 0;
  if (!size) throw new StepError("render", "hyperframes render wrote no video");
  return { bytes: size };
}

/** One JPEG frame at `seconds` (scale 1 = 1920 wide). */
export async function frameAt(mp4, seconds, outFile, { scale = 1, quality = 3 } = {}) {
  const vf = scale === 1 ? [] : ["-vf", `scale=${Math.round(1920 * scale)}:-2`];
  const r = await exec("ffmpeg", [
    "-y", "-loglevel", "error", "-ss", Math.max(0, seconds).toFixed(3), "-i", mp4,
    "-frames:v", "1", ...vf, "-q:v", String(quality), outFile,
  ], { quiet: true });
  if (r.code !== 0) throw new StepError("frames", `ffmpeg frame ${seconds}s: ${tail(r.stderr)}`);
}

function tail(text) {
  return String(text || "").trim().split("\n").slice(-6).join(" / ").slice(0, 600);
}

/** Seconds of media in a file (ffprobe), or 0 when it cannot tell. */
export async function probeSeconds(file) {
  const r = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { quiet: true });
  return Number.parseFloat(r.stdout) || 0;
}

/** Poster and review stills: the same moments the Remotion path picks. */
export function stillTimes(timeline) {
  const fps = timeline.fps;
  const mid = (frame) => (frame + 0.5) / fps;
  const at = (sc, s) => sc.from + Math.min(sc.durationInFrames - 1, Math.round(fps * s));
  const openSc = timeline.scenes[0];
  const cardSc =
    timeline.scenes.find((s) => s.kind === "decisions" || s.kind === "agenda") ||
    timeline.scenes[Math.min(1, timeline.scenes.length - 1)];
  const closeSc = timeline.scenes[timeline.scenes.length - 1];
  return {
    poster: mid(Math.min(openSc.durationInFrames - 1, Math.round(fps * 1.5))),
    stills: [
      ["still-open.jpg", mid(at(openSc, 3.2))],
      ["still-card.jpg", mid(cardSc.from + Math.floor(cardSc.durationInFrames * 0.8))],
      ["still-close.jpg", mid(at(closeSc, 3.0))],
    ],
  };
}

/**
 * The whole HyperFrames path. Writes outDir/video.mp4, poster.jpg and the
 * stills only when every step passed (the video goes to a temporary name
 * first), so a failure leaves outDir as it was for the Remotion fallback.
 * `publicDir` holds the voice clips (scene.audio = "audio/03.mp3").
 */
export async function renderWithHyperframes({ script, timeline, outDir, publicDir, log = console.log, workers }) {
  const { writeProject } = await import("../hyperframes/generate.mjs");
  const projectDir = path.join(outDir, "hf");
  const tmpVideo = path.join(outDir, "hf-render", "video.mp4");
  const t0 = Date.now();
  const lap = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  await checkCli();
  await rm(projectDir, { recursive: true, force: true });
  await rm(path.dirname(tmpVideo), { recursive: true, force: true });
  await mkdir(projectDir, { recursive: true });
  let transcript;
  try {
    transcript = await importCaptions(projectDir, timeline.cues);
  } catch (err) {
    throw err instanceof StepError ? err : new StepError("captions", err.message);
  }
  let project;
  try {
    project = await writeProject({ script, timeline, outDir: projectDir, audioRoot: publicDir, transcript, clean: false });
  } catch (err) {
    throw new StepError("generate", err.message);
  }
  log(`hyperframes ${HF_VERSION}: project written (${project.duration.toFixed(1)}s, ${project.captionGroups} caption groups) at ${lap()}`);
  const linted = await lint(projectDir);
  log(`hyperframes lint: 0 errors, ${linted.warnings} warnings (${linted.codes.join(", ") || "none"}) at ${lap()}`);
  const image = await ensureImage({ log });
  log(`hyperframes image ${IMAGE_TAG} ${image.built ? "built" : "cached"} at ${lap()}`);
  const rendered = await renderDocker({ projectDir, outFile: tmpVideo, workers });
  const got = await probeSeconds(tmpVideo);
  if (Math.abs(got - timeline.durationS) > 0.5) {
    throw new StepError("render", `video is ${got.toFixed(2)}s, the timeline says ${timeline.durationS.toFixed(2)}s`);
  }
  log(`hyperframes render ${got.toFixed(1)}s video, ${(rendered.bytes / 1e6).toFixed(1)} MB at ${lap()}`);
  const times = stillTimes(timeline);
  const posterTmp = path.join(path.dirname(tmpVideo), "poster.jpg");
  await frameAt(tmpVideo, times.poster, posterTmp, { scale: 1, quality: 3 });
  const stills = [];
  for (const [name, t] of times.stills) {
    try {
      await frameAt(tmpVideo, t, path.join(path.dirname(tmpVideo), name), { scale: 0.5, quality: 4 });
      stills.push(name);
    } catch (err) {
      log(`still ${name} skipped: ${err.message}`);
    }
  }
  await rename(tmpVideo, path.join(outDir, "video.mp4"));
  await rename(posterTmp, path.join(outDir, "poster.jpg"));
  for (const name of stills) await rename(path.join(path.dirname(tmpVideo), name), path.join(outDir, name));
  return { seconds: (Date.now() - t0) / 1000, bytes: rendered.bytes, stills, lintWarnings: linted.warnings };
}
