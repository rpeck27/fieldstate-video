import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { NCMap, type Pulse } from "./NCMap";
import { photoFor, type PhotoCredit } from "./photos";
import { C, geist, newsreader, newsreaderItalic } from "./theme";

// The look of the Oct 14 pilot (rpeck27/fieldstate-site, claude/video-pilot,
// tools/video/src/Week.jsx), driven by the engine's script: a drifting navy
// wash, the county map that draws on with the places we read, case cards
// that spring in with an outcome stamp, agenda cards with the posted date and
// time, counters, a brand bar, burned-in captions. Every scene has motion
// while the voice runs. Everything said or printed comes from the script.

type Item = {
  text?: string;
  outcome?: string | null;
  kind?: string | null;
  kind_label?: string;
  figure?: string | null;
  tier?: string;
  tally?: string | null;
  place?: string;
  place_short?: string;
  county?: string | null;
  fips?: string | null;
  date_label?: string;
};

type Screen = {
  title?: string;
  week_label?: string;
  state_name?: string;
  kicker?: string | null;
  headline?: string;
  note?: string;
  place?: string;
  body?: string | null;
  date?: string;
  date_label?: string;
  time?: string | null;
  county?: string | null;
  counties?: Array<string | null>;
  places?: string[];
  fips?: string | string[] | null;
  read_fips?: string[];
  places_read?: number;
  when?: string[];
  items?: Array<string | Item>;
  n_items?: number;
  count?: number;
  figure?: { value: number; label: string; format?: string } | null;
  site?: string;
  text?: string;
};

export type TimedScene = {
  id: string;
  kind: string;
  voice: string;
  screen?: Screen;
  from: number;
  durationInFrames: number;
  audio: string | null;
  audioFrom: number;
};

export type Cue = { start: number; end: number; text: string };

export type VideoProps = {
  script: { title: string; state: string; state_name?: string; week_of: string };
  fps: number;
  totalFrames: number;
  durationS: number;
  scenes: TimedScene[];
  cues: Cue[];
};

const OUTCOME: Record<string, string> = {
  approved: "Approved",
  approved_with_conditions: "Approved with conditions",
  denied: "Denied",
  withdrawn: "Withdrawn",
  failed: "Voted down",
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.22, 1, 0.36, 1);

function inn(frame: number, at: number, dur = 18) {
  return interpolate(frame, [at, at + dur], [0, 1], { ...clamp, easing: ease });
}

function usePop(at: number, damping = 14) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - Math.round(at), fps, config: { damping, stiffness: 140, mass: 0.7 } });
}

