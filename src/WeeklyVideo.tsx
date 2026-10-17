import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C, geist, newsreader } from "./theme";

// Everything on screen comes from the script's `screen` fields, which the
// engine filled from the record (sie.serve.weekly_video). Nothing is added
// here but labels.

type Honor = { kind: string; honoree: string } | null | undefined;
type Screen = {
  title?: string;
  week_label?: string;
  state_name?: string;
  label?: string;
  count?: number;
  meetings?: number;
  range?: string[];
  place?: string;
  body?: string | null;
  date?: string;
  date_label?: string;
  time?: string | null;
  outcome?: string;
  text?: string;
  items?: string[];
  n_items?: number;
  honor?: Honor;
  site?: string;
};

export type TimedScene = {
  id: string;
  kind: string;
  voice: string;
  screen?: Screen;
  case_ids?: string[];
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

const OUTCOME_LABEL: Record<string, string> = {
  approved: "Approved",
  approved_with_conditions: "Approved with conditions",
  denied: "Denied",
  withdrawn: "Withdrawn",
};

const HONOR_LABEL: Record<string, string> = {
  resolution: "Resolution",
  proclamation: "Proclamation",
  award: "Award",
  induction: "Induction",
  recognition: "Recognition",
  memorial: "Memorial resolution",
};

function useEnter(delay = 0) {
  const frame = useCurrentFrame();
  const t = interpolate(frame - delay, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return { opacity: t, transform: `translateY(${(1 - t) * 24}px)` };
}

const Label: React.FC<{ children: React.ReactNode; tone?: "live" | "muted" }> = ({ children, tone = "live" }) => (
  <div
    style={{
      fontFamily: geist,
      fontWeight: 600,
      fontSize: 30,
      letterSpacing: 2,
      textTransform: "uppercase",
      color: tone === "live" ? C.liveDeep : C.muted,
    }}
  >
    {children}
  </div>
);

const Chip: React.FC<{ children: React.ReactNode; solid?: boolean }> = ({ children, solid }) => (
  <span
    style={{
      display: "inline-block",
      fontFamily: geist,
      fontWeight: 500,
      fontSize: 30,
      padding: "8px 22px",
      borderRadius: 999,
      border: `2px solid ${C.ink}`,
      background: solid ? C.ink : "transparent",
      color: solid ? "#fff" : C.ink,
      marginRight: 16,
    }}
  >
    {children}
  </span>
);

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ padding: "150px 140px 230px", justifyContent: "center" }}>{children}</AbsoluteFill>
);

const Where: React.FC<{ s: Screen }> = ({ s }) => {
  const a = useEnter(0);
  return (
    <div style={a}>
      <Label>{s.place}</Label>
      {s.body ? (
        <div style={{ fontFamily: geist, fontSize: 40, color: C.body, marginTop: 10 }}>{s.body}</div>
      ) : null}
    </div>
  );
};

