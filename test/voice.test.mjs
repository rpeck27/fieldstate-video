import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_MODEL, DEFAULT_VOICE_NAME, LOUDNORM, VOICE_CANDIDATES } from "../lib/voice.mjs";

test("three voice candidates, Blue Ashby on eleven_v4, loudness at -16", () => {
  assert.equal(VOICE_CANDIDATES.length, 3);
  assert.equal(DEFAULT_VOICE_NAME, "Blue Ashby");
  assert.equal(DEFAULT_MODEL, "eleven_v4");
  assert.equal(VOICE_CANDIDATES[0].name, "Blue Ashby");
  assert.equal(VOICE_CANDIDATES[0].modelId, "eleven_v4");
  assert.match(LOUDNORM, /I=-16/);
  assert.match(LOUDNORM, /TP=-1\.5/);
  for (const c of VOICE_CANDIDATES) {
    assert.ok(c.settings.stability >= 0 && c.settings.stability <= 1);
    assert.ok(c.settings.speed > 0);
  }
});

import { candidateFor, inlinePronunciation, resolveVoiceByName, snapStability, synthesize } from "../lib/voice.mjs";

test("steadier, slower read than the pilot; candidates by key", () => {
  for (const c of VOICE_CANDIDATES) {
    assert.ok(c.settings.stability >= 0.7, c.key);
    assert.ok(c.settings.speed < 1, c.key);
  }
  assert.equal(candidateFor("daniel").name, "Daniel");
  assert.equal(candidateFor("nobody").key, "blue-ashby");
  assert.equal(VOICE_CANDIDATES[0].voiceId, "lVwI5jj77lJwTyfW90VR");
});

test("NC names get inline IPA on eleven_v4 only", () => {
  assert.equal(inlinePronunciation("Cabarrus County", "eleven_v4"), "/kəˈbɛərəs/ County");
  assert.equal(inlinePronunciation("Cabarrus County", "eleven_multilingual_v2"), "Cabarrus County");
  assert.equal(snapStability({ stability: 0.75 }).stability, 1);
  assert.equal(snapStability({ stability: 0.4 }).stability, 0.5);
});

function resp(status, body) {
  return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

test("a refusal keeps ElevenLabs' reason in the error (never the key)", async () => {
  const fetchImpl = async () => resp(401, { detail: { status: "invalid_api_key", message: "Invalid API key" } });
  await assert.rejects(
    synthesize({ text: "x", apiKey: "sk_secret", voiceId: "v", fetchImpl, retries: 0 }),
    (err) => /http 401: .*invalid_api_key/.test(err.message) && !err.message.includes("sk_secret"),
  );
  const found = await resolveVoiceByName({ name: "Blue Ashby", apiKey: "sk_secret", fetchImpl });
  assert.equal(found.voiceId, null);
  assert.ok(found.reasons.every((r) => /http 401/.test(r) && !r.includes("sk_secret")));
});

test("a stability refusal is snapped once and retried", async () => {
  const sent = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body.voice_settings.stability);
    if (sent.length === 1) return resp(400, { detail: { message: "stability must be one of 0.0, 0.5, 1.0" } });
    return resp(200, { audio_base64: Buffer.from("mp3").toString("base64"), alignment: { characters: ["x"] } });
  };
  const out = await synthesize({ text: "x", apiKey: "k", voiceId: "v", fetchImpl, voiceSettings: { stability: 0.75 } });
  assert.deepEqual(sent, [0.75, 1]);
  assert.equal(out.audio.toString(), "mp3");
});
