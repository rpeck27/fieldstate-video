// Weekly video v3: the "why" spine and the segment wheel (fieldstate-site #172).
//
// The engine's script carries v3 as `script.v3` (fieldstate.weekly_video.v3,
// sie-engine sie/serve/weekly_video_v3.py; field table in docs/feeds/README.md
// under "Videos"). This module turns that block into scenes the voice, the
// timeline and the HyperFrames template already understand
// ({id, kind, voice, cap, lines, screen}), so the rest of the render is the
// same code as v2.
//
// The engine writes every spoken line ({cap, voice}, already through its
// gate) and every on-screen string. This module only places them: it never
// rewords, joins into new sentences or composes text. A scene's voice is its
// lines read in order; its captions are each line's own cap.
//
// The spine, in order:
//   open      the number of the week (cold_open)
//   clip      the motion and the vote from the meeting video (lead.clip);
//             only when the clip's media was fetched before the render
//   decided   what happened: case card, roll call, outcome stamp (lead.what);
//             with no page on record, the no-reason line sits under the stamp
//   matters   why it matters: the counter and the dated vote strip
//   ident +   why it was decided: the From the record page (lead.why_decided);
//   record    skipped when lead.no_reason says so
//   next      what's next (lead.next); skipped when null
//   round     the quick round: one card at a time (round_layout
//             "one_at_a_time") or the grid with the card being read lit
//             ("highlight")
//   ident +   the wheel's picks with a template: From the record (record) and
//   record/   The long road (road). A segment without a template is skipped
//   road      and logged.
//   turn      your turn (v3.your_turn), when the engine builds it
//   outro     v2's closing scene, unchanged
//
// Which template renders is decided by the script (templateFor): a script
// whose own schema is fieldstate.weekly_video.v3 renders v3; a v2 script
// renders v2 exactly as before, unless VIDEO_TEMPLATE=v3 is set (local
// review renders). Pure.

export const V3_SCHEMA = "fieldstate.weekly_video.v3";
export const V3_RENDER_SCHEMA = `${V3_SCHEMA}.render`;
export const ON_THE_VOTES_WE_HOLD = "on the votes we hold";

/** Segments the template can draw, and the scene kind each one renders as. */
export const SEGMENT_KINDS = { from_the_record: "record", long_road: "road" };

// Seconds a scene holds after its voice (lib/timeline.mjs `hold_s`), so the
// motion has room: the highlighter and the track need the most.
export const HOLD = { open: 0.8, decided: 0.9, matters: 1.0, record: 1.8, next: 0.8, round: 0.5, road: 1.2, turn: 0.8 };
/** The silent segment card: lead 0.3 s + tail 0.7 s + this = 1.6 s, as the sample. */
export const IDENT_HOLD_S = 0.6;

/**
 * "v3" or "v2" for this script. v3 only when the script says so (its own
 * schema is v3), or when VIDEO_TEMPLATE=v3 asks for it on a v2 script that
 * carries a v3 block. Anything else renders v2 as before.
 */
export function templateFor(script, env = {}) {
  if (script?.schema === V3_SCHEMA) return "v3";
  const wanted = String(env.VIDEO_TEMPLATE || "").trim().toLowerCase();
  if (wanted === "v3" && script?.v3?.schema === V3_SCHEMA) return "v3";
  return "v2";
}

/** The v3 block: `script.v3`, or the script itself when it is v3 at the top. */
export function v3Block(script) {
  if (script?.v3 && typeof script.v3 === "object") return script.v3;
  if (script?.schema === V3_SCHEMA) return script;
  return null;
}

/** Why v3 can't be rendered from this script, or null when it can. */
export function v3Problem(script) {
  const v3 = v3Block(script);
  if (!v3) return "the script has no v3 block";
  if (v3.schema !== V3_SCHEMA) return `v3 schema is ${v3.schema ?? "missing"}`;
  if (v3.error) return `the engine's v3 build failed (${String(v3.error).slice(0, 60)})`;
  if (!(script.scenes ?? []).some((s) => s.kind === "outro")) return "the script has no closing scene";
  return null;
}

