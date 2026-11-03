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
 * Where each of a v3 scene's lines falls in its voice: [[startS, endS], ...]
 * from the voice's start. The scene's voice is its lines joined by one space;
 * each line's share of the characters maps onto the alignment (the voice may
 * carry inline IPA, so it is mapped by proportion, not by character).
 */
export function lineWindows(lines, alignment, voiceS) {
  const voices = lines.map((l) => String(l.voice ?? ""));
  const total = voices.reduce((n, t) => n + t.length, 0) + Math.max(0, voices.length - 1);
  const starts = alignment?.character_start_times_seconds ?? [];
  const m = starts.length;
  let offset = 0;
  const at = voices.map((t) => {
    const o = offset;
    offset += t.length + 1;
    if (!m || !total) return (o / Math.max(1, total)) * voiceS;
    return starts[Math.min(m - 1, Math.round((o / total) * m))] ?? 0;
  });
  return at.map((a, k) => [k === 0 ? 0 : a, k + 1 < at.length ? at[k + 1] : voiceS]);
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
    // v3 scenes carry their own hold (lib/v3.mjs); v2 scenes have none.
    const hold = scene.kind === "title" ? TITLE_HOLD_S : Number(scene.hold_s) || 0;
    const startS = frame / fps;
    // The audio file's own length when the render measured it (loudnorm and
    // the mp3 encoder can pad a few milliseconds): the scene never cuts the voice.
    const voiceS = Math.max(voiceSeconds(v.alignment), Number(v.audioSeconds) || 0);
    // A v3 clip scene lasts at least its footage (`min_s`).
    const durS = Math.max(LEAD_S + voiceS + TAIL_S + hold, Number(scene.min_s) || 0);
    const durationInFrames = Math.max(Math.ceil(durS * fps), fps);
    const voiceStart = startS + LEAD_S;
    let lineTimes;
    if (Array.isArray(scene.lines)) {
      // v3: each line's own cap over the part of the voice that reads it.
      flushWords();
      lineTimes = lineWindows(scene.lines, v.alignment, voiceS);
      scene.lines.forEach((l, k) => {
        const [a, b] = lineTimes[k];
        cues.push(...cuesFromCaption(l.cap, voiceStart + a, voiceStart + Math.max(b, a + 0.3)));
      });
      // The clip's own captions, verbatim from the recording.
      for (const c of scene.clip?.captions ?? []) {
        if (!(c.end > c.start) || c.start >= durS) continue;
        cues.push({ text: c.text, start: startS + c.start, end: startS + Math.min(c.end, durS) });
      }
    } else if (scene.cap) {
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
      ...(lineTimes
        ? { lineFrames: lineTimes.map(([a, b]) => [Math.round((LEAD_S + a) * fps), Math.round((LEAD_S + b) * fps)]) }
        : {}),
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
