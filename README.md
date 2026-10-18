# Weekly state video: render job (`rpeck27/fieldstate-video`)

Engine brief Oct 14, 2026 (late), item 1: "The week ahead in North Carolina",
built after the Friday-night run, approved by Russell on Saturday, live at
about 5 PM ET Saturday, made for Sunday morning.

**Russell runs no commands.** The render runs as a GitHub Actions workflow in
a small public repository, `rpeck27/fieldstate-video`, which holds this folder
copied as-is (the same pattern as `scripts/tiles` → `rpeck27/fieldstate-tiles`).
Public repositories get standard runners free, so a render costs no Actions
minutes. GitHub ignores a `.github` folder that is not at a repository's root,
so the workflow never runs inside sie-engine.

## How a week goes

| When (ET) | What happens | Where |
|---|---|---|
| Sat ~1:30 AM to ~6 AM | The Friday-night run publishes the feeds. When its chain finishes, the conductor asks the engine for the script (`sie.serve.weekly_video`, read only: the published feeds plus read-only SELECTs for plain headlines, meeting-video votes and OpenStates), keeps it in the **private** bucket and starts this workflow (`workflow_dispatch`, input `render_id`). | Conductor Worker |
| +20-30 min | This job fetches the script, voices it (ElevenLabs), renders it (Remotion), and uploads `video.mp4`, `poster.jpg` and `captions.vtt` back through the conductor into the private bucket. | This repo |
| Right after | #ops gets one message: **Watch**, **Approve**, **Reject**. | Slack #ops |
| Sat morning | Russell taps Watch, then Approve (or Reject). Opening a link changes nothing; the button on the page does. | Phone |
| Sat 5 PM | The conductor claims the approved video (approved → publishing), copies the three files to `data.fieldstate.org/videos/<st>/<week_of>/<random id>/`, marks it published and rewrites `feeds/videos.json`. A reject during the copy removes the copies. Approved after 5 PM: it goes live within 10 minutes of approval. | Conductor (10-minute tick) |

Nothing is public before approval: the script and the render sit in the
private bucket, and `feeds/videos.json` lists only approved, published videos.
The public copies sit under a 128-bit random path segment drawn when
publishing starts, so no media URL can be guessed before the feed lists it.

## Security

- **No Cloudflare credential in this repo.** The job proves who it is with a
  GitHub Actions OIDC token (`permissions: id-token: write`, audience
  `fieldstate-video`). The conductor checks GitHub's signature and that the
  token was minted for `render.yml` on `main` in `rpeck27/fieldstate-video`,
  for a `workflow_dispatch` run. A fork, a pull request, another branch or
  another workflow is refused. The first run that reads a script owns that
  render; uploads from any other run are refused.
- The conductor URL is fixed in the workflow (or the repository variable
  `CONDUCTOR_URL`), never an input, so a run cannot be pointed elsewhere.
- The only secret here is `ELEVENLABS_API_KEY`.
- Review links: HMAC-signed with the conductor's `VIDEO_APPROVAL_SECRET`,
  bound to state, week, render id and a per-render nonce. Approve and Reject
  each work once, expire after 48 hours, and die if a newer render replaces
  this one. A link that is edited by one character is refused.

## What is on screen and in the voice

