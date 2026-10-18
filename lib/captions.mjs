// Captions from ElevenLabs character timings: words → short cues → WebVTT.
// Pure functions; tested in test/captions.test.mjs.

/**
 * Words with times from an ElevenLabs alignment
 * ({characters, character_start_times_seconds, character_end_times_seconds}).
 * `offsetS` shifts every time (the scene's start in the whole video).
 */
export function wordsFromAlignment(alignment, offsetS = 0) {
  const chars = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends = alignment?.character_end_times_seconds ?? [];
  const words = [];
  let cur = null;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (/\s/.test(c)) {
      if (cur) words.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { text: "", start: (starts[i] ?? 0) + offsetS, end: (ends[i] ?? 0) + offsetS };
    cur.text += c;
    cur.end = (ends[i] ?? cur.end - offsetS) + offsetS;
  }
  if (cur) words.push(cur);
  return words;
}

/** An even spread of `text` over `durationS`, for renders without a voice. */
export function estimatedAlignment(text, durationS) {
  const chars = [...text];
  const step = chars.length ? durationS / chars.length : 0;
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => i * step),
    character_end_times_seconds: chars.map((_, i) => (i + 1) * step),
  };
}

/**
 * Group words into caption cues: at most `maxChars` characters and
 * `maxDurS` seconds each, breaking after sentence or clause punctuation.
 */
/**
 * Caption cues from the script's digit-keeping `cap` line, spread evenly
 * across the voice. The spoken track spells numbers; the caption keeps them.
 */
export function cuesFromCaption(cap, startS, endS, { maxChars = 42 } = {}) {
  const words = String(cap ?? "").split(/\s+/).filter(Boolean);
  if (!words.length || !(endS > startS)) return [];
  const chunks = [];
  let cur = [];
  const flush = () => {
    if (cur.length) chunks.push(cur.join(" "));
    cur = [];
  };
  for (const w of words) {
    const next = cur.length ? `${cur.join(" ")} ${w}` : w;
    if (cur.length && next.length > maxChars) flush();
    cur.push(w);
    if (/[.!?]["”]?$/.test(w)) flush();
  }
  flush();
  const slice = (endS - startS) / chunks.length;
  return chunks.map((text, i) => ({
    text,
    start: startS + i * slice,
    end: startS + (i + 1) * slice,
  }));
}

export function cuesFromWords(words, { maxChars = 42, maxDurS = 4.5 } = {}) {
  const cues = [];
  let cur = null;
  const flush = () => {
    if (cur) cues.push(cur);
    cur = null;
  };
  for (const w of words) {
    if (cur) {
      const text = `${cur.text} ${w.text}`;
      if (text.length > maxChars || w.end - cur.start > maxDurS) {
        flush();
      }
    }
    if (!cur) {
      cur = { start: w.start, end: w.end, text: w.text };
    } else {
      cur.text = `${cur.text} ${w.text}`;
      cur.end = w.end;
    }
    if (/[.;:!?]["”]?$/.test(w.text)) flush();
  }
  flush();
  return cues;
}

function ts(s) {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}.${pad(rest, 3)}`;
}

export function toVtt(cues) {
  const lines = ["WEBVTT", ""];
  cues.forEach((c, i) => {
    lines.push(String(i + 1), `${ts(c.start)} --> ${ts(Math.max(c.end, c.start + 0.2))}`, c.text, "");
  });
  return lines.join("\n");
}
