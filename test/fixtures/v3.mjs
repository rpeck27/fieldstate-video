// Synthetic weekly video scripts with a v3 block, for the tests. The shapes
// follow sie-engine sie/serve/weekly_video_v3.py after #1053 (the golden
// tests/fixtures/weekly_video_v3/nc-2026-10-24.script.json and the field
// table in docs/feeds/README.md); the words, places and numbers are made up
// ("Example ..."), so no week's script is kept in this public repository.
//
//   ncScript()  the NC golden's shape: a streak cold open with coverage_ok
//               false, a lead with roll call, why_matters strip, a staff
//               report page (names_reasons false), "Next door", a round of
//               one (one_at_a_time), the wheel picking The long road.
//   txScript()  the TX shape the surface reviewed: a denials cold open, a
//               lead with no reason on record (fix 2), four round items
//               (highlight, fix 3), the wheel picking From the record with
//               the segment page's case fields (fix 7) and a segment the
//               template doesn't know.

const line = (cap, voice) => ({ cap, voice: voice ?? cap });

function v2Part(state, stateName, weekOf, fips) {
  return {
    schema: "fieldstate.weekly_video.v2",
    state,
    state_name: stateName,
    title: `This week in ${stateName} · Oct 26`,
    week_of: weekOf,
    windows: { run_day: "2026-10-24", week_of: weekOf },
    scenes: [
      {
        id: "open", kind: "title", voice: `This week in ${stateName}.`, cap: `This week in ${stateName}.`,
        screen: { state_name: stateName, week_label: "Week of Oct 26", kicker: "This week in", places_read: 12, read_fips: fips },
      },
      {
        id: "close", kind: "outro", voice: "We don't predict votes. We show you the record.",
        cap: "We don't predict votes. We show you the record.", screen: { site: `fieldstate.org/${state.toLowerCase()}` },
      },
    ],
  };
}