function cap1(text?: string): string | undefined {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function asItem(item: string | Item): Item {
  const it = typeof item === "string" ? { text: item } : item;
  return { ...it, text: cap1(it.text) };
}

function list(v: string | string[] | null | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}

/** Map keys for a screen: FIPS first, county names as a fallback. */
function mapKeys(s: Screen): string[] {
  const f = list(s.fips);
  if (f.length) return f;
  const names = (s.counties ?? []).filter(Boolean) as string[];
  if (names.length) return names;
  return s.county ? [s.county] : [];
}

/** When each of `n` cards lands: spread across the voice of this scene. */
function cardTimes(n: number, scene: TimedScene, fps: number): number[] {
  const start = scene.audioFrom + Math.round(fps * 0.9);
  const span = Math.max(fps, scene.durationInFrames - start - fps * 1.4);
  return Array.from({ length: n }, (_, i) => start + Math.round((span * i) / Math.max(1, n)));
}

// ── shared pieces ──────────────────────────────────────────────────────────

const Wash: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const a = 20 + Math.sin(t / 6) * 8;
  const b = 78 + Math.cos(t / 7) * 8;
  const c = 60 + Math.sin(t / 5 + 1) * 10;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(55% 50% at ${a}% 30%, rgba(124,92,255,.30), transparent 62%),
          radial-gradient(45% 45% at ${b}% 18%, rgba(240,166,43,.24), transparent 62%),
          radial-gradient(45% 40% at ${c}% 85%, rgba(14,133,96,.22), transparent 62%), ${C.navy}`,
      }}
    />
  );
};

const Wordmark: React.FC<{ size?: number }> = ({ size = 34 }) => (
  <span style={{ fontFamily: geist, fontWeight: 700, fontSize: size, letterSpacing: "-.01em", color: C.white, lineHeight: 1 }}>
    field<span style={{ color: C.live }}>state</span>
  </span>
);

const Kicker: React.FC<{ children: React.ReactNode; at?: number; color?: string }> = ({ children, at = 0, color = C.live }) => {
  const frame = useCurrentFrame();
  const k = inn(frame, at);
  return (
    <div style={{ fontFamily: geist, fontWeight: 600, fontSize: 24, letterSpacing: ".14em", textTransform: "uppercase", color, opacity: k, transform: `translateY(${(1 - k) * 16}px)` }}>
      {children}
    </div>
  );
};

const Chip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ fontFamily: geist, fontWeight: 500, fontSize: 22, color: C.white, border: "1px solid rgba(255,255,255,.22)", background: "rgba(255,255,255,.06)", borderRadius: 999, padding: "9px 18px" }}>
    {children}
  </span>
);

const Tag: React.FC<{ tier?: string }> = ({ tier = "Documented" }) => {
  const reported = tier !== "Documented";
  const tone = reported ? [C.reported, C.reportedSoft, "#ddd4ff"] : [C.doc, C.docSoft, "#c9eedf"];
  return (
    <span style={{ fontFamily: geist, fontWeight: 600, fontSize: 17, padding: "5px 12px", borderRadius: 999, color: tone[0], background: tone[1], border: `1px solid ${tone[2]}`, display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
      <span style={{ width: 8, height: 8, borderRadius: 8, background: tone[0] }} />
      {tier}
    </span>
  );
};

/** A photo with a slow Ken Burns move and its credit, as in the pilot. */
const Photo: React.FC<{ photo: PhotoCredit; label?: string; style: React.CSSProperties }> = ({ photo, label, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const z = interpolate(frame, [0, fps * 16], [1.04, 1.16], clamp);
  const x = interpolate(frame, [0, fps * 16], [0, -3], clamp);
  return (
    <div style={{ position: "absolute", overflow: "hidden", ...style }}>
      <Img src={staticFile(photo.file)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${z}) translateX(${x}%)` }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(10,37,64,0) 45%, rgba(10,37,64,.92) 100%), linear-gradient(0deg, rgba(10,37,64,.75) 0%, rgba(10,37,64,0) 40%)" }} />
      {label ? <div style={{ position: "absolute", left: 48, bottom: 170, fontFamily: newsreader, fontSize: 64, fontWeight: 600, color: C.white }}>{label}</div> : null}
      <div style={{ position: "absolute", left: 48, bottom: 138, fontFamily: geist, fontSize: 18, color: C.dim }}>{photo.credit}</div>
    </div>
  );
};

/** Left pane of a place scene: the place's photo when we have a licensed
 *  one, else the drawn map with the scene's counties lit and pulsing. */
const PlacePane: React.FC<{ s: Screen; keys: string[]; labels: Array<string | undefined> }> = ({ s, keys, labels }) => {
  const photo = photoFor(s.place, s.county);
  if (photo) {
    return <Photo photo={photo} label={s.place?.replace(/, [A-Z]{2}$/, "")} style={{ left: 0, top: 0, width: 1000, height: 1080 }} />;
  }
  const pulses: Pulse[] = keys.map((k, i) => ({ key: k, label: labels[i] ?? null, at: 14 + i * 16 }));
  return (
    <div style={{ position: "absolute", left: 50, top: 300 }}>
      <NCMap width={860} highlight={keys} pulses={pulses} drawAt={0} dim />
      <div style={{ fontFamily: geist, fontSize: 17, color: C.dim, marginTop: 16 }}>Counties: U.S. Census Bureau, public domain</div>
    </div>
  );
};

