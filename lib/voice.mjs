// ElevenLabs text-to-speech with character timestamps. The API key comes
// from the ELEVENLABS_API_KEY repository secret; it is never logged.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
export const DEFAULT_MODEL = "eleven_v4";
export const DEFAULT_VOICE_NAME = "Blue Ashby";
export const LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PRONUNCIATION_PLS = path.join(HERE, "..", "pronunciation", "nc.pls");

// Three candidates for Russell to pick from (Oct 17: "a warm, steady
// news-read, not the pilot's default settings"; render with higher stability
// and a slower pace). Blue Ashby is the pilot's voice, a library voice
// ("Blue Ashby - Conversational & Informative", id below, resolved by name if
// the id ever stops working). Daniel and Brian are premade.
// ELEVENLABS_VOICE_ID overrides the default; ELEVENLABS_VOICE (a candidate
// key such as "daniel") picks another candidate with its own settings.
export const VOICE_CANDIDATES = [
  {
    key: "blue-ashby",
    name: "Blue Ashby",
    voiceId: "lVwI5jj77lJwTyfW90VR",
    modelId: "eleven_v4",
    settings: { stability: 0.75, similarity_boost: 0.8, style: 0.05, speed: 0.92, use_speaker_boost: true },
    note: "Pilot voice, steadier and slower than the pilot take. Default until a person picks.",
  },
  {
    key: "daniel",
    name: "Daniel",
    voiceId: "onwK4e9ZLuTAKqWW03F9",
    modelId: "eleven_v4",
    settings: { stability: 0.75, similarity_boost: 0.75, style: 0.0, speed: 0.92, use_speaker_boost: true },
    note: "Steady broadcaster, premade.",
  },
  {
    key: "brian",
    name: "Brian",
    voiceId: "nPczCjzI2devNBz1zQrb",
    modelId: "eleven_v4",
    settings: { stability: 0.75, similarity_boost: 0.78, style: 0.0, speed: 0.92, use_speaker_boost: true },
    note: "Deep, warm, premade.",
  },
];

/** The candidate a key names ("daniel"), else the default. */
export function candidateFor(key) {
  const want = String(key || "").trim().toLowerCase();
  return VOICE_CANDIDATES.find((c) => c.key === want) || VOICE_CANDIDATES[0];
}

// eleven_v4 / eleven_v3 take a pronunciation inline as IPA between slashes
// (ElevenLabs model guide). Only the voice text changes; captions keep the
// place name. Other models use pronunciation/nc.pls (aliases).
export const NC_IPA = {
  Cabarrus: "kəˈbɛərəs",
  Buncombe: "ˈbʌŋkəm",
  Guilford: "ˈɡɪlfərd",
  Currituck: "ˈkɜːrɪtʌk",
  Chowan: "tʃəˈwɑːn",
  Rowan: "roʊˈæn",
  Beaufort: "ˈboʊfərt",
  Bertie: "bərˈtiː",
  Perquimans: "pərˈkwɪmənz",
  Pasquotank: "ˈpæskwətæŋk",
  Mebane: "ˈmɛbən",
  Manteo: "ˈmæntioʊ",
  Pamlico: "ˈpæmlɪkoʊ",
  Fuquay: "ˈfjuːkweɪ",
  Varina: "vəˈriːnə",
};

export function inlinePronunciation(text, modelId) {
  if (!/^eleven_v[34]/.test(String(modelId || ""))) return text;
  return String(text).replace(/\b([A-Z][a-z]+)\b/g, (w) => (NC_IPA[w] ? `/${NC_IPA[w]}/` : w));
}

/** eleven_v3-family models accept stability 0.0, 0.5 or 1.0 only. */
export function snapStability(settings) {
  const s = Number(settings?.stability);
  if (!Number.isFinite(s)) return settings;
  const snapped = s >= 0.75 ? 1.0 : s >= 0.25 ? 0.5 : 0.0;
  return { ...settings, stability: snapped };
}

export function defaultCandidate(env = process.env) {
  return candidateFor(env.ELEVENLABS_VOICE);
}

async function eleven(url, apiKey, fetchImpl, init = {}) {
  const resp = await fetchImpl(url, {
    ...init,
    headers: { "xi-api-key": apiKey, ...(init.headers || {}) },
  });
  return resp;
}

/** Resolve a library or account voice by its display name.
 *  Returns { voiceId, name } or { voiceId: null, reasons } (logged by the caller). */
