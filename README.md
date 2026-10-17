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
| Sat ~1:30 AM to ~6 AM | The Friday-night run publishes the feeds. When its chain finishes, the conductor asks the engine for the script (`sie.serve.weekly_video`, read only: the published feeds plus one SELECT), keeps it in the **private** bucket and starts this workflow (`workflow_dispatch`, input `render_id`). | Conductor Worker |
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

Only what the engine's script carries: fixed sentence templates filled from
the record (week behind with decided dates, week ahead from posted agendas,
"agenda not posted yet", "met Monday; the result isn't on the record yet",
and shout-outs for names the board itself honors). Every number is checked
against the feed, dollar figures by `sie/serve/money_check.py`, private names
scrubbed (`sie/serve/person_names.py`) except approved honorees
(`sie/serve/honor.py`). The renderer adds only labels ("On the agenda",
"Approved"). Type and color follow the site: Newsreader for the record,
Geist for the product, navy ink, light theme.

## Cost per render

| | Per render | Notes |
|---|---|---|
| ElevenLabs voice | about 3,000-3,800 characters (the script caps the voice at 3,800, about 4 minutes) | Multilingual v2 is 1 credit per character: about $0.30-$0.38 at the API rate of $0.10 per 1,000 characters, or about 3-4% of the Creator plan's monthly credits. Flash v2.5 (`ELEVENLABS_MODEL_ID=eleven_flash_v2_5`) halves that. |
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
   Optional, same page, **Variables** tab: `ELEVENLABS_VOICE_ID` = the voice
   the pilot used (default: "Bella - Professional, Bright, Warm").
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
Behind a TLS-inspecting proxy add
`REMOTION_EXTRA_FLAGS=--ignore-certificate-errors`. `npm test` runs the
caption and timeline tests.

## License note

Remotion is free for individuals and companies of up to three people
(remotion.dev/license); Fieldstate qualifies today. The fonts (Newsreader,
Geist) are SIL Open Font License, loaded from Google Fonts at render time.
