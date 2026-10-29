// Weekly video v3: the lead-story template behind
// VIDEO_TEMPLATE. Pure: no Docker, no browser, no network.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { estimatedAlignment } from "../lib/captions.mjs";
import { buildTimeline } from "../lib/timeline.mjs";
import {
  NO_REASON_LINE,
  futureTense,
  recommends,
  spellOrdinal,
  spellText,
  spokenTime,
  v3Problem,
  v3RenderScript,
} from "../lib/v3.mjs";
import { NO_BRAND_KINDS, brandSpans, compositionHtml } from "../hyperframes/generate.mjs";

// A synthetic script in the engine's shape: v2 fields plus the v3 block
// (sie-engine sie/serve/weekly_video_v3.py). Example names only.
function fixture(changes = {}) {
  const strip = [
    { date: "2026-10-19", matter_id: 1, yes: 5, no: 0, absent: 0, this_case: true },
    { date: "2026-07-20", matter_id: 2, yes: 5, no: 0, absent: 0, this_case: false },
    { date: "2026-06-01", matter_id: 3, yes: 4, no: 0, absent: 1, this_case: false },
    { date: "2025-08-11", matter_id: 4, yes: 5, no: 0, absent: 0, this_case: false },
    { date: "2024-11-18", matter_id: 5, yes: 3, no: 2, absent: 0, this_case: false },
  ];
  const v3 = {
    schema: "fieldstate.weekly_video.v3",
    state: "NC",
    week_of: "2026-10-26",
    cold_open: {
      kind: "streak_without_no",
      cap: "Not one no vote in 23 months: the Example County Board of Commissioners, 4 recorded votes in a row, on the votes we hold.",
      voice: "Not one no vote in twenty-three months: the Example County Board of Commissioners, four recorded votes in a row, on the votes we hold.",
      basis: { streak: 4, since: "2024-11-18", since_kind: "last_no_vote", last_no_tally: "3–2", months: 23, gov_body_id: 7, votes_shown: 5, votes_total: 6 },
      coverage_ok: false,
    },
    lead: {
      what: {
        matter_id: 1, case_number: "RZ-2026-010", text: "Example County rezoning to light industrial use", outcome: "approved",
        kind_label: "Rezoning", tier: "Documented", tally: { yes: 5 }, place: "Example County, NC", place_short: "Example County",
        county: "Example", date: "2026-10-19", date_label: "Oct 19", body: "Board of Commissioners", gov_body_id: 7,
        roll_call: ["Ann Able", "Ben Baker", "Cal Cole", "Dee Dunn", "Eve Ellis"].map((name) => ({ name, vote: "yes" })),
      },
      why_matters: {
        cap: "The Example County Board of Commissioners: 4 of 5 recorded votes since November 2024 had no vote against, on the votes we hold.",
        voice: "The Example County Board of Commissioners: four of five recorded votes since November twenty twenty-four had no vote against, on the votes we hold.",
        basis: { votes: 5, unanimous: 4, since: "2024-11-18", since_month: "November 2024", votes_shown: 5, votes_total: 6, strip },
        coverage_ok: false,
      },
      why_decided: {
        quote: "Because of these aspects of the development, staff recommend approval of this rezoning application.",
        document: "staff_report", page: 8, url: "https://example.gov/report.pdf", date: "2026-10-19",
        source: "staff_recommendation", names_reasons: false,
      },
      no_reason_line: NO_REASON_LINE,
      next: {
        kind: "county_next_meeting", date: "2026-10-27", time: "Time not posted", time_posted: false,
        place: "Example Town, NC", body: "Town Council", county: "Example County", item_count: 3,
      },
    },
    round: [
      { matter_id: 11, text: "Example City rezoning petition withdrawn", place: "Example City, NC", place_short: "Example City", outcome: "withdrawn", kind_label: "Zoning", date: "2026-10-19", why_chip: null },
      { matter_id: 12, text: "Example City to consider extending a moratorium", place: "Example City, NC", place_short: "Example City", outcome: "approved", kind_label: "Moratorium", date: "2026-10-19", why_chip: null },
      { matter_id: 13, text: "$2.7 million contract for 2 traffic signals", place: "Example City, NC", place_short: "Example City", outcome: "approved", kind_label: "Budget", date: "2026-10-20", why_chip: "split 4–3" },
    ],
    wheel: {
      built: ["from_the_record", "long_road"],
      titles: { from_the_record: "From the record", long_road: "The long road" },
      eligible: [],
      picked: [{ segment: "long_road", score: 50, data: { matter_id: 11, months: 15 } }],
      history: [],
    },
  };
  return {
    schema: "fieldstate.weekly_video.v2",
    state: "NC",
    state_name: "North Carolina",
    title: "This week in North Carolina · Oct 26",
    week_of: "2026-10-26",
    scenes: [
      { id: "open", kind: "title", voice: "This week in North Carolina.", cap: "This week in North Carolina.", screen: { week_label: "Week of Oct 26" } },
      { id: "close", kind: "outro", voice: "We show you the record.", cap: "We show you the record.", screen: { site: "fieldstate.org/nc" } },
    ],
    v3: { ...v3, ...changes },
  };
}