export function ncScript() {
  const what = {
    matter_id: 9001, case_number: "RZ-2026-000", text: "Example County rezoning to light industrial use",
    outcome: "approved", kind_label: "Rezoning", tier: "Documented", tally: { yes: 5 },
    place: "Example County, NC", place_short: "Example County", date: "2026-10-19", body: "Board of Commissioners",
    gov_body_id: 1, roll_call: ["A. One", "B. Two", "C. Three", "D. Four", "E. Five"].map((name) => ({ name, vote: "yes" })),
    lines: [
      line("On October 19, the Example County Board of Commissioners approved a rezoning to light industrial use.",
        "On October nineteenth, the Example County Board of Commissioners approved a rezoning to light industrial use."),
      line("5 votes to none.", "Five votes to none."),
    ],
    screen: {
      kicker: "What happened · Decided Oct 19", card_kicker: "Example County, NC · Rezoning · RZ-2026-000",
      head: "Example County rezoning to light industrial use", sub: "Board of Commissioners · roll call from the meeting record",
      stamp: "APPROVED 5–0", note: null, src: "Board of Commissioners · roll call from the meeting record · Documented",
      seats: ["A. One", "B. Two", "C. Three", "D. Four", "E. Five"].map((name) => ({ name, vote: "yes" })),
      outcome: "approved", tier: "Documented",
    },
  };
  const strip = [
    { date: "2026-10-19", yes: 5, no: 0, this_case: true },
    { date: "2026-07-20", yes: 5, no: 0 },
    { date: "2026-06-01", yes: 5, no: 0 },
    { date: "2026-06-01", yes: 5, no: 0 },
    { date: "2025-09-02", yes: 4, no: 0 },
    { date: "2025-03-17", yes: 5, no: 0 },
    { date: "2024-11-18", yes: 3, no: 2 },
  ];
  const v2 = v2Part("NC", "North Carolina", "2026-10-26", ["37179", "37119"]);
  return {
    ...v2,
    v3: {
      schema: "fieldstate.weekly_video.v3", state: "NC", week_of: "2026-10-26",
      cold_open: {
        kind: "streak_without_no",
        cap: "Not one no vote in 23 months: the Example County Board of Commissioners, 6 recorded votes in a row, on the votes we hold.",
        voice: "Not one no vote in twenty-three months: the Example County Board of Commissioners, six recorded votes in a row, on the votes we hold.",
        basis: { streak: 6, months: 23, votes_shown: 7, votes_total: 9 }, coverage_ok: false,
        lines: [line(
          "Not one no vote in 23 months: the Example County Board of Commissioners, 6 recorded votes in a row, on the votes we hold.",
          "Not one no vote in twenty-three months: the Example County Board of Commissioners, six recorded votes in a row, on the votes we hold.")],
        screen: {
          kicker: "Example County · Board of Commissioners", hook: "Not one no vote in 23 months",
          sub: "The Example County Board of Commissioners, 6 recorded votes in a row, on the votes we hold.",
          src: "Last no vote Nov 18, 2024 (3–2) · Documented",
        },
      },
      lead: {
        what,
        why_matters: {
          cap: "x", voice: "x", coverage_ok: false,
          basis: { votes: 7, unanimous: 6, since_month: "November 2024", strip },
          lines: [
            line("The Example County Board of Commissioners: 6 of 7 recorded votes since November 2024 had no vote against, on the votes we hold.",
              "The Example County Board of Commissioners: six of seven recorded votes since November twenty twenty-four had no vote against, on the votes we hold."),
            line("The last divided vote, on the votes we hold, was in November 2024: 3–2.",
              "The last divided vote, on the votes we hold, was in November twenty twenty-four: three to two."),
          ],
          screen: {
            kicker: "Why it matters", count: 6, label: ["of 7 recorded votes since November 2024", "had no vote against"],
            src: "Each mark is one recorded vote by the Example County Board of Commissioners on Fieldstate's record, on the votes we hold · Documented",
          },
        },
        why_decided: {
          quote: "Because of these aspects of the development, staff recommend approval of this rezoning application.",
          document: "staff_report", page: 8, date: "2026-10-19", source: "staff_recommendation", names_reasons: false,
          lines: [
            line("On page 8 of the staff report, staff recommended approval.", "On page eight of the staff report, staff recommended approval."),
            line("The board agreed, 5–0.", "The board agreed, five to zero."),
          ],
          screen: {
            paper_head: "Example County · Staff report", paper_id: "RZ-2026-000", paper_title: "Staff recommendation",
            quote: "Because of these aspects of the development, staff recommend approval of this rezoning application.",
            page: 8, side_k: "From the record", side_1: "Staff recommended approval.", side_2: "The board agreed, 5–0.",
            side_src: "Example County staff report, p. 8 · Oct 19, 2026", label: "Quoted as posted · retypeset for video",
            card_kicker: null, card_head: null, outcome_line: null,
          },
        },
        no_reason_line: "The record has the vote but not yet the reasons.",
        next: {
          kind: "county_next_meeting", kicker: "Next door", date: "2026-10-26", time: "Time not posted", time_posted: false,
          place: "Example Town, NC", body: "Example Town Council", item_count: 1, within_days: 7,
          lines: [
            line("Next door, the Example Town Council meets on Monday, October 26.", "Next door, the Example Town Council meets on Monday, October twenty-sixth."),
            line("1 item is on the posted agenda.", "One item is on the posted agenda."),
          ],
          screen: { kicker: "Next door", when: ["MON", "Oct 26"], time: "Time not posted", place: "Example Town Council", rows: ["1 item on the posted agenda", "From the posted agenda"] },
        },
        clip: null,
      },
      round: [
        {
          matter_id: 9002, text: "Example City rezoning petition by Example Development LLC", place_short: "Example City",
          outcome: "withdrawn", kind_label: "Zoning", why_chip: null,
          lines: [line("Example City rezoning petition by Example Development LLC: withdrawn.")],
          screen: { text: "Example City rezoning petition by Example Development LLC", outcome_label: "withdrawn", chip: null, place_short: "Example City", kind_label: "Zoning", date_label: "Oct 19" },
        },
      ],
      round_short: true,
      round_layout: "one_at_a_time",
      round_open: { lines: [line("Also decided this week.")], screen: { kicker: "Also decided", src: "From the meeting records · Documented" } },
      wheel: {
        built: ["from_the_record", "long_road"], titles: { from_the_record: "From the record", long_road: "The long road" },
        eligible: [],
        picked: [roadEntry()],
        history: [],
      },
      checks: { lines_ok: 17, lines_dropped: {}, names_scrubbed: 0, round_held: [], lead_held: [] },
    },
  };
}