// ── placing lines ───────────────────────────────────────────────────────────

/** The beat's lines, in speaking order: only complete {cap, voice} pairs. */
export function linesOf(beat) {
  return (beat?.lines ?? []).filter((l) => l && typeof l.cap === "string" && l.cap.trim() && typeof l.voice === "string" && l.voice.trim());
}

/** A scene from lines: the voice is the lines read in order. */
function scene(id, kind, lines, screen, extra = {}) {
  return {
    id,
    kind,
    voice: lines.map((l) => l.voice.trim()).join(" "),
    cap: lines.map((l) => l.cap.trim()).join(" "),
    lines: lines.map((l) => ({ cap: l.cap.trim(), voice: l.voice.trim() })),
    screen,
    ...extra,
  };
}

function silent(id, kind, screen, extra = {}) {
  return { id, kind, voice: "", cap: "", lines: [], silent: true, screen, ...extra };
}

const has = (text, needle) => String(text ?? "").toLowerCase().includes(needle);

/**
 * A streak or share claim with coverage_ok false must say "on the votes we
 * hold". The engine writes that into the line; when a line or the screen
 * lacks it, the claim is dropped (the beat is not rendered).
 */
export function coverageHonoured(beat) {
  if (!beat || beat.coverage_ok !== false) return true;
  const lines = linesOf(beat);
  if (!lines.length || !lines.some((l) => has(l.cap, ON_THE_VOTES_WE_HOLD))) return false;
  const s = beat.screen ?? {};
  return [s.hook, s.sub, s.src, ...(Array.isArray(s.label) ? s.label : [])].some((t) => has(t, ON_THE_VOTES_WE_HOLD));
}

// ── the spine ───────────────────────────────────────────────────────────────

function openScene(v3, log) {
  const co = v3.cold_open;
  const lines = linesOf(co);
  if (!co || !lines.length) {
    log("v3: cold open has no lines; the open is skipped");
    return null;
  }
  if (!coverageHonoured(co)) {
    log("v3: cold open claim does not say \"on the votes we hold\" though coverage_ok is false; claim dropped");
    return null;
  }
  return scene("v3-open", "open", lines, { ...co.screen, kind: co.kind, coverage_ok: co.coverage_ok !== false }, { hold_s: HOLD.open });
}

function clipScene(clip, log) {
  if (!clip) return null;
  if (!clip.file) {
    log("v3: lead.clip is set but its media was not fetched; the clip beat is skipped");
    return null;
  }
  const dur = Number(clip.duration);
  if (!(dur > 0)) {
    log("v3: lead.clip has no duration; the clip beat is skipped");
    return null;
  }
  return silent("v3-clip", "clip", { ...(clip.screen ?? {}) }, {
    min_s: dur,
    clip: {
      file: clip.file,
      duration: dur,
      result_at_s: Number(clip.result_at_s),
      tally: clip.screen?.stamp ?? clip.tally ?? null,
      label: clip.screen?.label ?? clip.label ?? null,
      credit: clip.screen?.credit ?? clip.credit ?? null,
      lower_third: clip.screen?.lower_third ?? null,
      outcome: clip.outcome ?? null,
      // Verbatim from the recording, already timed to the clip.
      captions: (clip.captions ?? [])
        .filter((c) => c && c.text && Number.isFinite(Number(c.start)) && Number.isFinite(Number(c.end)))
        .map((c) => ({ start: Number(c.start), end: Number(c.end), text: String(c.text) })),
    },
  });
}

function decidedScene(lead) {
  const w = lead.what;
  const lines = linesOf(w);
  if (!lines.length) return null;
  // The case kind rides along for the card's building (lib/iso.mjs).
  return scene("v3-decided", "decided", lines, { ...w.screen, case_kind: w.screen?.case_kind ?? w.kind ?? null }, { hold_s: HOLD.decided });
}