function withLead(lead) {
  const s = fixture();
  s.v3.lead = { ...s.v3.lead, ...lead };
  return s;
}

function timelineFor(r) {
  const voiced = r.scenes.map((s) => ({ id: s.id, audio: null, alignment: s.voice ? estimatedAlignment(s.voice, s.voice.length / 15) : null }));
  return buildTimeline(r, voiced);
}

const kinds = (r) => r.scenes.map((s) => s.kind);
const scene = (r, kind) => r.scenes.find((s) => s.kind === kind);

test("v3 scenes: the lead story in the why order, then the round and v2's close", () => {
  const logs = [];
  const r = v3RenderScript(fixture(), { log: (l) => logs.push(l) });
  assert.deepEqual(kinds(r), ["open", "decided", "matters", "ident", "record", "next", "round", "outro"]);
  assert.equal(scene(r, "ident").voice, "");
  assert.equal(scene(r, "outro").voice, "We show you the record.");
  assert.ok(logs.some((l) => /long_road has no template/.test(l)));
  for (const s of r.scenes) assert.doesNotMatch(s.voice, /\d/, `${s.kind}: a digit in the voice`);
  assert.match(scene(r, "decided").cap, /October 19/);
  assert.equal(scene(r, "decided").screen.stamp, "APPROVED 5–0");
  assert.equal(scene(r, "decided").screen.seats.length, 5);
  assert.deepEqual(scene(r, "matters").screen.strip.map((v) => v.date), ["2024-11-18", "2025-08-11", "2026-06-01", "2026-07-20", "2026-10-19"]);
  assert.equal(scene(r, "matters").screen.count, 4);
});

test("coverage_ok false: 'on the votes we hold', on screen and in the voice", () => {
  const s = fixture();
  s.v3.cold_open.cap = "Not one no vote in 23 months: the Example County Board of Commissioners, 4 recorded votes in a row.";
  s.v3.cold_open.voice = "Not one no vote in twenty-three months: the Example County Board of Commissioners, four recorded votes in a row.";
  const r = v3RenderScript(s);
  const open = scene(r, "open");
  assert.match(open.cap, /on the votes we hold\.$/);
  assert.match(open.voice, /on the votes we hold\.$/);
  assert.match(open.screen.sub, /on the votes we hold/);
  assert.match(scene(r, "matters").screen.src, /on the votes we hold/);
  const full = fixture();
  full.v3.lead.why_matters.coverage_ok = true;
  full.v3.lead.why_matters.cap = "The Example County Board of Commissioners: 4 of 5 recorded votes since November 2024 had no vote against.";
  assert.doesNotMatch(scene(v3RenderScript(full), "matters").screen.src, /on the votes we hold/);
});

test("names_reasons false: the quote is shown, the side panel never says why", () => {
  const rec = scene(v3RenderScript(fixture()), "record");
  assert.equal(rec.screen.side_1, "Staff recommended approval.");
  assert.equal(rec.screen.side_2, "The board agreed, 5–0.");
  assert.doesNotMatch(`${rec.screen.side_k} ${rec.screen.side_1} ${rec.screen.side_2} ${rec.voice}`, /\bwhy\b/i);
  assert.match(rec.screen.quote, /^Because of these aspects/);
  assert.equal(rec.screen.label, "Quoted as posted · retypeset for video");
  assert.equal(rec.screen.page, 8);
  const named = scene(v3RenderScript(withLead({ why_decided: { ...fixture().v3.lead.why_decided, names_reasons: true, quote: "The rezoning is consistent with the plan because the site adjoins industrial uses." } })), "record");
  assert.equal(named.screen.side_k, "Why it was decided");
});

test("no quote: 'The record has the vote but not yet the reasons.', no page, no segment card", () => {
  const r = v3RenderScript(withLead({ why_decided: null }));
  assert.ok(!kinds(r).includes("ident"));
  const rec = scene(r, "record");
  assert.equal(rec.screen.no_quote, true);
  assert.equal(rec.voice, "The record has the vote but not yet the reasons.");
  assert.equal(rec.screen.side_1, "The record has the vote but not yet the reasons.");
});

