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
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { estimatedAlignment, toVtt } from "./lib/captions.mjs";
import { fetchScript, reportDone, reportFailed, uploadFile } from "./lib/conductor.mjs";
import { buildTimeline } from "./lib/timeline.mjs";
import {
  DEFAULT_MODEL,
  LOUDNORM,
  VOICE_CANDIDATES,
  defaultCandidate,
  ensurePronunciationDictionary,
  resolveVoiceByName,
  synthesize,
} from "./lib/voice.mjs";

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

/** Seconds of audio in a file (ffprobe), or 0 when it cannot tell. */
function probeSeconds(file) {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    child.stdout.on("data", (d) => (out += d));
    child.on("exit", () => resolve(Number.parseFloat(out) || 0));
    child.on("error", () => resolve(0));
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
  const candidate = defaultCandidate();
  const modelId = env.ELEVENLABS_MODEL_ID || candidate.modelId || DEFAULT_MODEL;
  const noVoice = env.NO_VOICE === "1";
  let voiceId = env.ELEVENLABS_VOICE_ID || candidate.voiceId || "";
  let locators;
  if (!noVoice) {
    if (!voiceId) {
      const found = await resolveVoiceByName({ name: candidate.name, apiKey: env.ELEVENLABS_API_KEY });
      if (!found?.voiceId) {
        throw new Error(`voice "${candidate.name}" was not found (${(found?.reasons || []).join("; ")}); set ELEVENLABS_VOICE_ID`);
      }
      voiceId = found.voiceId;
      log(`voice ${found.name} on ${modelId}`);
    } else {
      log(`voice ${env.ELEVENLABS_VOICE_ID ? "id from the environment" : candidate.name} on ${modelId}, settings ${JSON.stringify(candidate.settings)}`);
    }
    if (/^eleven_v[34]/.test(modelId)) {
      log("pronunciation: inline IPA for NC place names (eleven_v3/v4)");
    } else {
      try {
        locators = await ensurePronunciationDictionary({ apiKey: env.ELEVENLABS_API_KEY });
        log(locators ? "pronunciation dictionary ready" : "pronunciation dictionary not created");
      } catch (err) {
        log(`pronunciation dictionary skipped: ${err.message}`);
      }
    }
  }
  // Voice samples for Russell (Oct 17): the first two lines of this script
  // in each candidate voice, posted with the review links. This render uses
  // the default (or ELEVENLABS_VOICE) whatever the samples say; a pick
  // applies from the next render. VOICE_SAMPLES=0 skips them.
  const samples = [];
  let sampleChars = 0;
  if (!noVoice && env.VOICE_SAMPLES !== "0") {
    const text = script.scenes.slice(0, 2).map((s) => s.voice).join(" ").slice(0, 420);
    for (const c of VOICE_CANDIDATES) {
      try {
        const out = await synthesize({
          text, apiKey: env.ELEVENLABS_API_KEY, voiceId: c.voiceId, modelId: c.modelId,
          voiceSettings: c.settings, retries: 1,
        });
        const raw = path.join(OUT, `voice-${c.key}.raw.mp3`);
        const mp3 = path.join(OUT, `voice-${c.key}.mp3`);
        await writeFile(raw, out.audio);
        await run("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-af", LOUDNORM, "-ar", "44100", "-b:a", "128k", mp3]);
        await rm(raw, { force: true });
        samples.push(`voice-${c.key}.mp3`);
        sampleChars += text.length;
      } catch (err) {
        log(`voice sample ${c.name} skipped: ${err.message}`);
      }
    }
    log(`voice samples ${samples.length}/${VOICE_CANDIDATES.length}, ${sampleChars} characters`);
  }

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
      voiceSettings: candidate.settings,
      pronunciationDictionaryLocators: locators || undefined,
    });
    const name = `audio/${String(i).padStart(2, "0")}.mp3`;
    const file = path.join(ROOT, "public", name);
    await writeFile(file, out.audio);
    const normalized = `${file}.norm.mp3`;
    await run("ffmpeg", ["-y", "-i", file, "-af", LOUDNORM, "-ar", "44100", "-b:a", "128k", normalized]);
    await rename(normalized, file);
    voiced.push({ id: scene.id, audio: name, alignment: out.alignment, audioSeconds: await probeSeconds(file) });
    chars += scene.voice.length;
  }
  log(`voice ${noVoice ? "skipped (NO_VOICE)" : `${chars} characters, model ${modelId}, ${LOUDNORM}`}`);

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
  // Three stills for the approval message: opening map, a case card, close.
  const stills = [];
  const at = (sc, s) => sc.from + Math.min(sc.durationInFrames - 1, Math.round(timeline.fps * s));
  const openSc = timeline.scenes[0];
  const cardSc = timeline.scenes.find((s) => s.kind === "decisions" || s.kind === "agenda") || timeline.scenes[Math.min(1, timeline.scenes.length - 1)];
  const closeSc = timeline.scenes[timeline.scenes.length - 1];
  for (const [name, frame] of [
    ["still-open.jpg", at(openSc, 3.2)],
    ["still-card.jpg", cardSc.from + Math.floor(cardSc.durationInFrames * 0.8)],
    ["still-close.jpg", at(closeSc, 3.0)],
  ]) {
    try {
      await run("npx", [
        "remotion", "still", "src/index.ts", "WeeklyVideo", path.join(OUT, name),
        `--props=${propsFile}`, `--frame=${frame}`, "--image-format=jpeg", "--jpeg-quality=80", "--scale=0.5", ...extra,
      ]);
      stills.push(name);
    } catch (err) {
      log(`still ${name} skipped: ${err.message}`);
    }
  }
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
  // Review-only files: best effort, never fail the render over them.
  for (const [name, type] of [...stills.map((n) => [n, "image/jpeg"]), ...samples.map((n) => [n, "audio/mpeg"])]) {
    try {
      await uploadFile(base, renderId, name, path.join(OUT, name), type);
    } catch (err) {
      log(`upload ${name} skipped: ${err.message}`);
    }
  }
  step = "done";
  await reportDone(base, renderId, {
    duration_s: Number(timeline.durationS.toFixed(2)),
    voice_chars: chars + sampleChars,
    voice_model: modelId,
    voice_name: env.ELEVENLABS_VOICE_ID ? "voice id from the environment" : candidate.name,
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
