// Weekly video v3: the lead story, in the "why" order.
//
// The engine's script carries v3 next to v2 as `script.v3`
// (fieldstate.weekly_video.v3, sie-engine sie/serve/weekly_video_v3.py). This
// module turns that block into scenes the voice, the timeline and the
// HyperFrames template already understand ({id, kind, voice, cap, screen}),
// so the rest of the render is the same code as v2.
//
//   open      the number of the week (cold_open)
//   decided   what happened: case card, roll call, outcome stamp (lead.what)
//   matters   why it matters: a counter and the dated vote strip
//             (lead.why_matters)
//   ident     a segment card ("From the record"); silent
//   record    the page, retypeset, with the quote highlighted
//             (lead.why_decided, or a picked "From the record" segment)
//   next      what's next (lead.next); skipped when there is none
//   round     the other decisions, with a why-chip when the record has one
//   outro     v2's closing scene, unchanged
//
// Off by default: render.mjs uses it only when VIDEO_TEMPLATE is "v3". Pure.

export const V3_SCHEMA = "fieldstate.weekly_video.v3";
export const ON_THE_VOTES_WE_HOLD = "on the votes we hold";
export const NO_REASON_LINE = "The record has the vote but not yet the reasons.";
export const TIME_NOT_POSTED = "Time not posted";

// Seconds each scene holds after its voice (lib/timeline.mjs `hold_s`), so
// the motion has room: the highlighter on the page needs the most.
const HOLD = { open: 0.8, decided: 0.8, matters: 1.0, ident: 0.6, record: 2.2, next: 0.8, round: 0.6 };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const OUTCOME_WORD = {
  approved: "approved",
  approved_with_conditions: "approved with conditions",
  denied: "denied",
  withdrawn: "withdrawn",
  failed: "voted down",
  continued: "deferred",
  tabled: "tabled",
};

const DOCUMENT_LABEL = {
  staff_report: "staff report",
  decision_statement: "decision statement",
  consistency: "statement of consistency",
  consistency_statement: "statement of consistency",
  findings: "findings of fact",
  resolution: "resolution",
  ordinance: "ordinance",
  minutes: "minutes",
};

// ── spoken words ────────────────────────────────────────────────────────────

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORD = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };

/** 0..999999 in words ("twenty-three", "one hundred four"). */
export function spellInt(n) {
  n = Math.trunc(Number(n));
  if (!Number.isFinite(n) || n < 0 || n > 999999) throw new Error(`cannot spell ${n}`);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred` + (n % 100 ? ` ${spellInt(n % 100)}` : "");
  return `${spellInt(Math.floor(n / 1000))} thousand` + (n % 1000 ? ` ${spellInt(n % 1000)}` : "");
}

/** 1 → "first", 19 → "nineteenth", 23 → "twenty-third". */
export function spellOrdinal(n) {
  const w = spellInt(n);
  const parts = w.split(/([ -])/);
  const last = parts.pop();
  const ord = ORD[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return parts.join("") + ord;
}

function isoDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return { y, mo, d, dow: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
}

/** "Oct 19", "Oct 19, 2026" with the year. */
export function shortDate(iso, withYear = false) {
  const t = isoDate(iso);
  if (!t) return "";
  return `${MONTHS[t.mo - 1].slice(0, 3)} ${t.d}${withYear ? `, ${t.y}` : ""}`;
}

/** "October 19" (captions keep the digit). */
export function longDate(iso) {
  const t = isoDate(iso);
  return t ? `${MONTHS[t.mo - 1]} ${t.d}` : "";
}

/** "October nineteenth"; with the weekday, "Tuesday, October twenty-seventh". */
export function spokenDate(iso, { weekday = false } = {}) {
  const t = isoDate(iso);
  if (!t) return "";
  return `${weekday ? `${DAYS[t.dow]}, ` : ""}${MONTHS[t.mo - 1]} ${spellOrdinal(t.d)}`;
}

/** "6:00 PM" → "six in the evening"; "9:30 AM" → "nine thirty in the morning". */
export function spokenTime(text) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s*[Mm]\.?\s*$/.exec(String(text ?? ""));
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const pm = m[3].toLowerCase() === "p";
  if (h < 1 || h > 12 || min > 59) return null;
  if (h === 12 && min === 0) return pm ? "noon" : "midnight";
  const h24 = (h % 12) + (pm ? 12 : 0);
  const part = h24 < 12 ? "in the morning" : h24 < 17 ? "in the afternoon" : "in the evening";
  const mins = min === 0 ? "" : min < 10 ? ` oh ${spellInt(min)}` : ` ${spellInt(min)}`;
  return `${spellInt(h)}${mins} ${part}`;
}

// The voice line for a caption line: the engine's rules
// (sie-engine sie/serve/weekly_video.py `spell_text`), ported as written, so
// a headline sounds the same in v3 as in v2. The caption keeps the digits.
const MONTH_RE = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2})\\b`, "g");
const STREET_ABBR = {
  Blvd: "Boulevard", Rd: "Road", St: "Street", Ave: "Avenue", Dr: "Drive", Ln: "Lane", Hwy: "Highway",
  Pkwy: "Parkway", Ct: "Court", Cir: "Circle", Pl: "Place", Ext: "Extension", Mt: "Mount", Ste: "Suite",
  Sq: "Square", Trl: "Trail",
};
const STREET_RE = new RegExp(`\\b(${Object.keys(STREET_ABBR).join("|")})\\b\\.?`, "g");