const RecordText: React.FC<{ text: string; size?: number; delay?: number }> = ({ text, size = 62, delay = 6 }) => {
  const a = useEnter(delay);
  return (
    <div
      style={{
        ...a,
        fontFamily: newsreader,
        fontSize: size,
        lineHeight: 1.18,
        color: C.ink,
        marginTop: 34,
        display: "-webkit-box",
        WebkitLineClamp: 4,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}
    >
      {text}
    </div>
  );
};

const TitleScene: React.FC<{ s: Screen; title: string }> = ({ s, title }) => {
  const a = useEnter(0);
  const b = useEnter(10);
  const head = title.split(" · ")[0];
  return (
    <Card>
      <div style={a}>
        <div style={{ width: 120, height: 10, background: C.live, marginBottom: 40 }} />
        <div style={{ fontFamily: newsreader, fontSize: 112, lineHeight: 1.04, color: C.ink }}>{head}</div>
      </div>
      <div style={{ ...b, marginTop: 36, fontFamily: geist, fontSize: 40, color: C.body }}>
        {s.week_label} &middot; from the public record
      </div>
    </Card>
  );
};

const SectionScene: React.FC<{ s: Screen }> = ({ s }) => {
  const a = useEnter(0);
  const b = useEnter(8);
  const range = s.range && s.range.length === 2 ? `${fmtDay(s.range[0])} – ${fmtDay(s.range[1])}` : "";
  return (
    <Card>
      <div style={a}>
        <div style={{ fontFamily: newsreader, fontSize: 120, color: C.ink }}>{s.label}</div>
      </div>
      <div style={{ ...b, marginTop: 28, fontFamily: geist, fontSize: 40, color: C.body }}>
        {range}
        {typeof s.count === "number" && s.label === "The week behind" ? ` · ${s.count} decided` : ""}
        {typeof s.count === "number" && s.label === "The week ahead"
          ? ` · ${s.count} on posted agendas`
          : ""}
      </div>
    </Card>
  );
};

const DecisionScene: React.FC<{ s: Screen }> = ({ s }) => (
  <Card>
    <Where s={s} />
    <div style={{ marginTop: 30, ...useEnter(4) }}>
      <Chip solid>{OUTCOME_LABEL[s.outcome ?? ""] ?? "Decided"}</Chip>
      <Chip>{s.date_label}</Chip>
      {s.honor ? <Chip>{HONOR_LABEL[s.honor.kind] ?? "Honor"}</Chip> : null}
    </div>
    <RecordText text={s.text ?? ""} />
  </Card>
);

const AgendaScene: React.FC<{ s: Screen }> = ({ s }) => {
  const items = s.items ?? [];
  const more = (s.n_items ?? items.length) - items.length;
  const chips = useEnter(4);
  const moreStyle = useEnter(30);
  return (
    <Card>
      <Where s={s} />
      <div style={{ marginTop: 30, ...chips }}>
        <Chip solid>On the agenda</Chip>
        <Chip>
          {s.date_label}
          {s.time ? ` · ${s.time}` : ""}
        </Chip>
      </div>
      <div style={{ marginTop: 34 }}>
        {items.map((t, i) => (
          <AgendaLine key={i} text={t} delay={8 + i * 8} />
        ))}
        {more > 0 ? (
          <div style={{ fontFamily: geist, fontSize: 34, color: C.muted, marginTop: 18, ...moreStyle }}>
            + {more} more on the posted agenda
          </div>
        ) : null}
        {items.length === 0 ? (
          <div style={{ fontFamily: geist, fontSize: 40, color: C.body }}>
            {s.n_items} {s.n_items === 1 ? "item" : "items"} on the posted agenda
          </div>
        ) : null}
      </div>
    </Card>
  );
};

const AgendaLine: React.FC<{ text: string; delay: number }> = ({ text, delay }) => (
  <div
    style={{
      ...useEnter(delay),
      fontFamily: newsreader,
      fontSize: 46,
      lineHeight: 1.2,
      color: C.ink,
      borderLeft: `6px solid ${C.live}`,
      paddingLeft: 26,
      marginBottom: 22,
      display: "-webkit-box",
      WebkitLineClamp: 2,
      WebkitBoxOrient: "vertical",
      overflow: "hidden",
    }}
  >
    {text}
  </div>
);

const StatusScene: React.FC<{ s: Screen; chip: string; line: string }> = ({ s, chip, line }) => (
  <Card>
    <Where s={s} />
    <div style={{ marginTop: 30, ...useEnter(4) }}>
      <Chip solid>{chip}</Chip>
      <Chip>{s.date_label}</Chip>
    </div>
    <RecordText text={line} size={54} />
  </Card>
);

const ShoutoutScene: React.FC<{ s: Screen }> = ({ s }) => (
  <Card>
    <div style={useEnter(0)}>
      <Label>A shout-out from the record</Label>
    </div>
    <div style={{ ...useEnter(6), fontFamily: newsreader, fontSize: 104, color: C.ink, marginTop: 30 }}>
      {s.honor?.honoree}
    </div>
    <div style={{ ...useEnter(12), fontFamily: geist, fontSize: 40, color: C.body, marginTop: 24 }}>
      {HONOR_LABEL[s.honor?.kind ?? ""] ?? "Honor"} &middot; {s.place}
      {s.body ? ` · ${s.body}` : ""} &middot; {s.date_label}
    </div>
  </Card>
);

const OutroScene: React.FC = () => (
  <Card>
    <div style={useEnter(0)}>
      <div style={{ fontFamily: geist, fontWeight: 600, fontSize: 96, color: C.ink }}>fieldstate.org</div>
    </div>
    <div style={{ ...useEnter(8), fontFamily: newsreader, fontSize: 52, color: C.body, marginTop: 24 }}>
      Every case links to the documents it came from.
    </div>
  </Card>
);

function fmtDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

const SceneView: React.FC<{ scene: TimedScene; title: string }> = ({ scene, title }) => {
  const s = scene.screen ?? {};
  switch (scene.kind) {
    case "title":
      return <TitleScene s={s} title={title} />;
    case "section":
      return <SectionScene s={s} />;
    case "decision":
      return <DecisionScene s={s} />;
    case "agenda":
      return <AgendaScene s={s} />;
    case "no_agenda":
      return <StatusScene s={s} chip="Agenda not posted yet" line="A meeting is on the record. Its agenda isn't posted yet." />;
    case "late":
      return <StatusScene s={s} chip="Result not on the record yet" line="This board met. The result isn't on the record yet." />;
    case "shoutout":
      return <ShoutoutScene s={s} />;
    case "outro":
      return <OutroScene />;
    default:
      return null;
  }
};

const Chrome: React.FC<{ title: string }> = ({ title }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <div style={{ position: "absolute", top: 56, left: 140, right: 140, display: "flex", justifyContent: "space-between" }}>
      <div style={{ fontFamily: geist, fontWeight: 600, fontSize: 34, color: C.ink, letterSpacing: 0.5 }}>Fieldstate</div>
      <div style={{ fontFamily: geist, fontSize: 28, color: C.muted }}>{title}</div>
    </div>
  </AbsoluteFill>
);

const Captions: React.FC<{ cues: Cue[] }> = ({ cues }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cue = cues.find((c) => t >= c.start && t <= c.end + 0.15);
  if (!cue) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 70 }}>
      <div
        style={{
          fontFamily: geist,
          fontWeight: 500,
          fontSize: 44,
          color: "#fff",
          background: "rgba(10,37,64,0.88)",
          padding: "12px 28px",
          borderRadius: 10,
          maxWidth: 1500,
          textAlign: "center",
        }}
      >
        {cue.text}
      </div>
    </AbsoluteFill>
  );
};

const Progress: React.FC<{ total: number }> = ({ total }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end" }}>
      <div style={{ height: 8, width: `${(frame / Math.max(1, total)) * 100}%`, background: C.live }} />
    </AbsoluteFill>
  );
};

export const WeeklyVideo: React.FC<VideoProps> = ({ script, scenes, cues, totalFrames }) => (
  <AbsoluteFill style={{ background: C.bg }}>
    <Chrome title={script.title} />
    {scenes.map((scene) => (
      <Sequence key={scene.id} from={scene.from} durationInFrames={scene.durationInFrames}>
        <SceneView scene={scene} title={script.title} />
        {scene.audio ? (
          <Sequence from={scene.audioFrom}>
            <Audio src={staticFile(scene.audio)} />
          </Sequence>
        ) : null}
      </Sequence>
    ))}
    <Captions cues={cues} />
    <Progress total={totalFrames} />
  </AbsoluteFill>
);
