import React from "react";
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import mapData from "./nc-counties.json";
import { C, geist } from "./theme";

// The North Carolina county map from the Oct 14 pilot: counties draw on
// west to east, the places we read pop in as dots, and the counties a scene
// is about fill gold and pulse with a label. Shapes: U.S. Census county
// boundaries via the us-atlas package (public domain); ids are county FIPS.

type County = { id: string; name: string; d: string; x: number; y: number };
type MapFile = { viewBox: string; counties: County[] };

const map = mapData as MapFile;
const [, , vbW, vbH] = map.viewBox.split(" ").map(Number);
const byName = new Map(map.counties.map((c) => [c.name.toLowerCase(), c]));
const byId = new Map(map.counties.map((c) => [c.id, c]));

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.22, 1, 0.36, 1);

/** County for a FIPS code ("37183") or a county name ("Wake"). */
export function countyFor(key?: string | null): County | undefined {
  if (!key) return undefined;
  return byId.get(key) ?? byName.get(key.trim().toLowerCase().replace(/ county$/, ""));
}

export type Pulse = { key: string; label?: string | null; at?: number };

export const NCMap: React.FC<{
  width: number;
  /** Counties filled gold (FIPS or names). */
  highlight?: Array<string | null | undefined>;
  /** Counties with a place we read nightly (FIPS): a dot each. */
  dots?: string[];
  /** Pulsing pins with a label. `at` is in frames from the scene start. */
  pulses?: Pulse[];
  drawAt?: number;
  dotsAt?: number;
  dim?: boolean;
}> = ({ width, highlight = [], dots = [], pulses = [], drawAt = 0, dotsAt = 18, dim = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const height = (width * vbH) / vbW;
  const lit = new Set(highlight.map((k) => countyFor(k)?.id).filter(Boolean) as string[]);
  const dotCounties = [...new Set(dots)].map((id) => byId.get(id)).filter(Boolean) as County[];
  return (
    <div style={{ position: "relative", width, height }}>
      <svg viewBox={map.viewBox} width={width} height={height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        {map.counties.map((c) => {
          const sweep = interpolate(frame, [drawAt + (c.x / 100) * 30, drawAt + (c.x / 100) * 30 + 14], [0, 1], { ...clamp, easing: ease });
          const on = lit.has(c.id);
          const fillOn = on ? interpolate(frame, [drawAt + 20, drawAt + 34], [0, 1], clamp) : 0;
          return (
            <path
              key={c.id}
              d={c.d}
              fill={on ? `rgba(240,166,43,${0.78 * fillOn})` : dim ? "rgba(255,255,255,.035)" : "rgba(255,255,255,.06)"}
              stroke={on ? C.live : `rgba(255,255,255,${0.3 * sweep})`}
              strokeWidth={on ? 1.6 : 0.7}
              opacity={sweep}
            />
          );
        })}
      </svg>
      {dotCounties.map((c, i) => {
        const s = spring({ frame: frame - Math.round(dotsAt + (c.x / 100) * 26 + (i % 7)), fps, config: { damping: 10, stiffness: 140, mass: 0.7 } });
        const twinkle = i % 5 === 2 ? 0.55 + 0.45 * Math.sin(frame / 12 + i) : 1;
        return (
          <div
            key={`dot-${c.id}`}
            style={{
              position: "absolute", left: `${c.x}%`, top: `${c.y}%`, width: 11, height: 11, marginLeft: -5.5, marginTop: -5.5,
              borderRadius: 11, background: C.live, boxShadow: "0 0 14px rgba(240,166,43,.75)", transform: `scale(${s})`, opacity: twinkle,
            }}
          />
        );
      })}
      {pulses.map((p, i) => {
        const c = countyFor(p.key);
        if (!c) return null;
        const at = p.at ?? 12 + i * 10;
        if (frame < at) return null;
        const k = ((frame - at) % 48) / 48;
        const s = spring({ frame: frame - at, fps, config: { damping: 9, stiffness: 140, mass: 0.7 } });
        return (
          <React.Fragment key={`pulse-${c.id}-${i}`}>
            <div style={{ position: "absolute", left: `${c.x}%`, top: `${c.y}%`, width: 70, height: 70, marginLeft: -35, marginTop: -35, borderRadius: 70, border: `3px solid ${C.live}`, transform: `scale(${0.3 + k * 1.2})`, opacity: 1 - k }} />
            <div style={{ position: "absolute", left: `${c.x}%`, top: `${c.y}%`, width: 22, height: 22, marginLeft: -11, marginTop: -11, borderRadius: 22, background: C.live, boxShadow: "0 0 24px rgba(240,166,43,.9)", transform: `scale(${s})` }} />
            {p.label ? (
              <div
                style={{
                  position: "absolute", left: `${c.x}%`, top: `${c.y}%`, transform: `translate(${c.x > 70 ? -260 : 22}px, ${i % 2 ? 26 : -54}px)`,
                  opacity: s, whiteSpace: "nowrap", fontFamily: geist, fontWeight: 600, fontSize: 26, color: C.white,
                  background: "rgba(10,37,64,.82)", border: "1px solid rgba(255,255,255,.18)", borderRadius: 10, padding: "6px 14px",
                }}
              >
                {p.label}
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export const MAP_ASPECT = vbH / vbW;