function spellToken(tok) {
  const raw = String(tok).replace(/,/g, "");
  if (/^\d{4}$/.test(raw) && !(Number(raw) >= 1900 && Number(raw) <= 2099)) {
    const hi = Math.floor(Number(raw) / 100);
    const lo = Number(raw) % 100;
    return lo < 10 ? `${spellInt(hi)} oh ${spellInt(lo)}` : `${spellInt(hi)} ${spellInt(lo)}`;
  }
  if (/^\d+$/.test(raw)) return Number(raw) < 1e6 ? spellInt(Number(raw)) : raw;
  if (/^\d+\.\d+$/.test(raw)) {
    const [whole, frac] = raw.split(".");
    return `${spellToken(whole)} point ${[...frac].map((ch) => spellInt(Number(ch))).join(" ")}`;
  }
  return tok;
}

export function spellText(text) {
  const src = String(text ?? "");
  const out = spellLine(src);
  return /[.!?]$/.test(src.trim()) && !/[.!?]$/.test(out) ? `${out}.` : out;
}

/** A voice line put together here: spelled, each sentence starting with a capital. */
function voiceLine(text) {
  return spellText(text).replace(/(^|[.!?]\s+)([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

function spellLine(text) {
  let out = String(text ?? "");
  out = out.replace(/\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/gi, (_m, h, mi, ap) => {
    const hour = Number(h);
    const minute = Number(mi);
    if (hour === 12 && minute === 0) return ap.toUpperCase() === "PM" ? "noon" : "midnight";
    const clock = minute === 0 ? spellInt(hour) : minute < 10 ? `${spellInt(hour)} oh ${spellInt(minute)}` : `${spellInt(hour)} ${spellInt(minute)}`;
    const half = ap.toUpperCase() === "AM" ? "in the morning" : hour === 12 || hour < 6 ? "in the afternoon" : "in the evening";
    return `${clock} ${half}`;
  });
  out = out.replace(MONTH_RE, (_m, mo, d) => `${mo} ${spellOrdinal(Number(d))}`);
  out = out.replace(/fieldstate\.org\/nc/g, "fieldstate dot org").replace(/fieldstate\.org/g, "fieldstate dot org");
  out = out.replace(/ & /g, " and ");
  out = out.replace(/\b(I|US|NC)[- ](\d{1,3})\b/g, (_m, r, n) => `${{ I: "I", US: "U.S.", NC: "N.C." }[r]} ${n}`);
  out = out.replace(STREET_RE, (_m, w) => STREET_ABBR[w]);
  out = out.replace(/\b(\d{1,2})\s*[–-]\s*(\d{1,2})\b/g, (_m, a, b) => `${spellToken(a)} to ${spellToken(b)}`);
  out = out.replace(/\$(\d+(?:\.\d+)?)\s*(million|billion|thousand)\b/gi, (_m, n, w) => `${spellToken(n)} ${w.toLowerCase()} dollars`);
  out = out.replace(/\$(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?\b/g, (_m, whole, cents) =>
    cents && cents !== "00" ? `${spellToken(whole)} dollars and ${spellInt(Number(cents))} cents` : `${spellToken(whole)} dollars`);
  out = out.replace(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)\b/g, (m) => spellToken(m));
  out = out.replace(/\b\d{1,3}(?:,\d{3})*\b/g, (m) => spellToken(m));
  out = out.replace(/\d+/g, (m) => ` ${spellToken(m)} `);
  return out.replace(/\s+/g, " ").trim();
}

// ── reading the v3 block ────────────────────────────────────────────────────

function cap1(text) {
  const s = String(text ?? "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function stripState(place) {
  return String(place ?? "").replace(/, [A-Z]{2}$/, "");
}

function sentence(text) {
  const s = String(text ?? "").trim();
  return s && !/[.!?]$/.test(s) ? `${s}.` : s;
}

/** "Union County Board of Commissioners", "Charlotte City Council". */
export function bodyName(place, body) {
  const p = stripState(place);
  const b = String(body ?? "").trim();
  if (!b) return p;
  if (!p || b.toLowerCase().includes(p.toLowerCase())) return b;
  return `${p} ${b}`;
}

/** {yes: 5} → "5–0"; null without a roll call. */
export function tallyText(tally) {
  if (!tally || typeof tally !== "object") return null;
  const yes = Number(tally.yes || 0);
  const no = Number(tally.no || 0);
  if (!yes && !no) return null;
  return `${yes}–${no}`;
}

/** {yes: 5} → "5 votes to none"; {yes: 4, no: 1} → "4 votes to 1". */
function capTally(tally) {
  const yes = Number(tally?.yes || 0);
  const no = Number(tally?.no || 0);
  return `${yes} ${yes === 1 ? "vote" : "votes"} to ${no || "none"}`;
}

function spokenTally(tally) {
  if (!tally) return null;
  const yes = Number(tally.yes || 0);
  const no = Number(tally.no || 0);
  if (!yes && !no) return null;
  return `${spellInt(yes)} ${yes === 1 ? "vote" : "votes"} to ${no ? spellInt(no) : "none"}`;
}

/**
 * A plain headline written as if the item were still ahead ("Charlotte to
 * consider extending …", "… will vote on …"). Held out of the round of
 * decided items until the engine's wording is fixed.
 */
const FUTURE = new RegExp(
  [
    String.raw`\bwill\b`,
    String.raw`\b(?:is|are)\s+(?:set|scheduled|expected|slated|due)\s+to\b`,
    String.raw`\b(?:set|scheduled|expected|slated|plans?|planning)\s+to\b`,
    String.raw`\bupcoming\b`,
    // "<subject> to <verb>" headline style: "Charlotte to consider …"
    String.raw`\bto\s+(?:consider|vote|hear|review|decide|discuss|take\s+up|weigh|act|debate|revisit|study|approve|deny)\b`,
  ].join("|"),
  "i",
);

export function futureTense(text) {
  return FUTURE.test(String(text ?? ""));
}

function documentLabel(doc) {
  const key = String(doc ?? "").toLowerCase();
  return DOCUMENT_LABEL[key] ?? (key ? key.replace(/_/g, " ") : "record");
}

/** What a staff recommendation line asks for: "approval", "denial" or null. */
export function recommends(quote) {
  const m = /\brecommend(?:s|ed|ing|ation)?\s*:?\s+(?:the\s+)?(approval|denial)\b/i.exec(String(quote ?? ""));
  return m ? m[1].toLowerCase() : null;
}

/** Why v3 can't be rendered from this script, or null when it can. */
export function v3Problem(script) {
  const v3 = script?.v3;
  if (!v3 || typeof v3 !== "object") return "the script has no v3 block";
  if (v3.schema !== V3_SCHEMA) return `v3 schema is ${v3.schema ?? "missing"}`;
  if (v3.error) return `the engine's v3 build failed (${String(v3.error).slice(0, 60)})`;
  if (!v3.cold_open?.cap || !v3.cold_open?.voice) return "v3 has no cold open";
  if (!(script.scenes ?? []).some((s) => s.kind === "outro")) return "the script has no closing scene";
  return null;
}

// ── scenes ─────────────────────────────────────────────────────────────────

function openScene(v3, script) {
  const co = v3.cold_open;
  let cap = String(co.cap).trim();
  let voice = String(co.voice).trim();
  // Any streak or share line the record does not fully cover says so.
  if (co.coverage_ok === false && !cap.toLowerCase().includes(ON_THE_VOTES_WE_HOLD)) {
    cap = `${cap.replace(/[.]$/, "")}, ${ON_THE_VOTES_WE_HOLD}.`;
    voice = `${voice.replace(/[.]$/, "")}, ${ON_THE_VOTES_WE_HOLD}.`;
  }
  const at = cap.indexOf(": ");
  const hook = at > 0 ? cap.slice(0, at) : cap.replace(/[.]$/, "");
  const sub = at > 0 ? cap1(cap.slice(at + 2)) : "";
  const b = co.basis ?? {};
  const what = v3.lead?.what;
  const sameBoard = what && b.gov_body_id != null && b.gov_body_id === what.gov_body_id;
  const kicker = sameBoard
    ? [stripState(what.place_short || what.place), what.body].filter(Boolean).join(" · ")
    : /^This week in\b/i.test(hook)
      ? weekLabel(script)
      : `This week in ${script.state_name || script.state}`;
  let src = "From the public record";
  if (co.kind === "streak_without_no") {
    src = b.since_kind === "last_no_vote"
      ? `Last no vote ${shortDate(b.since, true)}${b.last_no_tally ? ` (${b.last_no_tally})` : ""} · Documented`
      : `On the record since ${shortDate(b.since, true)} · Documented`;
  } else if (co.kind === "split_after_run") {
    src = `Decided ${shortDate(b.date, true)} · Documented`;
  }
  return {
    id: "v3-open", kind: "open", voice, cap, hold_s: HOLD.open,
    screen: { kicker, hook, sub, src, kind: co.kind, coverage_ok: co.coverage_ok !== false, week_label: weekLabel(script) },
  };
}

function weekLabel(script) {
  const title = (script.scenes ?? []).find((s) => s.kind === "title");
  return title?.screen?.week_label || `Week of ${shortDate(script.week_of)}`;
}

function decidedScene(lead) {
  const w = lead.what;
  const outcome = OUTCOME_WORD[w.outcome] ?? "decided";
  const tally = tallyText(w.tally);
  const roll = (w.roll_call ?? []).filter((m) => m && m.name);
  const board = bodyName(w.place, w.body);
  const text = cap1(w.text);
  const verbFirst = ["approved", "denied", "approved_with_conditions", "failed"].includes(w.outcome);
  const core = verbFirst ? `the ${board} ${outcome} ${lowerFirst(w.text)}` : `${lowerFirst(w.text)} was ${outcome} at the ${board}`;
  const capLine = `On ${longDate(w.date)}, ${core}.` + (tally && roll.length ? ` ${capTally(w.tally)}.` : "");
  const spoken = `On ${spokenDate(w.date)}, ${core}.` + (tally && roll.length ? ` ${cap1(spokenTally(w.tally))}.` : "");
  return {
    id: "v3-decided", kind: "decided", voice: voiceLine(spoken), cap: capLine, hold_s: HOLD.decided,
    screen: {
      kicker: `What happened · Decided ${shortDate(w.date)}`,
      card_kicker: [w.place, w.kind_label === "Item" ? null : w.kind_label, w.case_number].filter(Boolean).join(" · "),
      head: text,
      sub: `${board} · ${roll.length ? "roll call from the meeting record" : "from the meeting record"}`,
      seats: roll.map((m) => ({ name: m.name, vote: String(m.vote || "").toLowerCase() })),
      outcome: w.outcome,
      stamp: `${outcome.toUpperCase()}${tally && roll.length ? ` ${tally}` : ""}`,
      tier: w.tier || "Documented",
    },
  };
}

// Plain headlines start with a capital. Mid-sentence, a common first word
// is lowered ("approved Resolution of …" → "approved resolution of …");
// anything else may be a name and keeps its capital.
const COMMON_FIRST = new Set(("a an the resolution public ordinance contract agreement rezoning request application " +
  "amendment amendments interlocal escrow design text special site variance budget conditional annexation " +
  "development plan preliminary final major minor zoning subdivision proposed").split(" "));

function lowerFirst(text) {
  const s = String(text ?? "").trim();
  const first = s.split(/\s+/)[0] ?? "";
  return /^[A-Z][a-z]+$/.test(first) && COMMON_FIRST.has(first.toLowerCase()) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function mattersScene(lead) {
  const wm = lead.why_matters;
  const b = wm.basis ?? {};
  const strip = (b.strip ?? []).filter((v) => v && v.date).slice().reverse(); // oldest first
  if (strip.length < 3) return null;
  const ok = wm.coverage_ok !== false;
  let cap = String(wm.cap).trim();
  let voice = String(wm.voice).trim();
  if (!ok && !cap.toLowerCase().includes(ON_THE_VOTES_WE_HOLD)) {
    cap = `${cap.replace(/[.]$/, "")}, ${ON_THE_VOTES_WE_HOLD}.`;
    voice = `${voice.replace(/[.]$/, "")}, ${ON_THE_VOTES_WE_HOLD}.`;
  }
  const votes = Number(b.votes ?? strip.length);
  const unanimous = Number(b.unanimous ?? strip.filter((v) => !v.no).length);
  const all = unanimous === votes;
  const board = bodyName(lead.what.place, lead.what.body);
  return {
    id: "v3-matters", kind: "matters", voice, cap, hold_s: HOLD.matters,
    screen: {
      kicker: "Why it matters",
      count: all ? votes : unanimous,
      label: all
        ? [`recorded votes since ${b.since_month}`, "without a single no"]
        : [`of ${votes} recorded votes since ${b.since_month}`, "had no vote against"],
      strip: strip.map((v) => ({ date: v.date, yes: Number(v.yes || 0), no: Number(v.no || 0), this_case: !!v.this_case })),
      src: `Each mark is one recorded vote by the ${board} on Fieldstate's record${ok ? "" : `, ${ON_THE_VOTES_WE_HOLD}`} · Documented`,
      coverage_ok: ok,
    },
  };
}

function identScene(title, n) {
  return { id: `v3-ident-${n}`, kind: "ident", voice: "", cap: "", hold_s: HOLD.ident, screen: { title } };
}

/** The page: the lead's why_decided (with its outcome), or a wheel pick. */
function recordScene(q, { what = null, place = null, text = null, n = 0 } = {}) {
  const doc = documentLabel(q.document);
  const page = q.page;
  const placeShort = stripState(what?.place_short || what?.place || place || "");
  const dir = recommends(q.quote);
  const tally = what ? tallyText(what.tally) : null;
  const outcome = what ? OUTCOME_WORD[what.outcome] : null;
  const approved = what && ["approved", "approved_with_conditions"].includes(what.outcome);
  const agreed = what && dir && (dir === "approval") === !!approved && ["approved", "approved_with_conditions", "denied", "failed"].includes(what.outcome);
  const tallyCap = tally && (what.roll_call ?? []).length ? tally : null;
  let sideK;
  let side1;
  let side2 = null;
  let voice;
  let cap;
  if (what) {
    if (q.names_reasons) {
      // The sentence names the reasons: this is the "why".
      sideK = "Why it was decided";
      side1 = `The reasons, on page ${page}.`;
      side2 = outcome ? `${cap1(outcome)}${tallyCap ? `, ${tallyCap}` : ""}.` : null;
      cap = `Why was it decided? The ${doc} gives the reasons, on page ${page}.` + (outcome ? ` The board ${outcome} it${tallyCap ? `, ${tallyCap}` : ""}.` : "");
    } else {
      // A recommendation, or a line that points back at earlier pages: render
      // the quote, never call it the why.
      sideK = "From the record";
      if (dir && q.source === "staff_recommendation") {
        side1 = `Staff recommended ${dir}.`;
        side2 = agreed ? `The board agreed${tallyCap ? `, ${tallyCap}` : ""}.` : outcome ? `The board: ${outcome}${tallyCap ? `, ${tallyCap}` : ""}.` : null;
        cap = `What does the record say? On page ${page} of the ${doc}, staff recommended ${dir}.` +
          (agreed ? ` The board agreed${tallyCap ? `, ${tallyCap}` : ""}.` : outcome ? ` The board's vote: ${outcome}${tallyCap ? `, ${tallyCap}` : ""}.` : "");
      } else {
        side1 = `The ${doc}, page ${page}.`;
        side2 = outcome ? `The board: ${outcome}${tallyCap ? `, ${tallyCap}` : ""}.` : null;
        cap = `What does the record say? This is page ${page} of the ${doc}.` + (outcome ? ` The board's vote: ${outcome}${tallyCap ? `, ${tallyCap}` : ""}.` : "");
      }
    }
  } else {
    sideK = "From the record";
    side1 = cap1(sentence(text));
    side2 = dir && q.source === "staff_recommendation" ? `Staff recommended ${dir}.` : `The ${doc}, page ${page}.`;
    cap = `From the record${placeShort ? `, in ${placeShort}` : ""}: ${sentence(text)}` +
      ` On page ${page} of the ${doc}${dir && q.source === "staff_recommendation" ? `, staff recommended ${dir}` : ""}.`;
  }
  voice = voiceLine(cap.replace(/(\d+)–(\d+)/g, (_m, a, b) => `${a} votes to ${Number(b) ? b : "none"}`));
  return {
    id: `v3-record-${n}`, kind: "record", voice, cap, hold_s: HOLD.record,
    screen: {
      paper_head: [placeShort, cap1(doc)].filter(Boolean).join(" · "),
      paper_id: what?.case_number || "",
      paper_title: q.source === "staff_recommendation" ? "Staff recommendation" : cap1(doc),
      quote: String(q.quote ?? "").trim(),
      page,
      side_k: sideK,
      side_1: side1,
      side_2: side2,
      side_src: `${[placeShort, doc].filter(Boolean).join(" ")}, p. ${page}${q.date ? ` · ${shortDate(q.date, true)}` : ""}`,
      label: "Quoted as posted · retypeset for video",
    },
  };
}

function noReasonScene(lead, n) {
  const line = lead.no_reason_line || NO_REASON_LINE;
  return {
    id: `v3-record-${n}`, kind: "record", voice: line, cap: line, hold_s: 1.0,
    screen: { no_quote: true, side_k: "From the record", side_1: line, side_2: null },
  };
}

function nextScene(lead) {
  const nx = lead.next;
  if (!nx || !nx.date) return null;
  const w = lead.what;
  const leadPlace = stripState(w.place_short || w.place);
  const date = nx.date;
  const posted = nx.time_posted !== false && nx.time && nx.time !== TIME_NOT_POSTED;
  const time = posted ? nx.time : TIME_NOT_POSTED;
  const when = spokenDate(date, { weekday: true });
  const sTime = posted ? spokenTime(nx.time) : null;
  let kicker;
  let place;
  let rows = [];
  let cap;
  let voice;
  if (nx.kind === "case_step") {
    const stage = cap1(String(nx.stage || "next step").replace(/_/g, " "));
    kicker = "What's next on this case";
    place = nx.body ? bodyName(w.place, nx.body) : leadPlace;
    rows = [stage, "From the case record"];
    cap = `Next on this case: ${stage.toLowerCase()}, on ${longDate(date)}.`;
    voice = `Next on this case: ${stage.toLowerCase()}, on ${when}.`;
  } else {
    const board = bodyName(nx.place, nx.body);
    const county = nx.kind === "county_next_meeting" && nx.county ? stripState(nx.county) : null;
    kicker = `What's next in ${county || leadPlace}`;
    place = board;
    const n = Number(nx.item_count);
    if (Number.isFinite(n) && n > 0) rows.push(`${n} ${n === 1 ? "item" : "items"} on the posted agenda`);
    rows.push("From the posted agenda");
    const lead1 = nx.kind === "board_next_meeting"
      ? `The ${board} meets next`
      : county
        ? `Nearby in ${county}, the ${board} meets`
        : `In ${stripState(nx.place)}, the ${board} meets next`;
    const items = Number.isFinite(n) && n > 0 ? ` ${cap1(n === 1 ? "one item is" : `${n} items are`)} on the posted agenda.` : "";
    cap = `${lead1} on ${DAYS[isoDate(date).dow]}, ${longDate(date)}${posted ? ` at ${nx.time}` : ""}.${items}`;
    voice = `${lead1} on ${when}${sTime ? ` at ${sTime}` : ""}.${items}`;
  }
  const t = isoDate(date);
  return {
    id: "v3-next", kind: "next", voice: voiceLine(voice), cap, hold_s: HOLD.next,
    screen: {
      kicker,
      when: [DAYS[t.dow].slice(0, 3).toUpperCase(), shortDate(date)],
      time,
      place,
      rows,
    },
  };
}

function roundScene(v3) {
  const items = (v3.round ?? []).filter((it) => it && it.text && !futureTense(it.text)).slice(0, 4);
  if (!items.length) return null;
  const line = (it) => {
    const out = OUTCOME_WORD[it.outcome] ?? "decided";
    return `${cap1(String(it.text).trim().replace(/[.]$/, ""))}: ${out}${it.why_chip ? `, ${it.why_chip}` : ""}.`;
  };
  const cap = `Also decided this week. ${items.map(line).join(" ")}`;
  return {
    id: "v3-round", kind: "round", voice: voiceLine(cap), cap, hold_s: HOLD.round,
    screen: {
      kicker: "Also decided",
      items: items.map((it) => ({
        text: cap1(it.text), outcome: it.outcome, kind_label: it.kind_label === "Item" ? null : it.kind_label, place_short: it.place_short || stripState(it.place),
        date: it.date, chip: it.why_chip || null, tier: "Documented",
      })),
    },
  };
}

/**
 * The render script for v3: the v2 script's header plus v3 scenes. Throws
 * when v3 can't be rendered (render.mjs then renders v2 as today).
 */
export function v3RenderScript(script, { log = () => {} } = {}) {
  const problem = v3Problem(script);
  if (problem) throw new Error(problem);
  const v3 = script.v3;
  const scenes = [openScene(v3, script)];
  let idents = 0;
  const lead = v3.lead;
  const recordIds = new Set();
  if (lead?.what) {
    scenes.push(decidedScene(lead));
    if (lead.why_matters) {
      const m = mattersScene(lead);
      if (m) scenes.push(m);
    }
    if (lead.why_decided?.quote && lead.why_decided?.page) {
      scenes.push(identScene("From the record", idents++));
      scenes.push(recordScene(lead.why_decided, { what: lead.what, n: scenes.length }));
      recordIds.add(lead.what.matter_id);
    } else {
      scenes.push(noReasonScene(lead, scenes.length));
    }
    const nx = nextScene(lead);
    if (nx) scenes.push(nx);
    else log("v3: no next step and no posted meeting nearby; the next beat is skipped");
  } else {
    log("v3: no lead this week (no documented decision with a case file)");
  }
  const rnd = roundScene(v3);
  const held = (v3.round ?? []).filter((it) => it && futureTense(it.text)).length;
  if (held) log(`v3: ${held} round item(s) held out (headline reads as future tense)`);
  if (rnd) scenes.push(rnd);
  // The wheel: only segments with a template are rendered.
  for (const pick of v3.wheel?.picked ?? []) {
    const d = pick?.data ?? {};
    if (pick.segment === "from_the_record" && d.quote && d.page && !recordIds.has(d.matter_id)) {
      scenes.push(identScene(v3.wheel?.titles?.from_the_record || "From the record", idents++));
      scenes.push(recordScene(d, { place: d.place, text: d.text, n: scenes.length }));
      recordIds.add(d.matter_id);
    } else {
      log(`v3: wheel segment ${pick?.segment} has no template yet; not rendered`);
    }
  }
  // v3 renders only what has a template. A week with neither a lead nor a
  // page from the record has nothing the v2 video doesn't say better.
  if (!scenes.some((s) => s.kind === "decided" || s.kind === "record")) {
    throw new Error("no lead story and no From-the-record page this week");
  }
  const outro = script.scenes.find((s) => s.kind === "outro");
  scenes.push({ ...outro });
  return {
    schema: `${V3_SCHEMA}.render`,
    state: script.state,
    state_name: script.state_name,
    title: script.title,
    week_of: script.week_of,
    scenes,
  };
}