test("next: the county fallback is named; no next step skips the beat; time is never guessed", () => {
  const nx = scene(v3RenderScript(fixture()), "next");
  assert.equal(nx.screen.kicker, "What's next in Example County");
  assert.equal(nx.screen.time, "Time not posted");
  assert.deepEqual(nx.screen.when, ["TUE", "Oct 27"]);
  assert.equal(nx.screen.place, "Example Town Town Council");
  assert.match(nx.voice, /^Nearby in Example County, the Example Town Town Council meets on Tuesday, October twenty-seventh\. Three items/);
  assert.doesNotMatch(nx.voice, /\bat\b.*(morning|evening|afternoon)/);
  assert.ok(!kinds(v3RenderScript(withLead({ next: null }))).includes("next"));
  const timed = scene(v3RenderScript(withLead({ next: { ...fixture().v3.lead.next, kind: "board_next_meeting", time: "6:30 PM", time_posted: true } })), "next");
  assert.match(timed.voice, /at six thirty in the evening\./);
  assert.equal(timed.screen.time, "6:30 PM");
});

test("round: future-tense headlines are held out; chips are kept", () => {
  const logs = [];
  const rnd = scene(v3RenderScript(fixture(), { log: (l) => logs.push(l) }), "round");
  assert.deepEqual(rnd.screen.items.map((i) => i.text), ["Example City rezoning petition withdrawn", "$2.7 million contract for 2 traffic signals"]);
  assert.equal(rnd.screen.items[1].chip, "split 4–3");
  assert.match(rnd.voice, /Two point seven million dollars contract for two traffic signals: approved, split four to three\./);
  assert.ok(logs.some((l) => /1 round item\(s\) held out/.test(l)));
  assert.ok(futureTense("Charlotte to consider extending moratorium on new telecom facilities"));
  assert.ok(futureTense("Board will vote on the budget"));
  assert.ok(!futureTense("Union County rezoning to light industrial use, public hearing held"));
  assert.ok(!futureTense("Resolution of no objection for senior housing approved"));
});

test("wheel: a From-the-record pick gets its own card and page; no lead and no page renders v2", () => {
  const s = fixture({ lead: null });
  s.v3.wheel.picked = [{
    segment: "from_the_record", score: 30,
    data: { matter_id: 21, text: "Example sign district amendment", place: "Example City, TX", quote: "STAFF RECOMMENDATION: Approval, subject to conditions.", document: "staff_report", page: 1, date: "2026-10-14", source: "staff_recommendation", names_reasons: false },
  }];
  const r = v3RenderScript(s);
  assert.deepEqual(kinds(r), ["open", "round", "ident", "record", "outro"]);
  assert.equal(scene(r, "record").screen.side_2, "Staff recommended approval.");
  s.v3.wheel.picked = [];
  assert.throws(() => v3RenderScript(s), /no lead story/);
});

test("v3 is used only when the script carries a good v3 block", () => {
  const s = fixture();
  assert.equal(v3Problem(s), null);
  assert.match(v3Problem({ ...s, v3: undefined }), /no v3 block/);
  assert.match(v3Problem({ ...s, v3: { schema: "fieldstate.weekly_video.v3", error: "KeyError" } }), /failed/);
  assert.match(v3Problem({ ...s, v3: { ...s.v3, schema: "fieldstate.weekly_video.v4" } }), /schema/);
  assert.throws(() => v3RenderScript({ ...s, v3: undefined }), /no v3 block/);
});

test("voice spelling follows the engine's rules", () => {
  assert.equal(spellText("$396,576 contract"), "three hundred ninety-six thousand five hundred seventy-six dollars contract");
  assert.equal(spellText("$709,126.18 for 2 signals"), "seven hundred nine thousand one hundred twenty-six dollars and eighteen cents for two signals");
  assert.equal(spellText("$42.1 million"), "forty-two point one million dollars");
  assert.equal(spellText("4645 Dolphin Rd."), "forty-six forty-five Dolphin Road.");
  assert.equal(spellText("On October 19, 5–0 at 6:00 PM, fieldstate.org/nc"), "On October nineteenth, five to zero at six in the evening, fieldstate dot org");
  assert.deepEqual([1, 2, 3, 12, 19, 20, 23, 30, 31].map(spellOrdinal),
    ["first", "second", "third", "twelfth", "nineteenth", "twentieth", "twenty-third", "thirtieth", "thirty-first"]);
  assert.equal(spokenTime("12:00 PM"), "noon");
  assert.equal(spokenTime("9:05 AM"), "nine oh five in the morning");
  assert.equal(recommends("STAFF RECOMMENDATION: Denial."), "denial");
  assert.equal(recommends("staff recommend approval of this application"), "approval");
});

