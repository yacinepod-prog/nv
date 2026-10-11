// Clean Client Service Layer for AI & YouTube Pipeline APIs
// Supports both Gemini and CodeCraft API (https://codecraftapi.com/v1) via server-side Express routes (/api/*).

async function postJson(endpoint, payload) {
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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

export async function updateServerCodeCraftConfig(configPayload) {
  return postJson("/api/providers/codecraft-config", configPayload);
}

export async function fetchYouTubeMetadata(url) {
  return postJson("/api/youtube/metadata", { url });
}

export async function analyzeReferenceAndConcepts(payload) {
  return postJson("/api/ai/analyze-reference", payload);
}

export async function regenerateConcepts(analysis, customDirection = "", provider = "gemini", codecraftConfig = null) {
  return postJson("/api/ai/regenerate-concepts", { analysis, customDirection, provider, codecraftConfig });
}

export async function generateOrEditScript(payload) {
  return postJson("/api/ai/generate-script", payload);
}

export async function generateVoiceoverTTS(text, voiceName = "Charon", provider = "gemini", codecraftConfig = null) {
  return postJson("/api/ai/generate-tts", { text, voiceName, provider, codecraftConfig });
}

export async function generateSceneImage({ prompt, aspectRatio = "16:9", provider = "codecraft", codecraftConfig = null }) {
  return postJson("/api/ai/generate-scene-image", { prompt, aspectRatio, provider, codecraftConfig });
}

export async function generateSceneBreakdown(payload) {
  return postJson("/api/ai/scene-breakdown", payload);
}

export async function generateImagePromptsBatch(payload) {
  const { scenes = [], batchSize = 20, ...rest } = payload;
  const allPrompts = [];
  for (let i = 0; i < scenes.length; i += batchSize) {
    const chunk = scenes.slice(i, i + batchSize);
    const res = await postJson("/api/ai/image-prompts", { scenes: chunk, ...rest });
    if (Array.isArray(res.prompts)) {
      allPrompts.push(...res.prompts);
    }
  }
  return { prompts: allPrompts };
}

export async function generateMotionPromptsBatch(payload) {
  const { scenes = [], imagePrompts = [], batchSize = 20, ...rest } = payload;
  const allMotion = [];
  for (let i = 0; i < scenes.length; i += batchSize) {
    const chunk = scenes.slice(i, i + batchSize);
    const res = await postJson("/api/ai/motion-prompts", { scenes: chunk, imagePrompts, ...rest });
    if (Array.isArray(res.motionPrompts)) {
      allMotion.push(...res.motionPrompts);
    }
  }
  return { motionPrompts: allMotion };
}

export async function generateSeoPackage(payload) {
  return postJson("/api/ai/seo-package", payload);
}
