import React from "react";
import { Composition } from "remotion";
import { WeeklyVideo, type VideoProps } from "./WeeklyVideo";

const SAMPLE: VideoProps = {
  script: { title: "The week ahead in North Carolina · Oct 19", state: "NC", state_name: "North Carolina", week_of: "2026-10-19" },
  fps: 30,
  totalFrames: 90,
  durationS: 3,
  scenes: [
    {
      id: "intro",
      kind: "title",
      voice: "This is Fieldstate.",
      screen: { title: "The week ahead in North Carolina · Oct 19", week_label: "Week of Oct 19", state_name: "North Carolina" },
      from: 0,
      durationInFrames: 90,
      audio: null,
      audioFrom: 9,
    },
  ],
  cues: [],
};

export const Root: React.FC = () => (
  <Composition
    id="WeeklyVideo"
    component={WeeklyVideo}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={90}
    defaultProps={SAMPLE}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(1, props.totalFrames),
      fps: props.fps,
    })}
  />
);
