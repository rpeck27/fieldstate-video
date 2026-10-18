// Render the same ~20 second sample with each voice candidate.
// Loudness is normalized to I=-16. The API key is never printed.
//
//   ELEVENLABS_API_KEY=… node sample-voices.mjs
//
// Writes scripts/video/out/voice-samples/<key>.mp3 and a short note.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LOUDNORM,
  VOICE_CANDIDATES,
  ensurePronunciationDictionary,
  resolveVoiceByName,
  synthesize,
} from "./lib/voice.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "out", "voice-samples");

const SAMPLE =
  "This week in North Carolina. On Monday, October nineteenth, the Pitt County Board of Commissioners " +
  "has on its agenda a temporary moratorium on data centers. On Tuesday, October twentieth, the " +
  "Cumberland County Joint Planning Board takes up development standards for data center uses. " +
  "Cabarrus, Mecklenburg, Buncombe, Guilford, Currituck, Chowan, and Wake are on the map. " +
  "We don't predict votes. We show you the record.";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    child.on("error", reject);
  });
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.log("ELEVENLABS_API_KEY is not set. Voice samples were not rendered.");
    console.log("Candidates:");
    for (const c of VOICE_CANDIDATES) {
      console.log(`  ${c.name}  model ${c.modelId}  id ${c.voiceId || "(resolve by name)"}  ${JSON.stringify(c.settings)}`);
    }
    return;
  }
  await mkdir(OUT, { recursive: true });
  let locators = null;
  try {
    locators = await ensurePronunciationDictionary({ apiKey });
    console.log(locators ? "pronunciation dictionary ready" : "pronunciation dictionary not created; speaking without it");
  } catch (err) {
    console.log(`pronunciation dictionary skipped: ${err.message}`);
  }
  for (const candidate of VOICE_CANDIDATES) {
    let voiceId = candidate.voiceId;
    let name = candidate.name;
    if (!voiceId) {
      const found = await resolveVoiceByName({ name: candidate.name, apiKey });
      if (!found?.voiceId) {
        console.log(`skip ${candidate.name}: not found (${(found?.reasons || []).join("; ")})`);
        continue;
      }
      voiceId = found.voiceId;
      name = found.name;
    }
    const out = await synthesize({
      text: SAMPLE,
      apiKey,
      voiceId,
      modelId: candidate.modelId,
      voiceSettings: candidate.settings,
      pronunciationDictionaryLocators: locators || undefined,
    });
    const raw = path.join(OUT, `${candidate.key}.raw.mp3`);
    const mp3 = path.join(OUT, `${candidate.key}.mp3`);
    await writeFile(raw, out.audio);
    await run("ffmpeg", ["-y", "-i", raw, "-af", LOUDNORM, "-ar", "44100", "-b:a", "128k", mp3]);
    await writeFile(
      path.join(OUT, `${candidate.key}.txt`),
      `${name}\nmodel ${candidate.modelId}\nvoice ${voiceId}\n${LOUDNORM}\nsettings ${JSON.stringify(candidate.settings)}\n\n${SAMPLE}\n`,
    );
    console.log(`wrote ${candidate.key}.mp3 (${name})`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
