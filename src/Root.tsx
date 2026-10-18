import React from "react";
import { Composition } from "remotion";
import { WeeklyVideo, type VideoProps } from "./WeeklyVideo";

const SAMPLE: VideoProps = {
  script: {
    title: "This week in North Carolina · Oct 19",
    state: "NC",
    state_name: "North Carolina",
    week_of: "2026-10-19",
  },
  fps: 30,
  totalFrames: 150,
  durationS: 5,
  scenes: [
    {
      id: "open",
      kind: "title",
      voice: "This week in North Carolina.",
      screen: {
        title: "This week in North Carolina · Oct 19",
        state_name: "North Carolina",
        week_label: "Week of Oct 19",
        kicker: "This week in",
      },
      from: 0,
      durationInFrames: 90,
      audio: null,
      audioFrom: 9,
    },
    {
      id: "story",
      kind: "story",
      voice: "Data centers are on local agendas.",
      screen: {
        kicker: "This week",
        headline: "Data centers are on local agendas",
        counties: ["Pitt", "Cumberland"],
        figure: { value: 2, label: "places", format: "int" },
      },
      from: 90,
      durationInFrames: 60,
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
    durationInFrames={150}
    defaultProps={SAMPLE}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(1, props.totalFrames),
      fps: props.fps,
    })}
  />
);