/** Big figure that counts up ("4.25 acres", "180 townhomes", "5–2"). */
const Figure: React.FC<{ text: string; at: number }> = ({ text, at }) => {
  const frame = useCurrentFrame();
  const m = text.match(/^([0-9][0-9,]*(?:\.[0-9]+)?)\s*(.*)$/);
  const n = m ? Number(m[1].replace(/,/g, "")) : null;
  const rest = m ? m[2] : "";
  const v = n != null && Number.isFinite(n) ? interpolate(frame, [at, at + 30], [0, n], { ...clamp, easing: ease }) : null;
  const decimals = m?.[1].includes(".") ? m[1].split(".")[1].length : 0;
  const shown = v == null ? text : decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString("en-US");
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
      <div style={{ fontFamily: newsreader, fontWeight: 600, fontSize: 68, lineHeight: 1, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{shown}</div>
      {rest ? <div style={{ fontFamily: geist, fontSize: 24, color: C.body }}>{rest}</div> : null}
    </div>
  );
};

const CaseCard: React.FC<{ item: Item; at: number }> = ({ item, at }) => {
  const s = usePop(at, 16);
  const stamp = usePop(at + 20, 9);
  const out = item.outcome ? OUTCOME[item.outcome] ?? "Decided" : null;
  const ok = item.outcome === "approved" || item.outcome === "approved_with_conditions";
  const head = [item.kind_label, item.place_short].filter(Boolean).join(" · ");
  return (
    <div style={{ background: C.card, borderRadius: 18, padding: "24px 30px 26px", boxShadow: "0 24px 60px rgba(0,0,0,.35)", border: `1px solid ${C.line}`, opacity: s, transform: `translateX(${(1 - s) * 80}px)`, position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <span style={{ fontFamily: geist, fontSize: 19, fontWeight: 600, color: C.muted, letterSpacing: ".06em", textTransform: "uppercase" }}>{head}</span>
        <Tag tier={item.tier} />
      </div>
      {item.figure ? <div style={{ marginTop: 10 }}><Figure text={item.figure} at={at + 6} /></div> : null}
      <div style={{ fontFamily: newsreader, fontSize: 38, fontWeight: 600, color: C.ink, marginTop: 8, lineHeight: 1.15, letterSpacing: "-.01em", paddingRight: out ? 230 : 0, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {item.text}
      </div>
      {out ? (
        <div style={{ position: "absolute", right: 28, bottom: 22, fontFamily: geist, fontWeight: 700, fontSize: 26, letterSpacing: ".04em", color: ok ? C.doc : C.deny, background: ok ? C.docSoft : C.denySoft, border: `2px solid ${ok ? C.doc : C.deny}`, borderRadius: 10, padding: "6px 16px", transform: `scale(${0.6 + 0.4 * stamp}) rotate(${(1 - stamp) * -8}deg)`, opacity: stamp, whiteSpace: "nowrap" }}>
          {out}
          {item.tally ? ` ${item.tally}` : ""}
        </div>
      ) : null}
    </div>
  );
};

// ── scenes ─────────────────────────────────────────────────────────────────

const TitleScene: React.FC<{ s: Screen; title: string }> = ({ s, title }) => {
  const frame = useCurrentFrame();
  const head = (s.state_name || title).replace(/^This week in\s+/i, "");
  const words = head.split(" ");
  const k = inn(frame, 6, 24);
  const k2 = inn(frame, 40, 24);
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", right: 60, top: 260 }}>
        <NCMap width={1080} dots={s.read_fips ?? []} drawAt={2} dotsAt={30} />
      </div>
      <div style={{ position: "absolute", left: 110, top: 300, width: 900 }}>
        <Kicker at={6}>{s.kicker || "This week in"}</Kicker>
        <div style={{ fontFamily: newsreader, fontWeight: 600, fontSize: 150, lineHeight: 0.98, letterSpacing: "-.025em", color: C.white, marginTop: 18, opacity: k, transform: `translateY(${(1 - k) * 40}px)` }}>
          {words.length > 1 ? (<>{words[0]}<br />{words.slice(1).join(" ")}</>) : head}
        </div>
        <div style={{ fontFamily: geist, fontSize: 34, lineHeight: 1.35, color: C.dim, marginTop: 34, maxWidth: 680, opacity: k2, transform: `translateY(${(1 - k2) * 20}px)` }}>
          What local boards decided, and what comes next. From the public record.
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 34, opacity: inn(frame, 70) }}>
          {s.week_label ? <Chip>{s.week_label}</Chip> : null}
          {s.places_read ? <Chip>{s.places_read} places read nightly</Chip> : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const DecisionsScene: React.FC<{ s: Screen; scene: TimedScene }> = ({ s, scene }) => {
  const { fps } = useVideoConfig();
  const items = (s.items ?? []).map(asItem);
  const at = cardTimes(items.length, scene, fps);
  const keys = mapKeys(s);
  const places = [...new Set(items.map((i) => i.place_short).filter(Boolean))] as string[];
  const headline = places.length === 1 ? places[0] : places.join(" · ");
  return (
    <AbsoluteFill>
      <PlacePane s={s} keys={keys} labels={places} />
      <div style={{ position: "absolute", left: 980, top: 130, width: 860 }}>
        <Kicker at={4}>{s.kicker || "Decided"}</Kicker>
        <div style={{ fontFamily: newsreader, fontSize: 60, fontWeight: 600, color: C.white, lineHeight: 1.05, marginTop: 12, letterSpacing: "-.015em" }}>{headline}</div>
        <div style={{ fontFamily: geist, fontSize: 19, color: C.dim, marginTop: 12 }}>
          {s.note || "From the public record"}
        </div>
        <div style={{ display: "grid", gap: 20, marginTop: 28 }}>
          {items.map((item, i) => (
            <CaseCard key={i} item={item} at={at[i]} />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Counter: React.FC<{ value: number; label: string; at?: number }> = ({ value, label, at = 10 }) => {
  const frame = useCurrentFrame();
  const v = interpolate(frame, [at, at + 40], [0, value], { ...clamp, easing: ease });
  const k = inn(frame, at, 14);
  return (
    <div style={{ opacity: k, transform: `translateY(${(1 - k) * 24}px)` }}>
      <div style={{ fontFamily: newsreader, fontWeight: 600, fontSize: 140, lineHeight: 1, color: C.live, letterSpacing: "-.02em", fontVariantNumeric: "tabular-nums" }}>
        {Math.round(v).toLocaleString("en-US")}
      </div>
      <div style={{ fontFamily: geist, fontSize: 28, color: C.dim, marginTop: 8 }}>{label}</div>
    </div>
  );
};

const StoryScene: React.FC<{ s: Screen }> = ({ s }) => {
  const frame = useCurrentFrame();
  const keys = mapKeys(s);
  const labels = (s.places ?? []).map((p) => p.replace(/, [A-Z]{2}$/, ""));
  const k = inn(frame, 8, 22);
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 60, top: 280 }}>
        <NCMap width={980} highlight={keys} pulses={keys.map((key, i) => ({ key, label: labels[i], at: 20 + i * 14 }))} dim />
      </div>
      <div style={{ position: "absolute", left: 1120, right: 100, top: 300 }}>
        <Kicker at={2}>{s.kicker || "This week"}</Kicker>
        <div style={{ fontFamily: newsreader, fontWeight: 600, fontSize: 76, lineHeight: 1.04, marginTop: 18, color: C.white, opacity: k, transform: `translateY(${(1 - k) * 30}px)` }}>
          {s.headline}
        </div>
        {s.figure ? <div style={{ marginTop: 40 }}><Counter value={s.figure.value} label={s.figure.label} at={26} /></div> : null}
      </div>
    </AbsoluteFill>
  );
};

const AgendaCard: React.FC<{ s: Screen; items: Item[]; at: number; itemAt: number[] }> = ({ s, items, at, itemAt }) => {
  const frame = useCurrentFrame();
  const p = usePop(at, 15);
  const more = Math.max(0, (s.n_items ?? items.length) - items.length);
  return (
    <div style={{ display: "flex", background: C.card, borderRadius: 20, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,.4)", opacity: p, transform: `translateY(${(1 - p) * 60}px)` }}>
      <div style={{ width: 230, background: C.navy2, color: C.white, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "22px 0", borderRight: `4px solid ${C.live}` }}>
        <div style={{ fontFamily: geist, fontWeight: 700, fontSize: 24, letterSpacing: ".12em", color: C.live }}>{s.when?.[0]}</div>
        <div style={{ fontFamily: newsreader, fontWeight: 600, fontSize: 56, lineHeight: 1.1, whiteSpace: "nowrap", margin: "4px 0" }}>{s.when?.[1]}</div>
        {s.time ? <div style={{ fontFamily: geist, fontWeight: 600, fontSize: 24, color: C.dim }}>{s.time}</div> : null}
      </div>
      <div style={{ padding: "24px 30px", flex: 1 }}>
        <div style={{ fontFamily: newsreader, fontWeight: 600, fontSize: 40, color: C.ink, letterSpacing: "-.01em", lineHeight: 1.1 }}>
          {s.place?.replace(/, [A-Z]{2}$/, "")} {s.body ? <span style={{ color: C.body }}>{s.body}</span> : null}
        </div>
        <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
          {items.map((it, i) => {
            const on = inn(frame, itemAt[i], 16);
            return (
              <div key={i} style={{ opacity: on, transform: `translateX(${(1 - on) * 30}px)` }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14, fontFamily: geist, fontSize: 28, color: C.body, lineHeight: 1.3 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 10, background: C.live, flex: "none", marginTop: 13 }} />
                  <span>
                    {it.kind_label && it.kind_label !== "Item" ? <b style={{ color: C.ink }}>{it.kind_label}: </b> : null}
                    {it.text}
                  </span>
                </div>
                {it.figure ? <div style={{ marginLeft: 24, marginTop: 6 }}><Figure text={it.figure} at={itemAt[i] + 6} /></div> : null}
              </div>
            );
          })}
          {more > 0 ? <div style={{ fontFamily: geist, fontSize: 20, color: C.muted, opacity: inn(frame, itemAt[itemAt.length - 1] + 20) }}>+ {more} more on the posted agenda</div> : null}
        </div>
      </div>
    </div>
  );
};

const AgendaScene: React.FC<{ s: Screen; scene: TimedScene }> = ({ s, scene }) => {
  const { fps } = useVideoConfig();
  const items = (s.items ?? []).map(asItem);
  const keys = mapKeys(s);
  const at = scene.audioFrom + Math.round(fps * 0.4);
  const itemAt = cardTimes(items.length, scene, fps).map((x) => x + Math.round(fps * 0.8));
  const photo = photoFor(s.place, s.county);
  return (
    <AbsoluteFill>
      {photo ? <div style={{ opacity: 0.32 }}><Photo photo={photo} style={{ left: 0, top: 0, width: 1920, height: 1080 }} /></div> : null}
      <div style={{ position: "absolute", left: 110, top: 100 }}>
        <Kicker at={2}>{s.kicker || "Coming up"}</Kicker>
        <div style={{ fontFamily: newsreader, fontWeight: 600, fontSize: 80, color: C.white, letterSpacing: "-.02em", marginTop: 8 }}>On the agenda</div>
      </div>
      <div style={{ position: "absolute", left: 60, top: 380 }}>
        <NCMap width={700} highlight={keys} pulses={keys.map((key) => ({ key, label: s.place?.replace(/, [A-Z]{2}$/, ""), at: at + 12 }))} dim />
      </div>
      <div style={{ position: "absolute", left: 820, top: 260, width: 1020, display: "grid", gap: 22 }}>
        <AgendaCard s={s} items={items} at={at} itemAt={itemAt} />
        <div style={{ fontFamily: geist, fontSize: 19, color: C.dim }}>From the posted agenda{s.time ? " · time as the agenda lists it" : ""}</div>
      </div>
    </AbsoluteFill>
  );
};

const LegislatureScene: React.FC<{ s: Screen }> = ({ s }) => (
  <AbsoluteFill>
    <div style={{ position: "absolute", right: 80, top: 260, opacity: 0.5 }}>
      <NCMap width={900} dim />
    </div>
    <div style={{ position: "absolute", left: 140, top: 300 }}>
      <Kicker>{s.kicker || "The legislature"}</Kicker>
      {typeof s.count === "number" ? (
        <div style={{ marginTop: 24 }}>
          <Counter value={s.count} label={s.count === 1 ? "tracked bill moved this week" : "tracked bills moved this week"} />
        </div>
      ) : null}
      <div style={{ fontFamily: geist, fontSize: 19, color: C.dim, marginTop: 24 }}>Source: Open States, the General Assembly's bill actions</div>
    </div>
  </AbsoluteFill>
);

const OutroScene: React.FC<{ s: Screen }> = ({ s }) => {
  const frame = useCurrentFrame();
  const a = inn(frame, 3);
  const b = inn(frame, 30);
  const m = usePop(60, 13);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.35 }}>
        <NCMap width={1500} dim drawAt={-20} />
      </div>
      <div style={{ textAlign: "center", position: "relative", marginTop: -80 }}>
        <div style={{ fontFamily: newsreaderItalic, fontStyle: "italic", fontWeight: 500, fontSize: 92, color: C.dim, opacity: a, transform: `translateY(${(1 - a) * 20}px)` }}>We don't predict votes.</div>
        <div style={{ fontFamily: newsreader, fontWeight: 600, fontSize: 112, color: C.white, letterSpacing: "-.02em", opacity: b, transform: `translateY(${(1 - b) * 20}px)` }}>We show you the record.</div>
        <div style={{ marginTop: 70, opacity: m, transform: `scale(${0.8 + 0.2 * m})`, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
          <Wordmark size={84} />
          <div style={{ fontFamily: geist, fontSize: 34, color: C.white, border: "1px solid rgba(255,255,255,.25)", borderRadius: 999, padding: "10px 28px", background: "rgba(255,255,255,.06)" }}>{s.site || "fieldstate.org"}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SceneView: React.FC<{ scene: TimedScene; title: string }> = ({ scene, title }) => {
  const s = scene.screen ?? {};
  switch (scene.kind) {
    case "title":
      return <TitleScene s={s} title={title} />;
    case "decisions":
    case "decision":
      return <DecisionsScene s={s} scene={scene} />;
    case "story":
      return <StoryScene s={s} />;
    case "agenda":
      return <AgendaScene s={s} scene={scene} />;
    case "legislature":
      return <LegislatureScene s={s} />;
    case "outro":
      return <OutroScene s={s} />;
    default:
      return (
        <AbsoluteFill>
          <div style={{ position: "absolute", right: 80, top: 260, opacity: 0.5 }}><NCMap width={900} dim /></div>
          <div style={{ position: "absolute", left: 140, right: 900, top: 320, fontFamily: newsreader, fontSize: 60, color: C.white }}>
            {s.headline || s.text || s.place || ""}
          </div>
        </AbsoluteFill>
      );
  }
};

/** Cross-fade: each scene fades in over its first frames and out over its last. */
const Fade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const frame = useCurrentFrame();
  const o = Math.min(inn(frame, 0, 12), interpolate(frame, [dur - 10, dur], [1, 0], clamp));
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

const Captions: React.FC<{ cues: Cue[]; hideAfter: number }> = ({ cues, hideAfter }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (t >= hideAfter) return null;
  const cue = cues.find((c) => t >= c.start - 0.05 && t <= c.end + 0.2);
  if (!cue) return null;
  const k = interpolate(t, [cue.start - 0.05, cue.start + 0.13], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 44 }}>
      <div style={{ maxWidth: 1500, fontFamily: geist, fontWeight: 600, fontSize: 44, lineHeight: 1.25, color: C.white, background: "rgba(6,24,44,.82)", padding: "14px 30px", borderRadius: 14, textAlign: "center", opacity: k }}>
        {cue.text}
      </div>
    </AbsoluteFill>
  );
};

const BrandBar: React.FC<{ stateName: string; weekLabel: string; hideFrom: number }> = ({ stateName, weekLabel, hideFrom }) => {
  const frame = useCurrentFrame();
  if (frame >= hideFrom) return null;
  return (
    <div style={{ position: "absolute", left: 110, top: 44, display: "flex", alignItems: "center", gap: 18 }}>
      <Wordmark size={30} />
      <span style={{ width: 1, height: 24, background: "rgba(255,255,255,.3)" }} />
      <span style={{ fontFamily: geist, fontSize: 22, color: C.dim }}>{stateName} · {weekLabel}</span>
    </div>
  );
};

export const WeeklyVideo: React.FC<VideoProps> = ({ script, scenes, cues, fps }) => {
  const close = scenes.find((s) => s.kind === "outro");
  const open = scenes.find((s) => s.kind === "title");
  const weekLabel = open?.screen?.week_label || `week of ${script.week_of}`;
  return (
    <AbsoluteFill style={{ background: C.navy }}>
      <Wash />
      {scenes.map((scene) => (
        <Sequence key={scene.id} from={scene.from} durationInFrames={scene.durationInFrames}>
          <Fade dur={scene.durationInFrames}>
            <SceneView scene={scene} title={script.title} />
          </Fade>
          {scene.audio ? (
            <Sequence from={scene.audioFrom}>
              <Audio src={staticFile(scene.audio)} />
            </Sequence>
          ) : null}
        </Sequence>
      ))}
      <BrandBar stateName={script.state_name || script.state} weekLabel={weekLabel} hideFrom={close ? close.from : Infinity} />
      <Captions cues={cues} hideAfter={close ? close.from / fps - 0.1 : Infinity} />
    </AbsoluteFill>
  );
};
