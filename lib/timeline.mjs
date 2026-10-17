// Scene timing: each scene lasts as long as its voice, plus a short lead and
// tail. Pure; tested in test/timeline.test.mjs.
import { cuesFromWords, wordsFromAlignment } from "./captions.mjs";

export const FPS = 30;
export const LEAD_S = 0.3;
export const TAIL_S = 0.7;
export const TITLE_HOLD_S = 1.2;

/** Seconds a scene's voice runs: the last character's end time. */
export function voiceSeconds(alignment) {
  const ends = alignment?.character_end_times_seconds ?? [];
  return ends.length ? Math.max(...ends) : 0;
}

/**
 * script: the engine's script JSON. voiced: one entry per scene, in order:
 * { id, audio: "audio/03.mp3" | null, alignment }.
 */
export function buildTimeline(script, voiced, { fps = FPS } = {}) {
  let frame = 0;
  const scenes = [];
  const words = [];
  script.scenes.forEach((scene, i) => {
    const v = voiced[i];
    if (!v || v.id !== scene.id) throw new Error(`voice/scene mismatch at ${i}`);
    const hold = scene.kind === "title" ? TITLE_HOLD_S : 0;
    const startS = frame / fps;
    const voiceS = voiceSeconds(v.alignment);
    const durS = LEAD_S + voiceS + TAIL_S + hold;
    const durationInFrames = Math.max(Math.ceil(durS * fps), fps);
    words.push(...wordsFromAlignment(v.alignment, startS + LEAD_S));
    scenes.push({
      ...scene,
      from: frame,
      durationInFrames,
      audio: v.audio,
      audioFrom: Math.round(LEAD_S * fps),
    });
    frame += durationInFrames;
  });
  const cues = cuesFromWords(words);
  return {
    fps,
    totalFrames: frame,
    durationS: frame / fps,
    scenes,
    cues,
  };
}
