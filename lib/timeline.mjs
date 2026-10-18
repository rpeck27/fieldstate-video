// Scene timing: each scene lasts as long as its voice, plus a short lead and
// tail. Pure; tested in test/timeline.test.mjs.
import { cuesFromCaption, cuesFromWords, wordsFromAlignment } from "./captions.mjs";

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
  const cues = [];
  const pendingWords = [];
  const flushWords = () => {
    if (pendingWords.length) cues.push(...cuesFromWords(pendingWords.splice(0)));
  };
  script.scenes.forEach((scene, i) => {
    const v = voiced[i];
    if (!v || v.id !== scene.id) throw new Error(`voice/scene mismatch at ${i}`);
    const hold = scene.kind === "title" ? TITLE_HOLD_S : 0;
    const startS = frame / fps;
    // The audio file's own length when the render measured it (loudnorm and
    // the mp3 encoder can pad a few milliseconds): the scene never cuts the voice.
    const voiceS = Math.max(voiceSeconds(v.alignment), Number(v.audioSeconds) || 0);
    const durS = LEAD_S + voiceS + TAIL_S + hold;
    const durationInFrames = Math.max(Math.ceil(durS * fps), fps);
    const voiceStart = startS + LEAD_S;
    if (scene.cap) {
      flushWords();
      cues.push(...cuesFromCaption(scene.cap, voiceStart, voiceStart + Math.max(voiceS, 0.3)));
    } else {
      pendingWords.push(...wordsFromAlignment(v.alignment, voiceStart));
    }
    scenes.push({
      ...scene,
      from: frame,
      durationInFrames,
      audio: v.audio,
      audioFrom: Math.round(LEAD_S * fps),
    });
    frame += durationInFrames;
  });
  flushWords();
  return {
    fps,
    totalFrames: frame,
    durationS: frame / fps,
    scenes,
    cues,
  };
}