export async function resolveVoiceByName({ name, apiKey, fetchImpl = fetch }) {
  if (!apiKey || !name) return null;
  const urls = [
    `https://api.elevenlabs.io/v1/shared-voices?search=${encodeURIComponent(name)}&page_size=10`,
    "https://api.elevenlabs.io/v1/voices",
  ];
  const want = name.trim().toLowerCase();
  const reasons = [];
  for (const url of urls) {
    let resp;
    try {
      resp = await eleven(url, apiKey, fetchImpl);
    } catch (err) {
      reasons.push(`${url.split("?")[0].split("/v1/")[1]}: ${err.message}`);
      continue;
    }
    if (!resp.ok) {
      reasons.push(`${url.split("?")[0].split("/v1/")[1]}: http ${resp.status} ${await detail(resp)}`);
      continue;
    }
    const body = await resp.json();
    const rows = body.voices || body.shared_voices || [];
    const hit = rows.find((v) => String(v.name || "").trim().toLowerCase() === want)
      || rows.find((v) => String(v.name || "").toLowerCase().includes(want));
    const id = hit?.voice_id || hit?.voiceId;
    if (id) return { voiceId: id, name: hit.name };
    reasons.push(`${url.split("?")[0].split("/v1/")[1]}: no voice named "${name}"`);
  }
  return { voiceId: null, reasons };
}

/** A short piece of an ElevenLabs refusal body for the log ({"detail": ...}).
 *  It never contains the API key. */
async function detail(resp) {
  try {
    return (await resp.text()).replace(/\s+/g, " ").slice(0, 300);
  } catch {
    return "";
  }
}

/**
 * Upload pronunciation/nc.pls once per account (name fieldstate-nc) and
 * return the locator the speech call expects. Failure leaves the render
 * going without it; the caller logs that.
 */
export async function ensurePronunciationDictionary({ apiKey, fetchImpl = fetch }) {
  const list = await eleven(
    "https://api.elevenlabs.io/v1/pronunciation-dictionaries?page_size=100",
    apiKey,
    fetchImpl,
  );
  if (list.ok) {
    const body = await list.json();
    const rows = body.pronunciation_dictionaries || body.dictionaries || [];
    const existing = rows.find((d) => d.name === "fieldstate-nc");
    const id = existing?.id || existing?.pronunciation_dictionary_id;
    const version = existing?.version_id || existing?.latest_version_id;
    if (id && version) return [{ pronunciation_dictionary_id: id, version_id: version }];
  }
  const xml = await readFile(PRONUNCIATION_PLS);
  const form = new FormData();
  form.set("name", "fieldstate-nc");
  form.set("file", new Blob([xml], { type: "application/pls+xml" }), "nc.pls");
  const created = await eleven(
    "https://api.elevenlabs.io/v1/pronunciation-dictionaries/add-from-file",
    apiKey,
    fetchImpl,
    { method: "POST", body: form },
  );
  if (!created.ok) throw new Error(`pronunciation dictionary http ${created.status} ${await detail(created)}`);
  const made = await created.json();
  const id = made.id || made.pronunciation_dictionary_id;
  const version = made.version_id;
  if (!id || !version) return null;
  return [{ pronunciation_dictionary_id: id, version_id: version }];
}

export async function synthesize({
  text,
  previousText = "",
  nextText = "",
  apiKey,
  voiceId,
  modelId = DEFAULT_MODEL,
  voiceSettings = defaultCandidate().settings,
  pronunciationDictionaryLocators = undefined,
  fetchImpl = fetch,
  retries = 3,
}) {
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  if (!voiceId) throw new Error("no ElevenLabs voice id");
  const url = `${ELEVENLABS_URL}/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`;
  let lastStatus = 0;
  let lastDetail = "";
  let settings = voiceSettings;
  let snapped = false;
  const spoken = inlinePronunciation(text, modelId);
  for (let attempt = 0; attempt <= retries; attempt++) {
    const resp = await fetchImpl(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        text: spoken,
        model_id: modelId,
        previous_text: previousText || undefined,
        next_text: nextText || undefined,
        voice_settings: settings,
        pronunciation_dictionary_locators: pronunciationDictionaryLocators,
      }),
    });
    lastStatus = resp.status;
    if (resp.ok) {
      const body = await resp.json();
      if (!body.audio_base64 || !body.alignment) throw new Error("elevenlabs: no audio or alignment");
      return { audio: Buffer.from(body.audio_base64, "base64"), alignment: body.alignment };
    }
    // ElevenLabs explains a refusal in the body ({"detail": {...}}); keep a
    // short piece of it for the log (#713). It never contains the API key.
    lastDetail = await detail(resp);
    if (resp.status === 400 && !snapped && /stability/i.test(lastDetail)) {
      // v3-family models take stability 0, 0.5 or 1 only: snap once, say so.
      snapped = true;
      settings = snapStability(settings);
      console.log(`elevenlabs: stability refused (${lastDetail.slice(0, 120)}); retrying with ${settings.stability}`);
      continue;
    }
    if (resp.status !== 429 && resp.status < 500) break;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  const err = new Error(`elevenlabs http ${lastStatus}${lastDetail ? `: ${lastDetail}` : ""}`);
  if (isCreditCap(lastDetail)) err.cap = "elevenlabs";
  throw err;
}

/** True when ElevenLabs refused because the credit or character cap was hit. */
export function isCreditCap(detail) {
  const text = String(detail || "").toLowerCase();
  return /quota|insufficient credits|credit limit|character limit|exceeds your quota|exceeds your credit/.test(text);
}