function roadEntry() {
  const steps = [
    { date: "2025-07-11", date_kind: "event", kind: "first_record", label: "First on the public record",
      line: line("On July 11, 2025, it first appeared on the public record.", "On July eleventh, twenty twenty-five, it first appeared on the public record.") },
    { date: "2026-06-15", date_kind: "event", kind: "deferred", label: "Deferred", tally: "11–0",
      line: line("On June 15, 2026, the Example City Council deferred it, 11–0.", "On June fifteenth, twenty twenty-six, the Example City Council deferred it, eleven to zero.") },
    { date: "2026-09-30", date_kind: "recorded", kind: "withdrawn", label: "Withdrawn",
      line: line("By September 30, 2026, the application file showed it as withdrawn.", "By September thirtieth, twenty twenty-six, the application file showed it as withdrawn.") },
    { date: "2026-10-19", date_kind: "event", kind: "withdrawn", label: "Withdrawn", decision: true,
      line: line("On October 19, 2026, it was withdrawn at the Example City Council.", "On October nineteenth, twenty twenty-six, it was withdrawn at the Example City Council.") },
  ];
  return {
    segment: "long_road", score: 58,
    data: { matter_id: 9002, text: "Example City rezoning petition by Example Development LLC", place: "Example City, NC", months: 15, steps },
    lines: [
      line("In Example City, a rezoning petition by Example Development LLC spent 15 months on the public record, from July 2025 to October 2026.",
        "In Example City, a rezoning petition by Example Development LLC spent fifteen months on the public record, from July twenty twenty-five to October twenty twenty-six."),
      line("It was deferred once."),
      ...steps.map((s) => s.line),
    ],
    screen: {
      title: "The long road", head: "Example City rezoning petition by Example Development LLC", place: "Example City",
      span: "Jul 11, 2025 – Oct 19, 2026", months_label: "15 months",
      steps: [
        { date: "2025-07-11", date_label: "Jul 11, 2025", label: "First on the public record", recorded: false },
        { date: "2026-06-15", date_label: "Jun 15, 2026", label: "Deferred, 11–0", recorded: false },
        { date: "2026-09-30", date_label: "Sep 30, 2026", label: "Withdrawn", recorded: true },
        { date: "2026-10-19", date_label: "Oct 19, 2026", label: "Withdrawn", recorded: false },
      ],
      ident: "The long road",
    },
  };
}

