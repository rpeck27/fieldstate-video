# fieldstate-video: rules for agent sessions

This file and AGENTS.md are identical. Claude Code reads this one; Cursor reads AGENTS.md.

This folder is a copy of `rpeck27/sie-engine` `scripts/video` (README, first section). Change
both together: a change made only here is lost at the next "Mirror sie-engine" copy.

## HyperFrames

The HyperFrames skills are in `.claude/skills` and `.agents/skills`. They describe more than
this repository may use.

- Never run `hyperframes publish`, `cloud`, `lambda`, `cloudrun` or `auth`.
- Never create a HeyGen account or use HeyGen's paid media.
- The render runs offline, in Docker with `--network none`. Bake everything into the
  generated project; a fetch at render time is a bug.
- Pin versions. Upgrade HyperFrames deliberately (README, "Upgrading HyperFrames") and
  re-render a past week as the check.
- The look is fixed. A weekly run fills data. Visual changes to `hyperframes/generate.mjs`,
  `hyperframes/runtime.js` or `src/` go through the surface thread.

## Never

- Commit or print `ELEVENLABS_API_KEY`.
- Change `render.yml`'s name, inputs or permissions. The conductor checks the OIDC token for
  `render.yml` on `main`.
- Put a week's script, render or voice anywhere public before Russell approves it. That
  includes workflow artifacts and logs.
