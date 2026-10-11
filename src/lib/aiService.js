// Client Service Layer for AI & YouTube Pipeline APIs
// Uses Google Gemini API with automatic Multi-Key Load Balancing, Parallel Execution & Instant Failover.

const GEMINI_KEYS_STORAGE_KEY = "uyns_gemini_api_keys_v1";

export function getStoredGeminiKeys() {
  try {
    const raw = localStorage.getItem(GEMINI_KEYS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((k) => String(k || "").trim()).filter((k) => k.length >= 15);
    }
  } catch {}
  return [];
}

export function setStoredGeminiKeys(keys) {
  try {
    const clean = (Array.isArray(keys) ? keys : [])
      .map((k) => String(k || "").trim())
      .filter((k) => k.length >= 15);
    localStorage.setItem(GEMINI_KEYS_STORAGE_KEY, JSON.stringify(Array.from(new Set(clean))));
  } catch {}
}

async function postJson(endpoint, payload = {}) {
  const storedKeys = getStoredGeminiKeys();
  const bodyPayload = {
    ...payload,
    geminiApiKeys:
      Array.isArray(payload?.geminiApiKeys) && payload.geminiApiKeys.length > 0
        ? payload.geminiApiKeys
        : storedKeys,
  };

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
    });
  } catch (err) {
    throw new Error(`Network error reaching ${endpoint}: ${err.message || String(err)}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request to ${endpoint} failed with status ${res.status}`);
  }
  return data;
}

export async function fetchProviderStatus() {
  try {
    const res = await fetch("/api/providers/status");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function updateServerGeminiConfig(configPayload) {
  if (Array.isArray(configPayload?.apiKeys)) {
    setStoredGeminiKeys(configPayload.apiKeys);
  }
  return postJson("/api/providers/gemini-config", {
    ...configPayload,
    geminiApiKeys: configPayload?.apiKeys || getStoredGeminiKeys(),
  });
}

// Backward-compatible alias
export const updateServerCodeCraftConfig = updateServerGeminiConfig;

export async function fetchYouTubeMetadata(url) {
  return postJson("/api/youtube/metadata", { url });
}

export async function analyzeReferenceAndConcepts(payload) {
  return postJson("/api/ai/analyze-reference", payload);
}

export async function regenerateConcepts(analysis, customDirection = "") {
  return postJson("/api/ai/regenerate-concepts", { analysis, customDirection });
}

export async function generateOrEditScript(payload) {
  return postJson("/api/ai/generate-script", payload);
}

export async function generateVoiceoverTTS(text, voiceName = "Charon") {
  return postJson("/api/ai/generate-tts", { text, voiceName });
}

export async function generateSceneImage({ prompt, aspectRatio = "16:9" }) {
  return postJson("/api/ai/generate-scene-image", { prompt, aspectRatio });
}

export async function generateSceneBreakdown(payload) {
  return postJson("/api/ai/scene-breakdown", payload);
}

// High-speed parallel batching across all active Gemini API keys
export async function generateImagePromptsBatch(payload) {
  const { scenes = [], batchSize = 15, ...rest } = payload;
  if (scenes.length <= batchSize) {
    const res = await postJson("/api/ai/image-prompts", { scenes, ...rest });
    return { prompts: Array.isArray(res.prompts) ? res.prompts : [] };
  }
  const chunks = [];
  for (let i = 0; i < scenes.length; i += batchSize) {
    chunks.push(scenes.slice(i, i + batchSize));
  }
  // Execute chunks in parallel across the Gemini key pool for maximum speed
  const results = await Promise.all(
    chunks.map((chunk) => postJson("/api/ai/image-prompts", { scenes: chunk, ...rest }))
  );
  const allPrompts = results.flatMap((r) => (Array.isArray(r.prompts) ? r.prompts : []));
  return { prompts: allPrompts };
}

export async function generateMotionPromptsBatch(payload) {
  const { scenes = [], imagePrompts = [], batchSize = 20, ...rest } = payload;
  if (scenes.length <= batchSize) {
    const res = await postJson("/api/ai/motion-prompts", { scenes, imagePrompts, ...rest });
    return { motionPrompts: Array.isArray(res.motionPrompts) ? res.motionPrompts : [] };
  }
  const chunks = [];
  for (let i = 0; i < scenes.length; i += batchSize) {
    chunks.push(scenes.slice(i, i + batchSize));
  }
  const results = await Promise.all(
    chunks.map((chunk) =>
      postJson("/api/ai/motion-prompts", { scenes: chunk, imagePrompts, ...rest })
    )
  );
  const allMotion = results.flatMap((r) => (Array.isArray(r.motionPrompts) ? r.motionPrompts : []));
  return { motionPrompts: allMotion };
}

export async function generateSeoPackage(payload) {
  return postJson("/api/ai/seo-package", payload);
}