export function txScript() {
  const v2 = v2Part("TX", "Texas", "2026-10-26", ["48113", "48439"]);
  const note = "The record has the vote but not yet the reasons.";
  const item = (id, text, place, outcome, label, kind, chip = null) => ({
    matter_id: id, text, place_short: place, outcome, kind_label: kind, why_chip: chip,
    lines: [line(`${text}: ${label}${chip ? `, ${chip}` : ""}.`)],
    screen: { text, outcome_label: label, chip, place_short: place, kind_label: kind, date_label: "Oct 20" },
  });
  return {
    ...v2,
    v3: {
      schema: "fieldstate.weekly_video.v3", state: "TX", week_of: "2026-10-26",
      cold_open: {
        kind: "denials_body", coverage_ok: true,
        cap: "The Dallas City Council said no twice this week.", voice: "The Dallas City Council said no twice this week.",
        basis: { place: "Dallas, TX", body: "City Council", denials: 2, matter_ids: [9101, 9102] },
        lines: [line("The Dallas City Council said no twice this week.")],
        screen: { kicker: "This week in Texas", hook: "The Dallas City Council said no twice this week", sub: null, src: "From the public record" },
      },
      lead: {
        what: {
          matter_id: 9101, text: "Variance from the alcohol distance rule for an example restaurant", outcome: "denied",
          kind_label: "Variance", place: "Dallas, TX", place_short: "Dallas", date: "2026-10-21", body: "City Council",
          tally: null, roll_call: [],
          lines: [
            line("On October 21, the Dallas City Council denied a variance from the alcohol distance rule for an example restaurant.",
              "On October twenty-first, the Dallas City Council denied a variance from the alcohol distance rule for an example restaurant."),
            line(note),
          ],
          screen: {
            kicker: "What happened · Decided Oct 21", card_kicker: "Dallas, TX · Variance",
            head: "Variance from the alcohol distance rule for an example restaurant", sub: "City Council · from the meeting record",
            stamp: "DENIED", note, src: "City Council · from the meeting record · Documented", seats: [], outcome: "denied", tier: "Documented",
          },
        },
        why_matters: null,
        why_decided: null,
        no_reason_line: note,
        no_reason: { lines: [], placement: "decided_card", skip_record: true, screen: { no_quote: true, note } },
        next: {
          kind: "board_next_meeting", kicker: "What's next in Dallas", date: "2026-10-28", time: "9:00 AM", time_posted: true,
          place: "Dallas, TX", body: "City Council", item_count: 24,
          lines: [
            line("The Dallas City Council meets next on Wednesday, October 28 at 9:00 AM.", "The Dallas City Council meets next on Wednesday, October twenty-eighth at nine in the morning."),
            line("24 items are on the posted agenda.", "Twenty-four items are on the posted agenda."),
          ],
          screen: { kicker: "What's next in Dallas", when: ["WED", "Oct 28"], time: "9:00 AM", place: "Dallas City Council", rows: ["24 items on the posted agenda", "From the posted agenda"] },
        },
        clip: null,
      },
      round: [
        item(9102, "Renaming of an example bridge", "Dallas", "denied", "denied", "Item"),
        item(9103, "Rezoning of 12 acres on Example Road for townhomes", "Fort Worth", "approved", "approved", "Zoning", "split 6–3"),
        item(9104, "Example Street reconstruction contract", "Plano", "approved", "approved", "Contract"),
        item(9105, "Site plan for an example warehouse", "Frisco", "approved_with_conditions", "approved with conditions", "Site plan", "third deferral"),
      ],
      round_short: false,
      round_layout: "highlight",
      round_open: { lines: [line("Also decided this week.")], screen: { kicker: "Also decided", src: "From the meeting records · Documented" } },
      wheel: {
        built: ["from_the_record", "long_road"], titles: { from_the_record: "From the record", long_road: "The long road" },
        eligible: [],
        picked: [
          {
            segment: "from_the_record", score: 41,
            data: {
              matter_id: 9201, text: "Special sign district at 100 Example Avenue", place: "Dallas, TX", case_number: "SD-26-000",
              outcome: "approved", decision_date: "2026-10-14", quote: "Staff recommends approval of the special sign district, subject to conditions.",
              document: "staff_report", page: 1, source: "staff_recommendation", names_reasons: false,
            },
            lines: [
              line("From the record, in Dallas: a special sign district at 100 Example Avenue."),
              line("On page 1 of the staff report, staff recommended approval.", "On page one of the staff report, staff recommended approval."),
              line("The board approved it on October 14, 5–0.", "The board approved it on October fourteenth, five to zero."),
            ],
            screen: {
              paper_head: "Dallas · Staff report", paper_id: "SD-26-000", paper_title: "Staff recommendation",
              quote: "Staff recommends approval of the special sign district, subject to conditions.", page: 1,
              side_k: "From the record", side_1: "Staff recommended approval.", side_2: "The board approved it on October 14, 5–0.",
              side_src: "Dallas staff report, p. 1 · Oct 14, 2026", label: "Quoted as posted · retypeset for video",
              card_kicker: "Dallas · Sign district · SD-26-000", card_head: "Special sign district at 100 Example Avenue",
              outcome_line: "The board approved it on October 14, 5–0.", ident: "From the record",
            },
          },
          { segment: "scoreboard", score: 30, data: { matter_id: 9301 }, lines: [line("A segment the template does not know.")], screen: { ident: "The scoreboard" } },
        ],
        history: [{ week_of: "2026-10-19", picked: ["long_road"], ran: true }],
      },
      checks: { lines_ok: 14, lines_dropped: {}, names_scrubbed: 0, round_held: [], lead_held: [] },
    },
  };
}

/** A clip as lib/clip.mjs hands it on: the engine's lead.clip shape, synthetic. */
export function syntheticClip() {
  return {
    src: "https://example.swagit.com/videos/123", media_start: 130, duration: 17, result_at_s: 15,
    captions: [
      { start: 0.4, end: 3.2, text: "I move to approve item 7 as presented." },
      { start: 3.4, end: 5.0, text: "Second." },
      { start: 13.2, end: 15.4, text: "Motion passes 5-1." },
    ],
    credit: "Video: City of Example", tally: "5–1", outcome: "approved", spoken_result: "passes 5-1",
    status: "first_read", label: "Unconfirmed · from the meeting video", lines: [],
    screen: { lower_third: "Example · Planning and Zoning Commission", stamp: "5–1", label: "Unconfirmed · from the meeting video", credit: "Video: City of Example" },
  };
}

/** The script with v3 at the top (how the engine turns v3 on). */
export function asV3Schema(script) {
  return { ...script, schema: "fieldstate.weekly_video.v3" };
}