function mattersScene(lead, log) {
  const wm = lead.why_matters;
  if (!wm) return null;
  const lines = linesOf(wm);
  if (!lines.length) return null;
  if (!coverageHonoured(wm)) {
    log("v3: why_matters does not say \"on the votes we hold\" though coverage_ok is false; beat dropped");
    return null;
  }
  // The strip comes newest first; the chart reads oldest to newest.
  const strip = (wm.basis?.strip ?? [])
    .filter((v) => v && v.date)
    .slice()
    .reverse()
    .map((v) => ({ date: v.date, yes: Number(v.yes || 0), no: Number(v.no || 0), this_case: !!v.this_case }));
  return scene("v3-matters", "matters", lines, { ...wm.screen, strip, coverage_ok: wm.coverage_ok !== false }, { hold_s: HOLD.matters });
}

function identScene(title, n) {
  return silent(`v3-ident-${n}`, "ident", { title }, { hold_s: IDENT_HOLD_S });
}

function recordScene(beat, n) {
  const lines = linesOf(beat);
  const s = beat.screen ?? {};
  if (!lines.length || !s.quote) return null;
  return scene(`v3-record-${n}`, "record", lines, { ...s }, { hold_s: HOLD.record });
}

function nextScene(lead) {
  const nx = lead.next;
  if (!nx) return null;
  const lines = linesOf(nx);
  if (!lines.length || !nx.screen) return null;
  return scene("v3-next", "next", lines, { ...nx.screen }, { hold_s: HOLD.next });
}

function roundScenes(v3, log) {
  const held = new Set((v3.checks?.round_held ?? []).map((h) => h?.matter_id));
  const items = (v3.round ?? []).filter((it) => it && !held.has(it.matter_id) && linesOf(it).length && it.screen?.text);
  if (!items.length) return [];
  const open = linesOf(v3.round_open);
  const head = { kicker: v3.round_open?.screen?.kicker ?? null, src: v3.round_open?.screen?.src ?? null };
  // The engine's case kind rides along for the card's building (lib/iso.mjs);
  // without it the renderer reads the kind from the card's kind label.
  const cards = items.map((it) => ({ ...it.screen, outcome: it.outcome ?? null, case_kind: it.screen?.case_kind ?? it.case_kind ?? null }));
  // round_layout comes from the engine (fix 3); when it is missing, the same rule.
  const layout = v3.round_layout === "highlight" || v3.round_layout === "one_at_a_time"
    ? v3.round_layout
    : items.length <= 3 ? "one_at_a_time" : "highlight";
  if (layout === "one_at_a_time") {
    return items.map((it, i) =>
      scene(`v3-round-${i}`, "round", [...(i === 0 ? open : []), ...linesOf(it)], {
        ...head, layout, cards: [cards[i]], index: i, count: items.length,
        // Which line starts the card's own reading (after "Also decided this week.").
        item_lines: [i === 0 ? open.length : 0],
      }, { hold_s: HOLD.round }),
    );
  }
  const lines = [...open];
  const itemLines = [];
  for (const it of items) {
    itemLines.push(lines.length);
    lines.push(...linesOf(it));
  }
  log(`v3: round of ${items.length}, layout ${layout}`);
  return [scene("v3-round", "round", lines, { ...head, layout, cards, item_lines: itemLines, count: items.length }, { hold_s: HOLD.round })];
}

function roadScene(entry, n) {
  const lines = linesOf(entry);
  const s = entry.screen ?? {};
  const steps = (s.steps ?? []).filter((x) => x && x.date_label);
  if (!lines.length || steps.length < 2) return null;
  // Each station lights as its own line is read: data.steps[i].line is the
  // step's checked line; find it among the segment's lines.
  const dataSteps = entry.data?.steps ?? [];
  const stepLine = steps.map((_, i) => {
    const cap = dataSteps[i]?.line?.cap;
    const at = cap ? lines.findIndex((l) => l.cap === cap) : -1;
    return at;
  });
  // How it ended, for the lot at the last station (hyperframes/generate.mjs
  // roadLot): the case's outcome, else the deciding step's kind.
  const outcome = entry.data?.outcome ?? dataSteps.find((x) => x?.decision)?.kind ?? null;
  return scene(`v3-road-${n}`, "road", lines, { ...s, steps, step_lines: stepLine, outcome }, { hold_s: HOLD.road });
}