test("timeline: the segment card is silent and holds; v3 holds never touch v2 scenes", () => {
  const r = v3RenderScript(fixture());
  const tl = timelineFor(r);
  const ident = tl.scenes.find((s) => s.kind === "ident");
  assert.equal(ident.audio, null);
  assert.equal(ident.durationInFrames, Math.ceil((0.3 + 0 + 0.7 + 0.6) * 30));
  for (const c of tl.cues) assert.ok(c.end <= ident.from / 30 + 1e-9 || c.start >= (ident.from + ident.durationInFrames) / 30 - 1e-9);
});

test("composition: v3 page has the sample's look, no URL, and the brand bar steps aside for the card and the page", () => {
  const r = v3RenderScript(fixture());
  const tl = timelineFor(r);
  const out = compositionHtml({ script: r, timeline: tl, transcript: null });
  const { html } = out;
  assert.ok(out.grain);
  assert.doesNotMatch(html, /https?:\/\//i);
  for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) assert.match(m[1], /^assets\//, m[1]);
  for (const m of html.matchAll(/url\("([^"]+)"\)/g)) assert.match(m[1], /^assets\//, m[1]);
  assert.doesNotMatch(html, /Math\.random|Date\.now|setInterval|fetch\(/);
  assert.doesNotMatch(html, /SAMPLE|Good morning|mock-up/);
  assert.match(html, /Quoted as posted · retypeset for video/);
  assert.match(html, /data-a="hl"/);
  assert.match(html, /data-a="push"/);
  assert.match(html, /class="v3-tick-bar" style="background:#b3352c/); // the split vote, in red
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  // Brand clips cover everything up to the close except the ident and the page.
  const close = tl.scenes.find((s) => s.kind === "outro");
  const spans = brandSpans(tl, close.from / 30);
  const brands = [...html.matchAll(/class="clip brand" data-start="([\d.]+)" data-duration="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(brands, spans);
  for (const sc of tl.scenes.filter((s) => NO_BRAND_KINDS.has(s.kind))) {
    const a = sc.from / 30;
    const b = (sc.from + sc.durationInFrames) / 30;
    for (const [s0, d] of brands) assert.ok(s0 + d <= a + 1e-3 || s0 >= b - 1e-3, `brand over ${sc.kind}`);
  }
});

test("composition: a v2 page carries no v3 style and keeps its single brand bar", () => {
  const s = fixture();
  const v2 = { ...s, scenes: s.scenes };
  const voiced = v2.scenes.map((x) => ({ id: x.id, audio: null, alignment: estimatedAlignment(x.voice, x.voice.length / 15) }));
  const { html, grain } = compositionHtml({ script: v2, timeline: buildTimeline(v2, voiced), transcript: null });
  assert.doesNotMatch(html.replace(/<script>[\s\S]*?<\/script>/g, ""), /v3-|class="clip brand"/);
  assert.equal((html.match(/id="brand"/g) || []).length, 1);
  assert.equal(grain, false);
});

test("runtime: the highlighter and the push-in are data-a kinds of the one timeline", async () => {
  const rt = await readFile(new URL("../hyperframes/runtime.js", import.meta.url), "utf8");
  assert.match(rt, /kind === "hl"/);
  assert.match(rt, /kind === "push"/);
  assert.doesNotMatch(rt, /#cam|getElementById\("cam"\)/);
});

test("render.mjs: v2 stays the default; v3 only on VIDEO_TEMPLATE=v3, falling back to v2", async () => {
  const src = await readFile(new URL("../render.mjs", import.meta.url), "utf8");
  assert.match(src, /const template = \(env\.VIDEO_TEMPLATE \|\| "v2"\)/);
  assert.match(src, /if \(template === "v3"\) \{\s*try \{/);
  assert.match(src, /if \(templateUsed === "v2"\) \{/);
  assert.doesNotMatch(src, /^import .*lib\/v3\.mjs/m);
  const wf = await readFile(new URL("../.github/workflows/render.yml", import.meta.url), "utf8");
  assert.match(wf, /VIDEO_TEMPLATE: \$\{\{ vars\.VIDEO_TEMPLATE \}\}/);
});
