# Translation notes: `src/WeeklyVideo.tsx` (Remotion) → `hyperframes/` (HyperFrames)

Made with the `remotion-to-hyperframes` skill (HyperFrames 0.8.205), at its
**Native** level: translate, then check frame by frame.

## Source check

`lint_source.py src/` found 0 blockers, 1 warning and 2 info notes:

- Warning: the custom hook `usePop` (a pure `spring()` call). It was inlined
  as the runtime's `pop` motion.
- Info (twice): `staticFile()`. Replaced by `assets/…` paths; the generator
  copies those files in.

The composition has no `useState` or `useEffect` and no UI kit, so nothing
had to be hosted or rebuilt from scratch.

## Shape: generated, not one fixed file

The Remotion composition takes its scenes as props. A HyperFrames composition
can't change its length or its number of scenes through variables, so
`generate.mjs` writes `index.html` for each week from the script and the
voiced timeline. The template is `generate.mjs` + `runtime.js`; a week
changes only the data.

Everything is in one `index.html` file, with no sub-composition per scene.
Lint warns about that (`nested_structure_needs_subcomposition`,
`timeline_track_too_dense`, `composition_file_too_large`). Those warnings are
about editing in HyperFrames Studio, which nobody does here, because the
agent fills data and never restyles.

## What maps one to one

| Remotion | HyperFrames |
| --- | --- |
| `<Sequence from durationInFrames>` per scene | `.clip.scene` with `data-start` / `data-duration` (frames ÷ 30) |
| `<Audio>` in a nested `Sequence` | `<audio class="clip" data-start data-duration>` (lead 0.3 s; the clip owns the rest of its scene) |
| `interpolate(..., Easing.bezier(.22,1,.36,1))` | GSAP `fromTo` with the same cubic-bezier, solved in `runtime.js` |
| `spring({damping, stiffness 140, mass .7})` | the same damped spring in closed form, used as a GSAP ease over its settle time |
| `useCurrentFrame()` loops (wash drift, twinkle, pulse rings) | a GSAP tween whose `onUpdate` computes the same function of time |
| Fade (12 frames in, 10 out) | the same, on each scene's `.fade` wrapper |
| `@remotion/google-fonts` (fetched at render time) | `@fontsource/geist` + `@fontsource/newsreader` woff2 files copied into `assets/fonts` (no network) |
| `nc-counties.json` + `NCMap` | `geo.mjs` bakes any state from us-atlas with the same recipe; NC is byte-identical |

## What changed on purpose

- **Maps fit a box.** The pilot sized maps by width only, which suits a wide
  state like North Carolina. Each map now also has a height cap; a tall state
  (Texas) is scaled down and centred. North Carolina's output is unchanged.
- **The template no longer assumes North Carolina.** Three changes:
  - The photo lookup is keyed by the script's state (`… County, <ST>`), not a
    hard-coded `, NC`.
  - The legislature source line reads "the state legislature's bill actions"
    instead of "the General Assembly's".
  - The map comes from the script's `state`.
- **Captions.** The burned-in captions come from our `captions.vtt`, imported
  with `hyperframes transcribe`, one pill per cue. The pill has the same
  look, the same timing window (0.05 s before the cue to 0.2 s after) and the
  same rule of no captions over the closing card. One difference: a cue now
  never overlaps the next one, where the pilot let the earlier cue linger
  0.2 s.
- **Stills.** The poster and the review stills are cut from the MP4 with
  ffmpeg at the same frames the Remotion path renders.

## Approximations

- Remotion's `spring()` is integrated per frame; here it is the exact
  closed-form solution. Any difference is under a pixel.
- Pulse-label offsets use margins instead of a CSS transform. GSAP owns those
  elements' opacity, and the contract forbids CSS transforms on elements GSAP
  touches.

## Frame-by-frame check

The NC week of Oct 26, built from the public feeds, with the same timeline
and no voice. Remotion rendered at `--crf=26` with JPEG frames; HyperFrames
used quality `looks`. Run with `scripts/render_diff.sh` from the skill:

| | mean SSIM | min | p05 |
| --- | --- | --- | --- |
| whole video (1842 frames) | 0.985 | 0.967 | 0.976 |

Mean SSIM per scene is between 0.982 and 0.988. Part of the remaining gap is
the two encoders and the two Chrome builds (Remotion's 149, HyperFrames' 152)
anti-aliasing text differently. The skill notes that encoder differences
alone account for about 0.05. Side by side, the frames match in layout, type,
colour and motion.