function turnScene(v3) {
  const t = v3.your_turn;
  if (!t) return null;
  const lines = linesOf(t);
  if (!lines.length || !t.screen) return null;
  return scene("v3-turn", "turn", lines, { ...t.screen }, { hold_s: HOLD.turn });
}

/**
 * The render script for v3: the script's header plus v3 scenes, then v2's
 * closing scene. Throws when v3 can't be rendered (render.mjs then renders
 * v2 as before). `clipFile` is the local media for lead.clip (fetched before
 * the render, see lib/clip.mjs), relative to the public folder.
 */
export function v3RenderScript(script, { log = () => {}, clipFile = null } = {}) {
  const problem = v3Problem(script);
  if (problem) throw new Error(problem);
  const v3 = v3Block(script);
  const scenes = [];
  let idents = 0;
  const open = openScene(v3, log);
  if (open) scenes.push(open);
  const lead = v3.lead;
  const leadHeld = new Set((v3.checks?.lead_held ?? []).map((h) => h?.matter_id));
  const pageCases = new Set();
  if (lead?.what && !leadHeld.has(lead.what.matter_id)) {
    const clip = clipScene(lead.clip ? { ...lead.clip, file: clipFile } : null, log);
    if (clip) scenes.push(clip);
    const dec = decidedScene(lead);
    if (dec) scenes.push(dec);
    const m = mattersScene(lead, log);
    if (m) scenes.push(m);
    // Fix 2: with no reason on record, the line is on the decided card and
    // there is no record scene at all.
    const skipRecord = !lead.why_decided || lead.no_reason?.skip_record === true;
    if (!skipRecord) {
      const rec = recordScene(lead.why_decided, scenes.length);
      if (rec) {
        scenes.push(identScene("From the record", idents++));
        scenes.push(rec);
        pageCases.add(lead.what.matter_id);
      }
    }
    const nx = nextScene(lead);
    if (nx) scenes.push(nx);
    else log("v3: no next step and no posted meeting nearby; the next beat is skipped");
  } else {
    log("v3: no lead this week");
  }
  scenes.push(...roundScenes(v3, log));
  const titles = v3.wheel?.titles ?? {};
  for (const pick of v3.wheel?.picked ?? []) {
    const kind = SEGMENT_KINDS[pick?.segment];
    if (!kind) {
      log(`v3: wheel segment ${pick?.segment ?? "?"} has no template; skipped`);
      continue;
    }
    const title = pick.screen?.ident || titles[pick.segment] || pick.segment;
    let body = null;
    if (kind === "record") {
      if (pageCases.has(pick.data?.matter_id)) {
        log(`v3: wheel From the record is the lead's own page (case ${pick.data?.matter_id}); skipped`);
        continue;
      }
      body = recordScene(pick, scenes.length + 1);
    } else if (kind === "road") {
      body = roadScene(pick, scenes.length + 1);
    }
    if (!body) {
      log(`v3: wheel segment ${pick.segment} has no lines or screen to place; skipped`);
      continue;
    }
    scenes.push(identScene(title, idents++));
    scenes.push(body);
    if (kind === "record") pageCases.add(pick.data?.matter_id);
  }
  const turn = turnScene(v3);
  if (turn) scenes.push(turn);
  else log("v3: no your_turn in the script; the beat is skipped");
  if (!scenes.some((s) => ["decided", "record", "road", "round"].includes(s.kind))) {
    throw new Error("no lead, round or wheel segment to render this week");
  }
  const outro = script.scenes.find((s) => s.kind === "outro");
  scenes.push({ ...outro });
  return {
    schema: V3_RENDER_SCHEMA,
    state: script.state,
    state_name: script.state_name,
    title: script.title,
    week_of: script.week_of,
    week_label: (script.scenes ?? []).find((s) => s.kind === "title")?.screen?.week_label ?? null,
    scenes,
  };
}
