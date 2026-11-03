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

// A word that ends with an abbreviation's period is not the end of a
// sentence: "Rd.", "St.", "No.", "p.", a single initial. Never break a cue
// after it (surface review of the v3 renders, fieldstate-site #172, Oct 30).
const ABBREVIATION = /(?:^|[\s(])(?:Rd|St|Ave|Blvd|Dr|Ln|Ct|Pkwy|Hwy|Mt|Ft|No|Nos|Mr|Mrs|Ms|Jr|Sr|Inc|Co|Corp|Ltd|Dept|Est|vs|etc|approx|p|pp|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|[A-Z])\.["”]?$/;

/** True when `word` ends a sentence or clause a cue may break after. */
export function breaksAfter(word, clause = false) {
  const w = String(word ?? "");
  if (ABBREVIATION.test(w)) return false;
  return (clause ? /[.;:!?]["”]?$/ : /[.!?]["”]?$/).test(w);
}

/** Orphan cues: fewer than `minWords` words, or shorter than `minS` seconds. */
export const ORPHAN = { minWords: 3, minS: 1.2 };

/**
 * Merge every orphan cue ("Rd.", "hold.", "approved.") into the cue before
 * it. Pure; `cues` is not changed. The first cue has nothing before it and
 * is kept as it is.
 */
export function mergeOrphans(cues, { minWords = ORPHAN.minWords, minS = ORPHAN.minS } = {}) {
  const orphan = (c) => c.text.split(/\s+/).filter(Boolean).length < minWords || c.end - c.start < minS;
  const out = [];
  for (const c of cues) {
    const prev = out[out.length - 1];
    if (prev && orphan(c)) {
      out[out.length - 1] = { start: prev.start, end: Math.max(prev.end, c.end), text: `${prev.text} ${c.text}` };
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

/** The last word in `words` that ends a clause ("hold,", "2024:"), or -1. */
function lastClauseEnd(words) {
  for (let i = words.length - 1; i >= 0; i--) if (/[,;:]["”]?$/.test(words[i])) return i;
  return -1;
}

/**
 * Caption cues from the script's digit-keeping `cap` line, spread evenly
 * across the voice. The spoken track spells numbers; the caption keeps them.
 *
 * `clauses` (v3 lines only, lib/timeline.mjs): when a cue runs past
 * `maxChars`, it breaks after the cue's last comma, semicolon or colon
 * instead of mid-clause ("The last divided vote, on the votes we" / "hold,
 * was in ..." becomes "The last divided vote," / "on the votes we hold," /
 * "was in ..."), when that leaves at least three words before the break.
 * Off by default, so every v2 cue is what it was.
 */
export function cuesFromCaption(cap, startS, endS, { maxChars = 42, clauses = false } = {}) {
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
    if (cur.length && next.length > maxChars) {
      const k = clauses ? lastClauseEnd(cur) : -1;
      if (k >= 2 && k < cur.length - 1) {
        chunks.push(cur.slice(0, k + 1).join(" "));
        cur = cur.slice(k + 1);
        if (`${cur.join(" ")} ${w}`.length > maxChars) flush();
      } else {
        flush();
      }
    }
    cur.push(w);
    if (breaksAfter(w)) flush();
  }
  flush();
  const slice = (endS - startS) / chunks.length;
  return mergeOrphans(chunks.map((text, i) => ({
    text,
    start: startS + i * slice,
    end: startS + (i + 1) * slice,
  })));
}

/**
 * Group words into caption cues: at most `maxChars` characters and
 * `maxDurS` seconds each, breaking after sentence or clause punctuation but
 * never after an abbreviation's period; orphans are merged (`mergeOrphans`).
 */
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
    if (breaksAfter(w.text, true)) flush();
  }
  flush();
  return mergeOrphans(cues);
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
