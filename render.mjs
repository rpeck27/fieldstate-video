// Render the weekly state video.
//
//   1. script   fetch the script from the conductor (or SCRIPT_FILE locally)
//   2. voice    one ElevenLabs call per scene, with character timings
//   3. render   Remotion: MP4 (H.264), a poster frame (JPEG), captions (VTT)
//   4. upload   the three files back through the conductor, then "done"
//
// Environment (the workflow sets these):
//   CONDUCTOR_URL        the conductor's origin
//   RENDER_ID            from the dispatch; blank = the newest waiting render
//   ELEVENLABS_API_KEY   repository secret (never printed)
//   ELEVENLABS_VOICE_ID  optional repository variable
//   ELEVENLABS_MODEL_ID  optional repository variable
// Local runs: SCRIPT_FILE=path NO_VOICE=1 NO_UPLOAD=1 node render.mjs
import { spawn } from "node:child_process";
import { mkdir, rm, stat, writeFile, readFile } from "node:fs/promises";
import { cpus } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { estimatedAlignment, toVtt } from "./lib/captions.mjs";
import { fetchScript, reportDone, reportFailed, uploadFile } from "./lib/conductor.mjs";
import { buildTimeline } from "./lib/timeline.mjs";
import { DEFAULT_MODEL, DEFAULT_VOICE, synthesize } from "./lib/voice.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "out");
const AUDIO = path.join(ROOT, "public", "audio");
const env = process.env;
const base = env.CONDUCTOR_URL || "";
let renderId = (env.RENDER_ID || "").trim();
let step = "script";
const t0 = Date.now();

function log(line) {
  console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s] ${line}`);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args[0]} exited ${code}`))));
    child.on("error", reject);
  });
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await rm(AUDIO, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await mkdir(AUDIO, { recursive: true });

  // 1. script
  let script;
  if (env.SCRIPT_FILE) {
    script = JSON.parse(await readFile(env.SCRIPT_FILE, "utf8"));
  } else {
    const got = await fetchScript(base, renderId);
    renderId = got.render_id;
    script = got.script;
  }
  if (!script?.scenes?.length) throw new Error("script has no scenes");
  log(`script ${script.state} week_of=${script.week_of} scenes=${script.scenes.length} render=${renderId || "local"}`);

  // 2. voice
  step = "voice";
  const voiceId = env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  const modelId = env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL;
  const noVoice = env.NO_VOICE === "1";
  const voiced = [];
  let chars = 0;
  for (let i = 0; i < script.scenes.length; i++) {
    const scene = script.scenes[i];
    if (noVoice) {
      voiced.push({ id: scene.id, audio: null, alignment: estimatedAlignment(scene.voice, scene.voice.length / 15) });
      continue;
    }
    const out = await synthesize({
      text: scene.voice,
      previousText: script.scenes[i - 1]?.voice ?? "",
      nextText: script.scenes[i + 1]?.voice ?? "",
      apiKey: env.ELEVENLABS_API_KEY,
      voiceId,
      modelId,
    });
    const name = `audio/${String(i).padStart(2, "0")}.mp3`;
    await writeFile(path.join(ROOT, "public", name), out.audio);
    voiced.push({ id: scene.id, audio: name, alignment: out.alignment });
    chars += scene.voice.length;
  }
  log(`voice ${noVoice ? "skipped (NO_VOICE)" : `${chars} characters, model ${modelId}`}`);

  // 3. render
  step = "render";
  const timeline = buildTimeline(script, voiced);
  const props = { script: { ...script, scenes: undefined }, ...timeline };
  const propsFile = path.join(OUT, "props.json");
  await writeFile(propsFile, JSON.stringify(props));
  await writeFile(path.join(OUT, "captions.vtt"), toVtt(timeline.cues));
  const concurrency = String(Math.max(1, cpus().length));
  // Local debugging only (e.g. "--ignore-certificate-errors" behind a proxy).
  const extra = (env.REMOTION_EXTRA_FLAGS || "").split(" ").filter(Boolean);
  await run("npx", [
    "remotion", "render", "src/index.ts", "WeeklyVideo", path.join(OUT, "video.mp4"),
    `--props=${propsFile}`, "--codec=h264", "--crf=26", "--audio-bitrate=128k",
    `--concurrency=${concurrency}`, "--log=info", ...extra,
  ]);
  const posterFrame = Math.min(timeline.scenes[0].durationInFrames - 1, Math.round(timeline.fps * 1.5));
  await run("npx", [
    "remotion", "still", "src/index.ts", "WeeklyVideo", path.join(OUT, "poster.jpg"),
    `--props=${propsFile}`, `--frame=${posterFrame}`, "--image-format=jpeg", "--jpeg-quality=85", ...extra,
  ]);
  const mp4Bytes = (await stat(path.join(OUT, "video.mp4"))).size;
  log(`render ${timeline.durationS.toFixed(1)}s video, ${(mp4Bytes / 1e6).toFixed(1)} MB, concurrency ${concurrency}`);

  // 4. upload
  if (env.NO_UPLOAD === "1") {
    log("upload skipped (NO_UPLOAD)");
    return;
  }
  step = "upload";
  await uploadFile(base, renderId, "video.mp4", path.join(OUT, "video.mp4"), "video/mp4");
  await uploadFile(base, renderId, "poster.jpg", path.join(OUT, "poster.jpg"), "image/jpeg");
  await uploadFile(base, renderId, "captions.vtt", path.join(OUT, "captions.vtt"), "text/vtt");
  step = "done";
  await reportDone(base, renderId, {
    duration_s: Number(timeline.durationS.toFixed(2)),
    voice_chars: chars,
    voice_model: modelId,
    render_seconds: Math.round((Date.now() - t0) / 1000),
  });
  log("done: review links are in #ops");
}

main().catch(async (err) => {
  console.error(`failed at ${step}: ${err.message}`);
  if (base && env.NO_UPLOAD !== "1" && !env.SCRIPT_FILE) {
    try {
      await reportFailed(base, renderId, step);
    } catch (e) {
      console.error(`could not report the failure: ${e.message}`);
    }
  }
  process.exit(1);
});