Only what the engine's script carries (`fieldstate.weekly_video.v2`), about
90 seconds and at most five items: the open on the North Carolina map with
the places we read lighting up; the two or three most consequential
decisions of the week as case cards with an outcome stamp; votes reported
from a meeting video when the minutes are not posted (tier "Reported from
the meeting video", after the line "Here are some things we know happened;
the full record will be at fieldstate.org as soon as the town posts its
minutes."); one story when the agendas have one; one or two upcoming
meetings with the date and time from the posted agenda; the legislature only
when a tracked North Carolina bill moved (the OpenStates check always runs
and is logged); and the close on fieldstate.org/nc.

Plain words only: a case is said only from its checked plain headline
(`headline_plain`) or the site's short form; a raw government title or a
file number is never said, and that case is left out. A week with nothing
plain to say is not rendered (the conductor says so in #ops; the manual
trigger takes `thin=1` to render it anyway). Every number is checked against
the record, dollar figures by `sie/serve/money_check.py`, private names
scrubbed (`sie/serve/person_names.py`) except approved honorees
(`sie/serve/honor.py`).

The picture follows the October 14 pilot (`rpeck27/fieldstate-site`, branch
`claude/video-pilot`, `tools/video/src/Week.jsx`): a drifting navy wash, a
drawn county map (U.S. Census shapes via the us-atlas package, public
domain) that draws on with a dot for every county we read, gold counties
that pulse with a label for the places a scene is about, case cards that
spring in with an outcome stamp and a "Documented" or "Reported from the
meeting video" tag, a big counting figure (acres, homes, megawatts) when the
record prints one, agenda cards with the day, date and time, a brand bar,
burned-in captions, and a credited photo only for the place a licensed photo
depicts. Type is Newsreader and Geist. 1920×1080, 30 fps.

Voice default is **Blue Ashby** (library voice `lVwI5jj77lJwTyfW90VR`,
the pilot's voice) on `eleven_v4`, read steadier and slower than the pilot
take (stability 0.75, style 0.05, speed 0.92). `ELEVENLABS_VOICE` = `daniel`
or `brian` switches to another candidate with its settings;
`ELEVENLABS_VOICE_ID` overrides the voice id. eleven_v3-family models accept
stability 0, 0.5 or 1 only: a refusal that says so is retried once with the
value snapped (logged). NC place names a voice misreads are sent as inline
IPA on eleven_v3/v4 (`lib/voice.mjs` `NC_IPA`) and through
`pronunciation/nc.pls` on other models. Each scene's mp3 is
loudness-normalized with `ffmpeg loudnorm=I=-16:TP=-1.5:LRA=11`. A refusal
from ElevenLabs is logged with its reason, never the key.
`node sample-voices.mjs` renders the same short sample with all three
candidates when `ELEVENLABS_API_KEY` is set.

Every render also voices the script's first two lines in all three
candidates (a few hundred characters each; `VOICE_SAMPLES=0` skips them) and
renders three stills (opening map, a case card, the closing card). They go
to the conductor with the video; the #ops message gives the running time and
says they are on the Watch page, which shows the stills first and the
samples as players, so the video can be judged on a phone without playing
it. They are never published. The render itself uses the default voice; to
switch, Russell says which voice in #ops and the engine thread sets the
repository variable `ELEVENLABS_VOICE` (`daniel` or `brian`) in
`fieldstate-video`, which applies from the next render.

## Cost per render

| | Per render | Notes |
|---|---|---|
| ElevenLabs voice | the script caps the voice at 1,250 characters (about a minute and a half at the slower read) | Model `eleven_v4`. The dollar cost is whatever that model bills on the account; this note does not guess it. |
| GitHub Actions | $0 | Standard runners are free for public repositories. |
| Cloudflare | $0 | R2 storage (a few MB a week), a few dozen R2 operations and Worker requests: inside the free allowances. |

## Time

Measured on a 2-CPU agent sandbox, without the voice: a 78-second, 9-scene
script rendered (bundle, video, poster) in 2 minutes 20 seconds; a full
3-minute-20-second, 23-scene script built from the Oct 10 record in
9 minutes 30 seconds (3.7 MB MP4). GitHub's public runners have 4 CPUs, so
expect about 5-8 minutes of rendering, plus about 3 minutes of setup (install,
browser download) and 1-2 minutes of voice: **about 10-15 minutes from
dispatch to the #ops message**, 25 at worst. The Friday-night chain itself
finishes around 6 AM ET Saturday (feeds published 10:03 UTC on Oct 14), so
the links should be in #ops by about 6:30 AM ET Saturday.

## Russell's steps (clicks only)

Do these after the engine PR is merged and deployed.

GitHub (web):

1. **github.com/new.** Owner `rpeck27`, name `fieldstate-video`, **Public**,
   no README. Then tell the engine thread; an agent pushes this folder there.
   (If you say so in chat, an agent can create the repository too, and this
   step drops out.)
2. **fieldstate-video → Settings → Secrets and variables → Actions → New
   repository secret.** Name `ELEVENLABS_API_KEY`, value: an ElevenLabs API
   key (elevenlabs.io → Developers → API Keys → Create; "Text to Speech"
   access is enough).
   Optional, same page, **Variables** tab: `ELEVENLABS_VOICE_ID` overrides the
   default candidate, Blue Ashby on `eleven_v4`. `ELEVENLABS_MODEL_ID` overrides
   the model.
3. **Your GitHub profile → Settings → Developer settings → Personal access
   tokens → Fine-grained tokens →** the token saved in Cloudflare as
   `GH_DEPLOY_DISPATCH_TOKEN` → **Edit → Repository access → add
   `fieldstate-video`** (Actions stays "Read and write") → **Update**.
   No new Cloudflare secret is needed for this.

Cloudflare dashboard (Workers & Pages → `fieldstate-shadow-conductor` →
Settings → Variables and Secrets → **Add**, type **Secret** each time):

4. `VIDEO_APPROVAL_SECRET`: a long random password (let your password manager
   generate one, 32 characters or more). It signs the Approve/Reject links.
5. When you want it on: `SIE_WEEKLY_VIDEO` with value `1`. To switch it off
   again, delete it. (It is a secret, not a plain variable, so a deploy does
   not wipe it.)

That's all. The next Friday-night run does the rest, and #ops gets the links
on Saturday morning.

## Running it elsewhere

`SCRIPT_FILE=script.json NO_VOICE=1 NO_UPLOAD=1 node render.mjs` renders a
script without a voice or an upload (`npx remotion browser ensure` first).
`ELEVENLABS_API_KEY=… node sample-voices.mjs` writes the three-voice sample
under `out/voice-samples/`. Behind a TLS-inspecting proxy add
`REMOTION_EXTRA_FLAGS=--ignore-certificate-errors`. `npm test` runs the
caption, timeline, and voice-candidate tests.

The photo in `public/photos/cumberland.jpg` is the Cumberland County
Courthouse by Gerry Dincher, licensed CC BY-SA 2.0
(https://creativecommons.org/licenses/by-sa/2.0/), from Wikimedia Commons:
https://commons.wikimedia.org/wiki/File:Cumberland_County,_North_Carolina_courthouse.jpg
(originally https://www.flickr.com/photos/11629603@N04/5463221811). It is
the unmodified original (2560×1920, 1.23 MB, Nikon COOLPIX L10, as the
Commons page lists it); the Commons file page and upload.wikimedia.org are
open to FieldstateBot under their robots.txt. It is shown only on a
Cumberland County scene, always with its credit line on screen. Any other
photo needs the same: a free license, the author, the source page, and a
host whose robots.txt allows FieldstateBot.

## License note

Remotion is free for individuals and companies of up to three people
(remotion.dev/license); Fieldstate qualifies today. The fonts (Newsreader,
Geist) are SIL Open Font License, loaded from Google Fonts at render time.
