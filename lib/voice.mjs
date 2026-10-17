// ElevenLabs text-to-speech with character timestamps. The API key comes
// from the ELEVENLABS_API_KEY repository secret; it is never logged.

export const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
export const DEFAULT_MODEL = "eleven_multilingual_v2";
// "Bella - Professional, Bright, Warm" (premade, informative). Set the
// repository variable ELEVENLABS_VOICE_ID to use another voice.
export const DEFAULT_VOICE = "hpp4J3VqNfWAUOO0d1Us";

export async function synthesize({
  text,
  previousText = "",
  nextText = "",
  apiKey,
  voiceId = DEFAULT_VOICE,
  modelId = DEFAULT_MODEL,
  fetchImpl = fetch,
  retries = 3,
}) {
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  const url = `${ELEVENLABS_URL}/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`;
  let lastStatus = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const resp = await fetchImpl(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        text,
        model_id: modelId,
        previous_text: previousText || undefined,
        next_text: nextText || undefined,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
      }),
    });
    lastStatus = resp.status;
    if (resp.ok) {
      const body = await resp.json();
      if (!body.audio_base64 || !body.alignment) throw new Error("elevenlabs: no audio or alignment");
      return { audio: Buffer.from(body.audio_base64, "base64"), alignment: body.alignment };
    }
    if (resp.status !== 429 && resp.status < 500) break;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`elevenlabs http ${lastStatus}`);
}
