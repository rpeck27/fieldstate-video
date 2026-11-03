// The v3 render (weekly video v3, fieldstate-site #172): clip media, voice,
// timeline and HyperFrames, for a script that templateFor() says is v3.
// Called from render.mjs inside a try: any throw (with `.step`) sends the
// run back to the v2 render, exactly as before.
//
// v3 renders with HyperFrames only. The Remotion composition has no v3
// scenes, so there is no Remotion fallback for v3; the fallback is v2.
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { estimatedAlignment, toVtt } from "./captions.mjs";
import { fetchClip } from "./clip.mjs";
import { buildTimeline } from "./timeline.mjs";
import { v3Block, v3RenderScript } from "./v3.mjs";

function stepError(step, err) {
  if (err && typeof err === "object" && !err.step && err.cap !== "elevenlabs") err.step = step;
  return err;
}

/**
 * One ElevenLabs call per voiced scene, with its neighbours as context. A
 * silent scene (the segment card, the clip's footage) gets no clip.
 * `synth(text, prev, next)` returns {audio, alignment}.
 */
export async function voiceV3Scenes(scenes, { noVoice, synth, normalize, probeSeconds, publicDir }) {
  const voiced = [];
  let chars = 0;
  const spoken = (i) => scenes[i]?.voice ?? "";
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (scene.silent || !scene.voice) {
      voiced.push({ id: scene.id, audio: null, alignment: null });
      continue;
    }
    if (noVoice) {
      voiced.push({ id: scene.id, audio: null, alignment: estimatedAlignment(scene.voice, scene.voice.length / 15) });
      continue;
    }
    const out = await synth(scene.voice, spoken(i - 1), spoken(i + 1));
    const name = `audio/${String(i).padStart(2, "0")}.mp3`;
    const file = path.join(publicDir, name);
    await writeFile(file, out.audio);
    const normalized = `${file}.norm.mp3`;
    await normalize(file, normalized);
    await rename(normalized, file);
    voiced.push({ id: scene.id, audio: name, alignment: out.alignment, audioSeconds: await probeSeconds(file) });
    chars += scene.voice.length;
  }
  return { voiced, chars };
}

export async function renderV3({ script, env, log, root, out, noVoice, synth, normalize, probeSeconds, workers, onStep = () => {} }) {
  const publicDir = path.join(root, "public");
  onStep("v3-script");
  let clipFile = null;
  await rm(path.join(publicDir, "clips"), { recursive: true, force: true });
  const clip = v3Block(script)?.lead?.clip;
  if (clip) {
    try {
      clipFile = await fetchClip(clip, { publicDir, log, env });
    } catch (err) {
      log(`clip: ${err.message}; skipped`);
    }
  }
  let v3script;
  try {
    v3script = v3RenderScript(script, { log, clipFile });
  } catch (err) {
    throw stepError("v3-script", err);
  }
  log(`template v3: ${v3script.scenes.map((s) => s.kind).join(", ")}`);
  onStep("voice");
  let v;
  try {
    v = await voiceV3Scenes(v3script.scenes, { noVoice, synth, normalize, probeSeconds, publicDir });
  } catch (err) {
    throw stepError("v3-voice", err);
  }
  log(`voice v3 ${noVoice ? "skipped (NO_VOICE)" : `${v.chars} characters`}`);
  onStep("render");
  const timeline = buildTimeline(v3script, v.voiced);
  await writeFile(path.join(out, "captions.vtt"), toVtt(timeline.cues));
  const { renderWithHyperframes } = await import("./hyperframes.mjs");
  const hfOut = await renderWithHyperframes({ script: v3script, timeline, outDir: out, publicDir, log, workers });
  return { timeline, stills: hfOut.stills, chars: v.chars, scenes: v3script.scenes.length };
}
