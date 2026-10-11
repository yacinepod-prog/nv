import express from "express";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: "35mb" }));

// Server-side in-memory runtime store for CodeCraft API configuration
let runtimeCodeCraftConfig = {
  apiKey: process.env.CODECRAFT_API_KEY || "",
  baseUrl: (process.env.CODECRAFT_BASE_URL || "https://codecraftapi.com/v1").replace(/\/+$/, ""),
  textModel: process.env.CODECRAFT_TEXT_MODEL || "gpt-4o",
  imageModel: process.env.CODECRAFT_IMAGE_MODEL || "dall-e-3",
  ttsModel: process.env.CODECRAFT_TTS_MODEL || "tts-1",
  ttsVoice: process.env.CODECRAFT_TTS_VOICE || "alloy",
};

function resolveGeminiEnvKey(): string {
  const raw =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.VITE_GEMINI_API_KEY ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
    "";
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === "MY_GEMINI_API_KEY" || trimmed === "YOUR_GEMINI_API_KEY") {
    return "";
  }
  return trimmed;
}

function getAI() {
  const apiKey = resolveGeminiEnvKey();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured in server environment. In Vercel Dashboard -> Project Settings -> Environment Variables, add GEMINI_API_KEY (for Production, Preview & Development) and Redeploy, or configure CodeCraft API in Settings."
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function getCodeCraftCreds(reqBody: any) {
  const cc = reqBody?.codecraftConfig || {};
  const rawKey =
    cc.apiKey ||
    runtimeCodeCraftConfig.apiKey ||
    process.env.CODECRAFT_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.VITE_CODECRAFT_API_KEY ||
    "";
  const apiKey = String(rawKey).trim();
  const baseUrl = (
    cc.baseUrl ||
    runtimeCodeCraftConfig.baseUrl ||
    process.env.CODECRAFT_BASE_URL ||
    "https://codecraftapi.com/v1"
  ).replace(/\/+$/, "");
  const textModel = cc.textModel || runtimeCodeCraftConfig.textModel || process.env.CODECRAFT_TEXT_MODEL || "gpt-4o";
  const imageModel = cc.imageModel || runtimeCodeCraftConfig.imageModel || process.env.CODECRAFT_IMAGE_MODEL || "dall-e-3";
  const ttsModel = cc.ttsModel || runtimeCodeCraftConfig.ttsModel || process.env.CODECRAFT_TTS_MODEL || "tts-1";
  const ttsVoice = cc.ttsVoice || runtimeCodeCraftConfig.ttsVoice || process.env.CODECRAFT_TTS_VOICE || "alloy";
  return { apiKey, baseUrl, textModel, imageModel, ttsVoice, ttsModel };
}

function resolveEffectiveProvider(requestedProvider: string | undefined, reqBody: any): "gemini" | "codecraft" {
  const cc = getCodeCraftCreds(reqBody);
  const hasGemini = !!resolveGeminiEnvKey();
  const hasCodeCraft = !!cc.apiKey;
  if (requestedProvider === "codecraft") {
    if (hasCodeCraft) return "codecraft";
    if (hasGemini) return "gemini";
    return "codecraft";
  }
  if (hasGemini) return "gemini";
  if (hasCodeCraft) return "codecraft";
  return "gemini";
}

function parseJsonClean(rawText: string) {
  const str = String(rawText || "").trim();
  if (!str) return {};
  const cleaned = str
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    const firstBracket = cleaned.indexOf("[");
    const lastBracket = cleaned.lastIndexOf("]");
    if (
      firstBracket !== -1 &&
      lastBracket > firstBracket &&
      (firstBrace === -1 || firstBracket < firstBrace)
    ) {
      try {
        return JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
      } catch {}
    }
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {}
    }
    return {};
  }
}

async function callCodeCraftChat({
  apiKey,
  baseUrl,
  model,
  prompt,
  systemInstruction,
  imageBase64,
  imageMime,
  jsonMode = false,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  systemInstruction?: string;
  imageBase64?: string | null;
  imageMime?: string;
  jsonMode?: boolean;
}) {
  if (!apiKey) {
    throw new Error(
      "CodeCraft API key is not configured. Add CODECRAFT_API_KEY in Vercel Environment Variables or configure it in Settings > CodeCraft API."
    );
  }
  const messages: any[] = [];
  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }
  if (imageBase64) {
    const cleanB64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
    messages.push({
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: { url: `data:${imageMime || "image/jpeg"};base64,${cleanB64}` },
        },
      ],
    });
  } else {
    messages.push({ role: "user", content: prompt });
  }

  const doRequest = async (useJsonFormat: boolean) => {
    const body: any = {
      model,
      messages,
      temperature: 0.7,
    };
    if (useJsonFormat) {
      body.response_format = { type: "json_object" };
    }
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  };

  let { res, data } = await doRequest(jsonMode);
  if (!res.ok && jsonMode) {
    const retry = await doRequest(false);
    res = retry.res;
    data = retry.data;
  }

  if (!res.ok) {
    throw new Error(
      data?.error?.message || data?.error || `CodeCraft Chat API failed (${res.status})`
    );
  }
  return data?.choices?.[0]?.message?.content || "";
}

// Health & Provider Status Route
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    runtime: process.env.VERCEL ? "vercel-serverless" : "node-express",
    geminiConfigured: !!resolveGeminiEnvKey(),
    codecraftConfigured: !!(
      runtimeCodeCraftConfig.apiKey ||
      process.env.CODECRAFT_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.VITE_CODECRAFT_API_KEY
    ),
    youtubeApiConfigured: !!process.env.YOUTUBE_API_KEY,
  });
});

app.get("/api/providers/status", (_req, res) => {
  res.json({
    geminiConfigured: !!resolveGeminiEnvKey(),
    codecraftConfigured: !!(
      runtimeCodeCraftConfig.apiKey ||
      process.env.CODECRAFT_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.VITE_CODECRAFT_API_KEY
    ),
    youtubeApiConfigured: !!process.env.YOUTUBE_API_KEY,
    codecraftConfig: {
      hasKey: !!(
        runtimeCodeCraftConfig.apiKey ||
        process.env.CODECRAFT_API_KEY ||
        process.env.OPENAI_API_KEY ||
        process.env.VITE_CODECRAFT_API_KEY
      ),
      baseUrl: runtimeCodeCraftConfig.baseUrl,
      textModel: runtimeCodeCraftConfig.textModel,
      imageModel: runtimeCodeCraftConfig.imageModel,
      ttsModel: runtimeCodeCraftConfig.ttsModel,
      ttsVoice: runtimeCodeCraftConfig.ttsVoice,
    },
  });
});

app.post("/api/providers/codecraft-config", async (req, res) => {
  try {
    const { apiKey, baseUrl, textModel, imageModel, ttsModel, ttsVoice, testConnection } =
      req.body || {};
    if (typeof apiKey === "string" && apiKey.trim() && !apiKey.includes("••")) {
      runtimeCodeCraftConfig.apiKey = apiKey.trim();
    }
    if (baseUrl) runtimeCodeCraftConfig.baseUrl = String(baseUrl).replace(/\/+$/, "");
    if (textModel) runtimeCodeCraftConfig.textModel = String(textModel).trim();
    if (imageModel) runtimeCodeCraftConfig.imageModel = String(imageModel).trim();
    if (ttsModel) runtimeCodeCraftConfig.ttsModel = String(ttsModel).trim();
    if (ttsVoice) runtimeCodeCraftConfig.ttsVoice = String(ttsVoice).trim();

    const effectiveKey =
      (typeof apiKey === "string" && apiKey.trim() && !apiKey.includes("••")
        ? apiKey.trim()
        : "") ||
      runtimeCodeCraftConfig.apiKey ||
      process.env.CODECRAFT_API_KEY ||
      process.env.OPENAI_API_KEY ||
      "";

    let modelsList: string[] = [];
    if (testConnection) {
      if (!effectiveKey) {
        return res.status(400).json({
          error:
            "No CodeCraft API key provided. Enter your API key or set CODECRAFT_API_KEY in Vercel Environment Variables.",
        });
      }
      const mRes = await fetch(`${runtimeCodeCraftConfig.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${effectiveKey}` },
      });
      if (mRes.ok) {
        const mData = await mRes.json().catch(() => ({}));
        if (Array.isArray(mData?.data)) {
          modelsList = mData.data.map((m: any) => m.id).filter(Boolean);
        }
      } else {
        await callCodeCraftChat({
          apiKey: effectiveKey,
          baseUrl: runtimeCodeCraftConfig.baseUrl,
          model: runtimeCodeCraftConfig.textModel,
          prompt: "Reply with OK",
        });
      }
    }

    res.json({
      ok: true,
      hasKey: !!effectiveKey,
      baseUrl: runtimeCodeCraftConfig.baseUrl,
      textModel: runtimeCodeCraftConfig.textModel,
      imageModel: runtimeCodeCraftConfig.imageModel,
      ttsModel: runtimeCodeCraftConfig.ttsModel,
      ttsVoice: runtimeCodeCraftConfig.ttsVoice,
      models: modelsList,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to verify CodeCraft API connection." });
  }
});

// Robust YouTube URL & Video ID parser supporting watch, youtu.be, shorts, embed, live, mobile, and raw 11-char IDs
export function extractVideoId(input: string): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;

  // Direct 11-character YouTube video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) {
    return raw;
  }

  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const u = new URL(withProto);
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");

    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }

    if (
      host === "youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtube-nocookie.com"
    ) {
      const v = u.searchParams.get("v") || u.searchParams.get("vi");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

      const parts = u.pathname.split("/").filter(Boolean);
      if (
        parts.length >= 2 &&
        ["shorts", "embed", "v", "live", "watch", "e"].includes(parts[0].toLowerCase())
      ) {
        const candidate = parts[1];
        if (candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate)) return candidate;
      }
    }
  } catch {
    // Fall through to regex extraction
  }

  const m = raw.match(
    /(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|v\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i
  );
  if (m && m[1]) return m[1];

  return null;
}

function formatIsoDuration(iso: string): string {
  if (!iso || typeof iso !== "string") return "";
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return iso;
  const h = parseInt(match[1] || "0", 10);
  const m = parseInt(match[2] || "0", 10);
  const s = parseInt(match[3] || "0", 10);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function handleYouTubeMetadata(req: express.Request, res: express.Response) {
  try {
    const rawUrl = (req.body?.url || req.query?.url || req.body?.videoId || req.query?.videoId || "") as string;
    if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
      return res.status(400).json({ error: "Please provide a valid YouTube URL or video ID." });
    }

    const videoId = extractVideoId(rawUrl);
    if (!videoId) {
      return res.status(400).json({
        error:
          "Invalid YouTube URL or Video ID. Supported formats: youtube.com/watch?v=..., youtu.be/..., youtube.com/shorts/..., youtube.com/embed/..., or an 11-character video ID.",
      });
    }

    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    let title = "";
    let author = "";
    let authorUrl = "";
    let description = "";
    let duration = "";
    let durationSec = 0;
    let views = "";
    let publishedAt = "";
    let thumbnailUrl = "";
    let oembedOk = false;
    let dataApiOk = false;

    // 1. Query YouTube oEmbed (public, no API key required)
    try {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; NarrativeStudio/1.0)",
            Accept: "application/json",
          },
        }
      );
      if (oembedRes.ok) {
        const data = await oembedRes.json();
        title = data.title || "";
        author = data.author_name || "";
        authorUrl = data.author_url || "";
        if (data.thumbnail_url) thumbnailUrl = data.thumbnail_url;
        oembedOk = true;
      } else if (oembedRes.status === 404 || oembedRes.status === 401 || oembedRes.status === 403) {
        // Might be private, deleted, or embedding disabled; check Data API or Noembed fallback
      }
    } catch {}

    // 1b. Fallback public oEmbed via noembed.com if direct youtube oEmbed failed or was blocked
    if (!oembedOk) {
      try {
        const noembedRes = await fetch(
          `https://noembed.com/embed?url=${encodeURIComponent(canonicalUrl)}`
        );
        if (noembedRes.ok) {
          const neData = await noembedRes.json();
          if (neData && !neData.error && neData.title) {
            title = neData.title || title;
            author = neData.author_name || author;
            authorUrl = neData.author_url || authorUrl;
            if (neData.thumbnail_url) thumbnailUrl = neData.thumbnail_url;
            oembedOk = true;
          }
        }
      } catch {}
    }

    // 2. Enrich with YouTube Data API v3 if YOUTUBE_API_KEY is configured
    if (process.env.YOUTUBE_API_KEY) {
      try {
        const ytApiRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${encodeURIComponent(
            videoId
          )}&key=${encodeURIComponent(process.env.YOUTUBE_API_KEY)}`
        );
        if (ytApiRes.ok) {
          const ytData = await ytApiRes.json();
          const item = ytData.items?.[0];
          if (item) {
            dataApiOk = true;
            title = item.snippet?.title || title;
            author = item.snippet?.channelTitle || author;
            description = item.snippet?.description || "";
            publishedAt = item.snippet?.publishedAt || "";
            const rawIsoDur = item.contentDetails?.duration || "";
            duration = formatIsoDuration(rawIsoDur) || rawIsoDur;
            const isoMatch = rawIsoDur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
            if (isoMatch) {
              durationSec =
                parseInt(isoMatch[1] || "0", 10) * 3600 +
                parseInt(isoMatch[2] || "0", 10) * 60 +
                parseInt(isoMatch[3] || "0", 10);
            }
            views = item.statistics?.viewCount || "";
            thumbnailUrl =
              item.snippet?.thumbnails?.maxres?.url ||
              item.snippet?.thumbnails?.standard?.url ||
              item.snippet?.thumbnails?.high?.url ||
              thumbnailUrl;
          }
        }
      } catch {}
    }

    // 3. Verify and fetch best available thumbnail for Vision analysis
    const candidateThumbUrls = [
      thumbnailUrl,
      `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    ].filter(Boolean);

    let thumbnailBase64: string | null = null;
    let thumbnailMime = "image/jpeg";
    let resolvedThumbUrl = "";

    for (const candidate of candidateThumbUrls) {
      try {
        const imgRes = await fetch(candidate);
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          // Ignore tiny 1x1 or default 404 placeholder images (< 1.5KB)
          if (buf.byteLength > 1500) {
            thumbnailBase64 = buf.toString("base64");
            thumbnailMime = imgRes.headers.get("content-type") || "image/jpeg";
            resolvedThumbUrl = candidate;
            break;
          }
        }
      } catch {}
    }

    // Do not fabricate metadata if the video does not exist or is completely inaccessible
    if (!oembedOk && !dataApiOk && !title) {
      return res.status(404).json({
        error:
          "Could not retrieve metadata for this YouTube video. The video may be private, unavailable, or the video ID does not exist.",
        videoId,
      });
    }

    return res.json({
      videoId,
      url: canonicalUrl,
      title,
      author,
      authorUrl,
      description,
      duration,
      durationSec,
      views,
      publishedAt,
      thumbnailUrl: resolvedThumbUrl || thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      thumbnailBase64,
      thumbnailMime,
      source: dataApiOk ? "youtube_data_api_v3" : "youtube_oembed",
      transcriptAccessible: false,
      notice: dataApiOk
        ? "Full metadata, duration, description, and thumbnail retrieved via YouTube Data API v3. Paste a transcript or reference notes below if you want spoken-word pacing analysis."
        : "Public title, channel, and thumbnail retrieved via YouTube oEmbed. Full transcript and audio are not provided by oEmbed—paste a transcript or reference notes if you want spoken-content analysis.",
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to fetch YouTube metadata." });
  }
}

// 1. Fetch YouTube Reference Metadata via authorized oEmbed / Data API (supports both POST and GET)
app.post("/api/youtube/metadata", handleYouTubeMetadata);
app.get("/api/youtube/metadata", handleYouTubeMetadata);

// 2. Analyze Reference + Thumbnail Vision + Generate 5 Original Concepts + Visual Style Lock
app.post("/api/ai/analyze-reference", async (req, res) => {
  try {
    const {
      projectName,
      youtubeUrl,
      referenceTitle,
      channelName,
      description,
      pastedTranscript,
      nichePreference,
      languagePreference,
      thumbnailBase64,
      thumbnailMime,
      provider: requestedProvider,
    } = req.body || {};

    const provider = resolveEffectiveProvider(requestedProvider, req.body);

    const promptText = `You are an expert YouTube creative director and visual narrative analyst.
Analyze the provided YouTube reference information ${thumbnailBase64 ? "and the attached reference thumbnail image " : ""}to produce:
1. A comprehensive Reference Analysis Report.
2. A Visual Style Lock extracted from the reference's visual appeal (or tailored to the niche if no thumbnail was provided).
3. Exactly 5 distinct, original video concepts inspired by the reference's general appeal, curiosity gap, and audience—without copying the reference's title or script.

Reference Details:
- Project Name: ${projectName || "Untitled Project"}
- YouTube URL: ${youtubeUrl || "N/A"}
- Reference Title: ${referenceTitle || "Not provided"}
- Channel: ${channelName || "Unknown"}
- Description: ${description || "Not provided"}
- Niche Preference: ${nichePreference || "Infer from reference"}
- Language Preference: ${languagePreference || "English (US)"}
- Pasted Transcript / Notes: ${pastedTranscript ? String(pastedTranscript).slice(0, 12000) : "Not provided (analyze based on title, metadata, and thumbnail vision only; note clearly in narrationTone that transcript was not supplied)"}

IMPORTANT RULES:
- Never assume the channel is about finance or business unless the reference explicitly is. Adapt naturally to history, science, documentary, mystery, nature, storytelling, education, technology, etc.
- Generate 5 genuinely distinct, original concepts with compelling titles, premises, hooks, and payoffs.`;

    if (provider === "codecraft") {
      const cc = getCodeCraftCreds(req.body);
      const rawJson = await callCodeCraftChat({
        apiKey: cc.apiKey,
        baseUrl: cc.baseUrl,
        model: cc.textModel,
        prompt: `${promptText}\n\nReturn strictly valid JSON with keys: "analysis" (mainTopic, niche, subNiche, targetAudience, curiosityGap, openingHook, storytellingStructure, narrationTone, visualStyle, colorPalette, characterDesign, compositionLighting, engagementFactors[], originalOpportunities[], transcriptAnalyzed), "visualStyleLock" (artStyle, characterRules, facialVisibility, clothingSilhouette, colorPalette, lighting, backgroundTreatment, composition, lineworkShading, aspectRatio), and "concepts" (array of 5 objects with id, title, premise, niche, subNiche, targetAudience, mainHook, storyStructure, narrationStyle, visualDirection, viewerAppeal, differentiation, payoff).`,
        imageBase64: thumbnailBase64,
        imageMime: thumbnailMime,
        jsonMode: true,
      });
      return res.json(parseJsonClean(rawJson));
    }

    const ai = getAI();
    const parts: any[] = [];
    if (thumbnailBase64) {
      const cleanB64 = String(thumbnailBase64).replace(/^data:[^;]+;base64,/, "");
      parts.push({
        inlineData: {
          mimeType: thumbnailMime || "image/jpeg",
          data: cleanB64,
        },
      });
    }
    parts.push({ text: promptText });

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: { parts },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            analysis: {
              type: Type.OBJECT,
              properties: {
                mainTopic: { type: Type.STRING },
                niche: { type: Type.STRING },
                subNiche: { type: Type.STRING },
                targetAudience: { type: Type.STRING },
                curiosityGap: { type: Type.STRING },
                openingHook: { type: Type.STRING },
                storytellingStructure: { type: Type.STRING },
                narrationTone: { type: Type.STRING },
                visualStyle: { type: Type.STRING },
                colorPalette: { type: Type.STRING },
                characterDesign: { type: Type.STRING },
                compositionLighting: { type: Type.STRING },
                engagementFactors: { type: Type.ARRAY, items: { type: Type.STRING } },
                originalOpportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
                transcriptAnalyzed: { type: Type.BOOLEAN },
              },
              required: [
                "mainTopic",
                "niche",
                "subNiche",
                "targetAudience",
                "curiosityGap",
                "openingHook",
                "storytellingStructure",
                "narrationTone",
                "visualStyle",
                "colorPalette",
                "characterDesign",
                "compositionLighting",
                "engagementFactors",
                "originalOpportunities",
                "transcriptAnalyzed",
              ],
            },
            visualStyleLock: {
              type: Type.OBJECT,
              properties: {
                artStyle: { type: Type.STRING },
                characterRules: { type: Type.STRING },
                facialVisibility: { type: Type.STRING },
                clothingSilhouette: { type: Type.STRING },
                colorPalette: { type: Type.STRING },
                lighting: { type: Type.STRING },
                backgroundTreatment: { type: Type.STRING },
                composition: { type: Type.STRING },
                lineworkShading: { type: Type.STRING },
                aspectRatio: { type: Type.STRING },
              },
              required: [
                "artStyle",
                "characterRules",
                "facialVisibility",
                "clothingSilhouette",
                "colorPalette",
                "lighting",
                "backgroundTreatment",
                "composition",
                "lineworkShading",
                "aspectRatio",
              ],
            },
            concepts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  premise: { type: Type.STRING },
                  niche: { type: Type.STRING },
                  subNiche: { type: Type.STRING },
                  targetAudience: { type: Type.STRING },
                  mainHook: { type: Type.STRING },
                  storyStructure: { type: Type.STRING },
                  narrationStyle: { type: Type.STRING },
                  visualDirection: { type: Type.STRING },
                  viewerAppeal: { type: Type.STRING },
                  differentiation: { type: Type.STRING },
                  payoff: { type: Type.STRING },
                },
                required: [
                  "id",
                  "title",
                  "premise",
                  "niche",
                  "subNiche",
                  "targetAudience",
                  "mainHook",
                  "storyStructure",
                  "narrationStyle",
                  "visualDirection",
                  "viewerAppeal",
                  "differentiation",
                  "payoff",
                ],
              },
            },
          },
          required: ["analysis", "visualStyleLock", "concepts"],
        },
      },
    });

    const parsed = parseJsonClean(response.text || "{}");
    res.json(parsed);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "AI reference analysis failed." });
  }
});

// 3. Regenerate 5 Concepts
app.post("/api/ai/regenerate-concepts", async (req, res) => {
  try {
    const { analysis, customDirection, provider: requestedProvider } = req.body || {};
    const provider = resolveEffectiveProvider(requestedProvider, req.body);
    const prompt = `Generate 5 new, distinct, original YouTube video concepts based on this reference analysis:
${JSON.stringify(analysis, null, 2)}
${customDirection ? `Additional user direction: ${customDirection}` : ""}
Return strictly JSON with key "concepts" (array of 5 objects with id, title, premise, niche, subNiche, targetAudience, mainHook, storyStructure, narrationStyle, visualDirection, viewerAppeal, differentiation, payoff).`;

    if (provider === "codecraft") {
      const cc = getCodeCraftCreds(req.body);
      const raw = await callCodeCraftChat({
        apiKey: cc.apiKey,
        baseUrl: cc.baseUrl,
        model: cc.textModel,
        prompt,
        jsonMode: true,
      });
      return res.json(parseJsonClean(raw));
    }

    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            concepts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  premise: { type: Type.STRING },
                  niche: { type: Type.STRING },
                  subNiche: { type: Type.STRING },
                  targetAudience: { type: Type.STRING },
                  mainHook: { type: Type.STRING },
                  storyStructure: { type: Type.STRING },
                  narrationStyle: { type: Type.STRING },
                  visualDirection: { type: Type.STRING },
                  viewerAppeal: { type: Type.STRING },
                  differentiation: { type: Type.STRING },
                  payoff: { type: Type.STRING },
                },
                required: [
                  "id",
                  "title",
                  "premise",
                  "niche",
                  "subNiche",
                  "targetAudience",
                  "mainHook",
                  "storyStructure",
                  "narrationStyle",
                  "visualDirection",
                  "viewerAppeal",
                  "differentiation",
                  "payoff",
                ],
              },
            },
          },
          required: ["concepts"],
        },
      },
    });
    res.json(parseJsonClean(response.text || "{}"));
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to regenerate concepts." });
  }
});

// 4. Generate Full Narration Script or Transform Script
app.post("/api/ai/generate-script", async (req, res) => {
  try {
    const {
      concept,
      analysis,
      targetDurationMinutes,
      scriptPreset,
      channelProfile,
      language,
      action,
      currentScript,
      selectedText,
      provider: requestedProvider,
    } = req.body || {};

    const provider = resolveEffectiveProvider(requestedProvider, req.body);
    const targetWords = Math.round((Number(targetDurationMinutes) || 8) * 145);
    const channelContext = channelProfile
      ? `\nCHANNEL BRAND PROFILE (${channelProfile.name || "Active Channel"}):
- Channel Niche: ${channelProfile.niche || ""}
- Channel Master Instructions (Script, Visuals & Scenes): ${channelProfile.promptRules || ""}
- Additional Script Instructions: ${channelProfile.additionalScriptRules || ""}
- Channel Narration & Delivery Style: ${channelProfile.narrationStyle || ""}
- Channel Scriptwriting Rules & Hook Formula: ${channelProfile.scriptStyle || ""}\n`
      : "";

    let prompt = "";
    if (action && action !== "generate" && currentScript) {
      prompt = `You are a master YouTube narrative scriptwriter.
Perform the requested action ("${action}") on the narration script below.
Selected Concept: ${concept?.title || "Untitled"} — ${concept?.premise || ""}
Language: ${language || "English (US)"}
Style Preset: ${scriptPreset?.name || "Documentary"} (${scriptPreset?.instructions || "Engaging, natural voiceover narration"})${channelContext}
${selectedText ? `Target Selection to modify:\n"""${selectedText}"""\n` : ""}
Current Script:
"""
${currentScript}
"""
Return ONLY the updated spoken narration script text (no stage directions, no speaker labels, no markdown headers, natural pauses with '...' where appropriate).`;
    } else {
      prompt = `Write a complete, original, deeply engaging voice-over narration script for a YouTube video.

Concept Title: ${concept?.title || "Untitled"}
Premise: ${concept?.premise || ""}
Niche: ${channelProfile?.niche || concept?.niche || analysis?.niche || "General"} (${concept?.subNiche || ""})
Target Audience: ${concept?.targetAudience || analysis?.targetAudience || "General audience"}
Opening Hook Direction: ${concept?.mainHook || ""}
Story Structure: ${concept?.storyStructure || ""}
Ending / Payoff: ${concept?.payoff || ""}

Production Configuration:
- Target Video Duration: ${targetDurationMinutes || 8} minutes (Target approximately ${targetWords} words at ~145 words/minute)
- Language: ${language || "English (US)"}
- Script Style Preset: ${scriptPreset?.name || "Documentary"}
- Tone & Instructions: ${channelProfile?.promptRules || scriptPreset?.instructions || "Clear, compelling storytelling with strong curiosity gaps"}
- Additional Script Rules: ${channelProfile?.additionalScriptRules || ""}${channelContext}

Strict Requirements:
1. Output ONLY the spoken voice-over narration text, separated into clean paragraphs.
2. Do NOT include "[Scene 1]", "Narrator:", stage directions, or markdown headings—only the exact words to be spoken.
3. Open with a powerful hook in the first 15 seconds.
4. Use natural transitions between ideas and subtle "..." pauses suitable for voice-over delivery.
5. Avoid repetitive filler or robotic phrasing. Deliver a satisfying ending payoff.`;
    }

    if (provider === "codecraft") {
      const cc = getCodeCraftCreds(req.body);
      const scriptText = await callCodeCraftChat({
        apiKey: cc.apiKey,
        baseUrl: cc.baseUrl,
        model: cc.textModel,
        prompt,
      });
      return res.json({ script: (scriptText || "").trim() });
    }

    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    res.json({ script: (response.text || "").trim() });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Script generation failed." });
  }
});

// 5. Generate Voice-Over Audio via Gemini TTS or CodeCraft OpenAI-Compatible Audio Speech API
app.post("/api/ai/generate-tts", async (req, res) => {
  try {
    const {
      text,
      voiceName = "Kore",
      provider: requestedProvider,
    } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Script text is required for voice-over generation." });
    }
    const provider = resolveEffectiveProvider(requestedProvider, req.body);
    const excerpt = text.slice(0, 4096);

    if (provider === "codecraft") {
      const cc = getCodeCraftCreds(req.body);
      if (!cc.apiKey) {
        return res.status(400).json({
          error: "CodeCraft API key is not configured for TTS. Add CODECRAFT_API_KEY in Vercel Environment Variables or Settings.",
        });
      }
      const chosenVoice = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"].includes(
        String(voiceName).toLowerCase()
      )
        ? String(voiceName).toLowerCase()
        : cc.ttsVoice || "alloy";

      const ttsRes = await fetch(`${cc.baseUrl}/audio/speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cc.apiKey}`,
        },
        body: JSON.stringify({
          model: cc.ttsModel || "tts-1",
          input: excerpt,
          voice: chosenVoice,
          response_format: "mp3",
        }),
      });

      if (!ttsRes.ok) {
        const errData = await ttsRes.json().catch(() => ({}));
        throw new Error(
          errData?.error?.message ||
            errData?.error ||
            `CodeCraft TTS endpoint (/audio/speech) returned status ${ttsRes.status}`
        );
      }
      const arrayBuffer = await ttsRes.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString("base64");
      const contentType = ttsRes.headers.get("content-type") || "audio/mpeg";
      return res.json({
        audioBase64: base64Audio,
        audioDataUrl: `data:${contentType};base64,${base64Audio}`,
        mimeType: contentType,
        voiceUsed: chosenVoice,
        providerUsed: "codecraft",
      });
    }

    const ai = getAI();
    const validVoices = ["Puck", "Charon", "Kore", "Fenrir", "Zephyr"];
    const chosenVoice = validVoices.includes(voiceName) ? voiceName : "Kore";

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash-lite-tts",
      contents: [
        {
          role: "user",
          parts: [{ text: excerpt }],
        },
      ],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: chosenVoice },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error("TTS model did not return audio data.");
    }
    res.json({
      audioBase64: base64Audio,
      audioDataUrl: `data:audio/wav;base64,${base64Audio}`,
      mimeType: "audio/wav",
      voiceUsed: chosenVoice,
      providerUsed: "gemini",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Voice-over generation failed." });
  }
});

// 5b. Generate Actual Scene Image via CodeCraft Image API (/images/generations) or Gemini Image Model
app.post("/api/ai/generate-scene-image", async (req, res) => {
  try {
    const {
      prompt,
      aspectRatio = "16:9",
      provider: requestedProvider = "codecraft",
    } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Image prompt is required." });
    }

    const provider = resolveEffectiveProvider(requestedProvider, req.body);

    if (provider === "codecraft") {
      const cc = getCodeCraftCreds(req.body);
      if (!cc.apiKey) {
        return res.status(400).json({
          error: "CodeCraft API key is not configured. Configure it in Settings > CodeCraft API or set CODECRAFT_API_KEY in Vercel.",
        });
      }
      const size = aspectRatio === "9:16" ? "1024x1792" : "1792x1024";
      const imgRes = await fetch(`${cc.baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cc.apiKey}`,
        },
        body: JSON.stringify({
          model: cc.imageModel || "dall-e-3",
          prompt,
          n: 1,
          size,
          response_format: "b64_json",
        }),
      });

      const imgData = await imgRes.json().catch(() => ({}));
      if (!imgRes.ok) {
        throw new Error(
          imgData?.error?.message ||
            imgData?.error ||
            `CodeCraft Image Generation failed (${imgRes.status})`
        );
      }

      const item = imgData?.data?.[0];
      if (item?.b64_json) {
        return res.json({
          imageBase64: item.b64_json,
          imageDataUrl: `data:image/png;base64,${item.b64_json}`,
          mimeType: "image/png",
          providerUsed: "codecraft",
        });
      }
      if (item?.url) {
        const fetched = await fetch(item.url);
        const buf = Buffer.from(await fetched.arrayBuffer());
        const b64 = buf.toString("base64");
        const mime = fetched.headers.get("content-type") || "image/png";
        return res.json({
          imageBase64: b64,
          imageDataUrl: `data:${mime};base64,${b64}`,
          mimeType: mime,
          providerUsed: "codecraft",
        });
      }
      throw new Error("CodeCraft API did not return an image payload.");
    }

    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-image",
      contents: { parts: [{ text: prompt }] },
      config: {
        imageConfig: {
          aspectRatio: aspectRatio === "9:16" ? "9:16" : "16:9",
        },
      },
    });
    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const mime = part.inlineData.mimeType || "image/png";
        return res.json({
          imageBase64: part.inlineData.data,
          imageDataUrl: `data:${mime};base64,${part.inlineData.data}`,
          mimeType: mime,
          providerUsed: "gemini",
        });
      }
    }
    throw new Error("Image model did not return an inline image.");
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Scene image generation failed." });
  }
});

// 6. Scene Breakdown (Variable, Script-Driven Scene Durations Synchronized with Real Audio)
app.post("/api/ai/scene-breakdown", async (req, res) => {
  try {
    const {
      script,
      actualDurationSec,
      concept,
      visualStylePreset,
      channelProfile,
      provider: requestedProvider,
    } = req.body || {};
    if (!script || typeof script !== "string") {
      return res.status(400).json({ error: "Approved script is required for scene breakdown." });
    }
    const provider = resolveEffectiveProvider(requestedProvider, req.body);
    const totalSec = Math.max(10, Number(actualDurationSec) || 180);
    const scriptWords = script.trim().split(/\s+/).filter(Boolean);
    const totalWordCount = scriptWords.length;

    const byDuration = Math.round(totalSec / 5.2);
    const byWords = Math.round(totalWordCount / 14);
    const targetSceneCount = Math.max(8, Math.min(120, Math.max(byDuration, byWords)));
    const maxWordsPerScene = Math.max(16, Math.ceil((totalWordCount / targetSceneCount) * 1.65));

    const prompt = `Split the following approved voice-over script into a natural, dynamically-paced sequence of visual scenes synchronized with the narration.

Concept: ${concept?.title || "Video Project"}
Channel Brand & Prompt Rules: ${channelProfile?.promptRules || ""}
Additional Scene & Visual Rules: ${channelProfile?.additionalSceneRules || ""}
Visual Style: ${channelProfile?.visualStyleRules || visualStylePreset?.name || "Cinematic Documentary"} (${visualStylePreset?.rules || ""})
${channelProfile?.avatarCharacterDesc ? `Channel Host / Avatar Character: ${channelProfile.avatarCharacterDesc}` : ""}
${channelProfile?.motionStyle ? `Channel Motion & Transition Style: ${channelProfile.motionStyle}` : ""}
Total Authoritative Audio Duration: ${totalSec} seconds (${totalWordCount} words).
Target Scene Count: Approximately ${targetSceneCount} scenes.

APPROVED SCRIPT:
"""
${script}
"""

CRITICAL DYNAMIC TIMING & CONTINUITY RULES:
1. VARIABLE SCENE DURATIONS (NOT FIXED): Do NOT make every scene the same length! Let the natural meaning, dramatic beats, punctuation, and sentence structure of the script dictate each scene's length:
   - Short, punchy hooks, quick reveals, or fast action beats should be brief excerpts (e.g., 5–10 words, lasting ~2.5s to 4.5s).
   - Deep explanations, emotional pauses, or atmospheric establishing beats should be longer excerpts (e.g., 15–26 words, lasting ~5.5s to 9.5s).
2. Generate approximately ${targetSceneCount} scenes in total.
3. Every scene must correspond to a contiguous excerpt of the approved script. Taken together in order, the scene scriptExcerpt fields MUST cover 100% of the script with no missing sentences and no duplicated text.
4. Provide a vivid visualDescription, mainSubject, environment, emotionalTone, cameraFraming ("wide shot", "medium shot", "close-up", "aerial establishing shot", "low-angle shot", "over-the-shoulder"), and transitionSuggestion ("cut", "fade", "wipeleft", "CrossZoom", "ZoomIn", etc.) for every scene.`;

    let rawScenes: any[] = [];

    if (provider === "codecraft") {
      const cc = getCodeCraftCreds(req.body);
      const rawJson = await callCodeCraftChat({
        apiKey: cc.apiKey,
        baseUrl: cc.baseUrl,
        model: cc.textModel,
        prompt: `${prompt}\n\nReturn strictly valid JSON with key "scenes" containing an array of ~${targetSceneCount} scene objects with: scriptExcerpt, visualDescription, mainSubject, environment, emotionalTone, cameraFraming, transitionSuggestion.`,
        jsonMode: true,
      });
      const parsed = parseJsonClean(rawJson);
      rawScenes = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.scenes)
        ? parsed.scenes
        : Array.isArray(parsed?.data)
        ? parsed.data
        : [];
    } else {
      const ai = getAI();
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    scriptExcerpt: { type: Type.STRING },
                    visualDescription: { type: Type.STRING },
                    mainSubject: { type: Type.STRING },
                    environment: { type: Type.STRING },
                    emotionalTone: { type: Type.STRING },
                    cameraFraming: { type: Type.STRING },
                    transitionSuggestion: { type: Type.STRING },
                  },
                  required: ["scriptExcerpt", "visualDescription"],
                },
              },
            },
            required: ["scenes"],
          },
        },
      });
      const parsed = parseJsonClean(response.text || "{}");
      rawScenes = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.scenes)
        ? parsed.scenes
        : [];
    }

    if (!rawScenes.length) {
      rawScenes = [
        {
          scriptExcerpt: script,
          visualDescription: `${concept?.title || "Cinematic documentary scene"} — ${
            channelProfile?.visualStyleRules || visualStylePreset?.name || "high detail visual"
          }`,
          mainSubject: concept?.title || "Narrator subject",
          environment: "Cinematic environment",
          emotionalTone: "Engaging",
          cameraFraming: "wide shot",
          transitionSuggestion: "fade",
        },
      ];
    }

    const balancedScenes: any[] = [];
    const framingsCycle = ["wide shot", "medium shot", "close-up", "low-angle shot", "over-the-shoulder", "aerial shot"];
    for (const sc of rawScenes) {
      const excerpt = String(sc.scriptExcerpt || "").trim();
      const words = excerpt.split(/\s+/).filter(Boolean);
      if (words.length > maxWordsPerScene && words.length >= 25) {
        const sentences = excerpt
          .split(/(?<=[.!?؟،,;:])\s+/)
          .map((s) => s.trim())
          .filter(Boolean);

        if (sentences.length > 1) {
          let buf: string[] = [];
          let bufWords = 0;
          for (const sent of sentences) {
            const sLen = sent.split(/\s+/).filter(Boolean).length;
            if (bufWords > 0 && bufWords + sLen > 18) {
              balancedScenes.push({
                ...sc,
                scriptExcerpt: buf.join(" "),
                cameraFraming: framingsCycle[balancedScenes.length % framingsCycle.length],
              });
              buf = [sent];
              bufWords = sLen;
            } else {
              buf.push(sent);
              bufWords += sLen;
            }
          }
          if (buf.length > 0) {
            balancedScenes.push({
              ...sc,
              scriptExcerpt: buf.join(" "),
              cameraFraming: framingsCycle[balancedScenes.length % framingsCycle.length],
            });
          }
        } else {
          const pattern = [9, 15, 12, 18, 11];
          let idx = 0;
          let step = 0;
          while (idx < words.length) {
            const size = pattern[step % pattern.length];
            const slice = words.slice(idx, idx + size).join(" ");
            balancedScenes.push({
              ...sc,
              scriptExcerpt: slice,
              cameraFraming: framingsCycle[(balancedScenes.length + step) % framingsCycle.length],
            });
            idx += size;
            step++;
          }
        }
      } else {
        balancedScenes.push(sc);
      }
    }

    const finalRawScenes = balancedScenes.length ? balancedScenes : rawScenes;

    const sceneWeights = finalRawScenes.map((s: any) => {
      const txt = String(s.scriptExcerpt || "").trim();
      const wordCount = Math.max(1, txt.split(/\s+/).filter(Boolean).length);
      const pauseMarks = (txt.match(/(\.\.\.|[.!?؟،—;:]+)/g) || []).length;
      const charFactor = Math.max(1, txt.length / 5.2);
      return wordCount * 0.65 + charFactor * 0.35 + pauseMarks * 0.85;
    });
    const totalWeight = sceneWeights.reduce((a: number, b: number) => a + b, 0) || 1;

    let cursor = 0;
    const timedScenes = finalRawScenes.map((s: any, idx: number) => {
      const isLast = idx === finalRawScenes.length - 1;
      const startSec = idx === 0 ? 0 : cursor;
      const rawDur = (sceneWeights[idx] / totalWeight) * totalSec;
      const endSec = isLast ? totalSec : Math.min(totalSec, Math.round((startSec + rawDur) * 10) / 10);
      const durationSec = Math.max(1.2, +(endSec - startSec).toFixed(1));
      cursor = +(startSec + durationSec).toFixed(1);
      return {
        id: `scene_${Date.now()}_${idx + 1}`,
        sceneNumber: idx + 1,
        scriptExcerpt: s.scriptExcerpt,
        startTime: startSec,
        endTime: isLast ? totalSec : cursor,
        duration: isLast ? Math.max(1.0, +(totalSec - startSec).toFixed(1)) : durationSec,
        visualDescription: s.visualDescription,
        mainSubject: s.mainSubject,
        environment: s.environment,
        emotionalTone: s.emotionalTone,
        cameraFraming: s.cameraFraming || "medium shot",
        transitionSuggestion: s.transitionSuggestion || channelProfile?.editorConfig?.transitionType || "fade",
      };
    });

    res.json({ scenes: timedScenes });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Scene breakdown failed." });
  }
});

// 7. Generate Standalone Image Prompts (Fast Parallel Batching + Low Latency Thinking)
app.post("/api/ai/image-prompts", async (req, res) => {
  try {
    const {
      scenes,
      script,
      visualStyleLock,
      visualStylePreset,
      channelProfile,
      aspectRatio = "16:9",
      negativePrompt = "no text in this frame, no watermarks, no logos",
      provider: requestedProvider,
    } = req.body || {};
    if (!Array.isArray(scenes) || !scenes.length) {
      return res.status(400).json({ error: "Scenes array is required to generate image prompts." });
    }

    const provider = resolveEffectiveProvider(requestedProvider, req.body);
    const effectiveAspect = channelProfile?.aspectRatio || aspectRatio || "16:9";

    const formatTimestampTag = (sec: number) => {
      const m = Math.floor((sec || 0) / 60);
      const s = Math.floor((sec || 0) % 60);
      return `${m}-${String(s).padStart(2, "0")}`;
    };

    const buildChunkPrompt = (sceneChunk: any[]) => `Generate one detailed, 100% standalone image prompt for each scene below strictly following the narrative script and the selected Channel's Style, Additional Scene Rules, and Master Prompt rules.

SELECTED CHANNEL & LOCKED VISUAL STYLE RULES (must be explicitly repeated inside EVERY single prompt):
- Channel Name & Niche: ${channelProfile?.name || "Active Channel"} (${channelProfile?.niche || "General"})
- Channel Master Prompt & Visual Instructions: ${channelProfile?.promptRules || ""}
- Additional Scene & Image Instructions: ${channelProfile?.additionalSceneRules || ""}
- Additional Script Context Rules: ${channelProfile?.additionalScriptRules || ""}
- Art Style Rules: ${channelProfile?.visualStyleRules || visualStyleLock?.artStyle || visualStylePreset?.name || "Cinematic illustration"}
- Character / Channel Avatar Rules: ${channelProfile?.avatarCharacterDesc || visualStyleLock?.characterRules || "Consistent proportions and silhouette"}
- Color Palette & Lighting: ${visualStyleLock?.colorPalette || "Rich atmospheric contrast"}, ${visualStyleLock?.lighting || "Volumetric cinematic lighting"}
- Aspect Ratio: ${effectiveAspect}
- Negative Rules: ${negativePrompt}
${
  script
    ? `\nNARRATION SCRIPT CONTEXT:\n"""\n${String(script).slice(0, 1600)}\n"""\n`
    : ""
}
SCENES TO PROMPT:
${sceneChunk
  .map(
    (s: any) =>
      `Scene ${s.sceneNumber} (ID: ${s.id}, Timestamp: ${formatTimestampTag(s.startTime)}, Duration: ${s.duration}s, Framing: ${s.cameraFraming}):
Script Excerpt: "${s.scriptExcerpt}"
Visual Description: ${s.visualDescription}
Main Subject: ${s.mainSubject || ""}
Environment: ${s.environment || ""}`
  )
  .join("\n\n")}

CRITICAL STANDALONE RULE:
- Repeat all character/avatar, color palette, lighting, and channel visual style details inside EVERY prompt so each prompt works independently.
- Format each prompt:
"[sceneNumber]-#[timestamp] [cameraFraming], [complete visual description], [character/avatar and environment details], [channel locked visual style], [lighting and color palette], no text in this frame, --ar ${effectiveAspect}"`;

    const CHUNK_SIZE = 10;
    const chunks: any[][] = [];
    for (let i = 0; i < scenes.length; i += CHUNK_SIZE) {
      chunks.push(scenes.slice(i, i + CHUNK_SIZE));
    }

    const firstRefImg =
      channelProfile?.styleReferenceImages?.[0] || channelProfile?.avatarImages?.[0] || null;

    let rawPrompts: any[] = [];
    if (provider === "codecraft") {
      const cc = getCodeCraftCreds(req.body);
      const chunkResults = await Promise.all(
        chunks.map(async (chunk) => {
          const rawJson = await callCodeCraftChat({
            apiKey: cc.apiKey,
            baseUrl: cc.baseUrl,
            model: cc.textModel,
            prompt: `${buildChunkPrompt(chunk)}\n\nReturn strictly valid JSON with key "prompts" (array of objects with sceneId, sceneNumber, timestampTag, prompt).`,
            imageBase64: firstRefImg?.dataUrl || null,
            imageMime: firstRefImg?.mimeType || "image/jpeg",
            jsonMode: true,
          });
          const parsed = parseJsonClean(rawJson);
          return Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.prompts)
            ? parsed.prompts
            : [];
        })
      );
      rawPrompts = chunkResults.flat();
    } else {
      const ai = getAI();
      const imageParts: any[] = [];
      for (const img of (channelProfile?.styleReferenceImages || []).slice(0, 1)) {
        if (img?.dataUrl) {
          const cleanB64 = String(img.dataUrl).replace(/^data:[^;]+;base64,/, "");
          imageParts.push({
            inlineData: { data: cleanB64, mimeType: img.mimeType || "image/jpeg" },
          });
        }
      }
      for (const img of (channelProfile?.avatarImages || []).slice(0, 1)) {
        if (img?.dataUrl) {
          const cleanB64 = String(img.dataUrl).replace(/^data:[^;]+;base64,/, "");
          imageParts.push({
            inlineData: { data: cleanB64, mimeType: img.mimeType || "image/jpeg" },
          });
        }
      }

      const chunkResults = await Promise.all(
        chunks.map(async (chunk) => {
          const parts: any[] = [{ text: buildChunkPrompt(chunk) }, ...imageParts];
          const response = await ai.models.generateContent({
            model: "gemini-3.8-flash",
            contents: [{ role: "user", parts }],
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  prompts: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        sceneId: { type: Type.STRING },
                        sceneNumber: { type: Type.INTEGER },
                        timestampTag: { type: Type.STRING },
                        prompt: { type: Type.STRING },
                      },
                      required: ["sceneId", "sceneNumber", "timestampTag", "prompt"],
                    },
                  },
                },
                required: ["prompts"],
              },
            },
          });
          const parsed = parseJsonClean(response.text || "{}");
          return Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.prompts)
            ? parsed.prompts
            : [];
        })
      );
      rawPrompts = chunkResults.flat();
    }

    const finalPrompts = scenes.map((s: any, idx: number) => {
      const found =
        rawPrompts.find((p: any) => p.sceneId === s.id || p.sceneNumber === s.sceneNumber) ||
        rawPrompts[idx];
      const tsTag = formatTimestampTag(s.startTime);
      const artRules =
        channelProfile?.visualStyleRules ||
        channelProfile?.promptRules ||
        visualStyleLock?.artStyle ||
        visualStylePreset?.name ||
        "Cinematic illustration";
      return {
        sceneId: s.id,
        sceneNumber: s.sceneNumber,
        timestampTag: tsTag,
        prompt:
          found?.prompt ||
          `${s.sceneNumber}-#${tsTag} ${s.cameraFraming || "medium shot"}, ${
            s.visualDescription || s.scriptExcerpt
          }, ${channelProfile?.avatarCharacterDesc || ""}, ${artRules}, ${
            visualStyleLock?.lighting || "cinematic lighting"
          }, ${negativePrompt}, --ar ${effectiveAspect}`,
      };
    });

    res.json({ prompts: finalPrompts });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to generate image prompts." });
  }
});

// 8. Generate One-to-One Motion Prompts
app.post("/api/ai/motion-prompts", async (req, res) => {
  try {
    const { scenes, imagePrompts, channelProfile, provider: requestedProvider } = req.body || {};
    if (!Array.isArray(scenes) || !scenes.length) {
      return res.status(400).json({ error: "Scenes are required to generate motion prompts." });
    }

    const provider = resolveEffectiveProvider(requestedProvider, req.body);

    const prompt = `Generate exactly one subtle, cinematic motion prompt for each scene and its corresponding image prompt below.
${channelProfile?.motionStyle || channelProfile?.promptRules ? `\nCHANNEL MOTION & CAMERA STYLE RULES:\n${channelProfile.motionStyle || ""}\n${channelProfile.promptRules || ""}\n` : ""}
RULES FOR MOTION PROMPTS:
- Describe subtle camera behavior (e.g., slow cinematic push-in, gentle camera pan, subtle parallax) and natural environmental motion (moving particles, soft light shifts, gentle breeze).
- Explicitly state that the motion preserves the original image's character identity, clothing, composition, objects, color palette, art style, and main subject placement.
- Never introduce new objects, character redesigns, distortion, or unrequested text.
- Also suggest an editorMotion ("zoomin" or "zoomout") for the timeline Ken Burns engine.

SCENES & IMAGE PROMPTS:
${scenes
  .map((s: any) => {
    const ip = (imagePrompts || []).find((p: any) => p.sceneId === s.id);
    return `Scene ${s.sceneNumber} (sceneId: ${s.id}):
Visual: ${s.visualDescription}
Image Prompt: ${ip?.prompt || s.visualDescription}`;
  })
  .join("\n\n")}`;

    let rawMotions: any[] = [];
    if (provider === "codecraft") {
      const cc = getCodeCraftCreds(req.body);
      const rawJson = await callCodeCraftChat({
        apiKey: cc.apiKey,
        baseUrl: cc.baseUrl,
        model: cc.textModel,
        prompt: `${prompt}\n\nReturn strictly valid JSON with key "motionPrompts" (array of objects with sceneId, sceneNumber, prompt, editorMotion).`,
        jsonMode: true,
      });
      const parsed = parseJsonClean(rawJson);
      rawMotions = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.motionPrompts)
        ? parsed.motionPrompts
        : [];
    } else {
      const ai = getAI();
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              motionPrompts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    sceneId: { type: Type.STRING },
                    sceneNumber: { type: Type.INTEGER },
                    prompt: { type: Type.STRING },
                    editorMotion: { type: Type.STRING },
                  },
                  required: ["sceneId", "sceneNumber", "prompt", "editorMotion"],
                },
              },
            },
            required: ["motionPrompts"],
          },
        },
      });

      const parsed = parseJsonClean(response.text || "{}");
      rawMotions = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.motionPrompts)
        ? parsed.motionPrompts
        : [];
    }

    const finalMotions = scenes.map((s: any, idx: number) => {
      const found =
        rawMotions.find((m: any) => m.sceneId === s.id || m.sceneNumber === s.sceneNumber) ||
        rawMotions[idx];
      return {
        sceneId: s.id,
        sceneNumber: s.sceneNumber,
        prompt:
          found?.prompt ||
          `Slow cinematic camera ${idx % 2 === 0 ? "push-in" : "pull-out"} on ${
            s.mainSubject || "the scene"
          } with subtle atmospheric light motion, strictly preserving character identity, composition, and visual style.`,
        editorMotion: found?.editorMotion || (idx % 2 === 0 ? "zoomin" : "zoomout"),
      };
    });

    res.json({ motionPrompts: finalMotions });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to generate motion prompts." });
  }
});

// 9. Generate Complete YouTube SEO Package & 3 Channel-Styled Thumbnail Prompts
app.post("/api/ai/seo-package", async (req, res) => {
  try {
    const {
      projectName,
      concept,
      niche,
      script,
      scenes,
      actualDurationSec,
      language,
      channelProfile,
      provider: requestedProvider,
    } = req.body || {};

    const provider = resolveEffectiveProvider(requestedProvider, req.body);

    const fmtClock = (sec: number) => {
      const m = Math.floor((sec || 0) / 60);
      const s = Math.floor((sec || 0) % 60);
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    };

    const channelThumbContext = channelProfile
      ? `\nSELECTED CHANNEL PROFILE FOR YOUTUBE SEO & THUMBNAILS:
- Channel Name: ${channelProfile.name || ""}
- Channel Niche: ${channelProfile.niche || ""}
- Channel Aspect Ratio: ${channelProfile.aspectRatio || "16:9"}
- Channel Master Prompt Rules: ${channelProfile.promptRules || ""}
- Channel Visual Style Rules: ${channelProfile.visualStyleRules || ""}
- Channel Thumbnail Style & Composition Rules: ${channelProfile.thumbnailStyleRules || "High-contrast focal subject, strong curiosity gap, expressive lighting, bold 2-4 word hook text"}
- Channel Avatar / Character: ${channelProfile.avatarCharacterDesc || ""}\n`
      : "";

    const prompt = `Generate a complete, YouTube-policy-compliant SEO Metadata Package and 3 high-CTR Thumbnail Prompts for this video project.

Project Name: ${projectName || ""}
Selected Concept Title: ${concept?.title || projectName || ""}
Niche: ${channelProfile?.niche || concept?.niche || niche || "Documentary"}
Language: ${language || "English (US)"}
Actual Video Duration: ${fmtClock(actualDurationSec || 0)} (${actualDurationSec || 0} seconds)${channelThumbContext}
${
  channelProfile?.thumbnailReferenceImages?.length || channelProfile?.styleReferenceImages?.length
    ? `\nIMPORTANT: Reference images for this channel's Thumbnail Style and Visual Style are attached. Analyze their color grading, subject framing, contrast, and visual aesthetic, and incorporate those exact stylistic traits into all 3 thumbnail visualPrompts.`
    : ""
}

Approved Script Excerpt:
"""
${String(script || "").slice(0, 6000)}
"""

Approved Scenes with Real Timings:
${(scenes || [])
  .map((s: any) => `${fmtClock(s.startTime)} - Scene ${s.sceneNumber}: ${s.mainSubject || s.visualDescription} (${s.scriptExcerpt?.slice(0, 90)}...)`)
  .join("\n")}

YOUTUBE SEO & POLICY REQUIREMENTS:
1. Titles: Exactly 5 natural, high-CTR title options that spark intense curiosity while remaining 100% compliant with YouTube community & advertiser-friendly policies (no deceptive clickbait or policy-violating terms).
2. Description: Complete, SEO-optimized YouTube description with an engaging 2-line opening hook above the fold, full narrative summary with natural keywords, chapter timestamps, and safe community call-to-action.
3. Chapters: Ordered timestamps starting at 00:00 and strictly within ${fmtClock(actualDurationSec || 0)} based on the actual scenes.
4. Tags: High-ranking YouTube search tags whose comma-separated total length is strictly under 460 characters (well below YouTube's 500-char limit), plus 5-8 hashtags.
5. Thumbnails: Exactly 3 distinct, high-converting thumbnail concepts tailored to the selected channel's visual & thumbnail style rules. Each thumbnail must include:
   - conceptTitle: Name of the thumbnail angle (e.g., "The Mystery Reveal", "Extreme Scale Contrast", "Character Reaction")
   - suggestedText: Punchy 2–4 word text overlay
   - visualPrompt: A complete, standalone image generation prompt repeating the channel's visual style, avatar/character traits, lighting, color palette, and aspect ratio (${channelProfile?.aspectRatio || "16:9"})
   - compositionNotes: Why this composition drives clicks.
6. Publishing Metadata: Recommended YouTube category, language, madeForKids (boolean), and standard YouTube license.`;

    const firstThumbRef =
      channelProfile?.thumbnailReferenceImages?.[0] ||
      channelProfile?.styleReferenceImages?.[0] ||
      channelProfile?.avatarImages?.[0] ||
      null;

    if (provider === "codecraft") {
      const cc = getCodeCraftCreds(req.body);
      const rawJson = await callCodeCraftChat({
        apiKey: cc.apiKey,
        baseUrl: cc.baseUrl,
        model: cc.textModel,
        prompt: `${prompt}\n\nReturn strictly valid JSON with keys: titles (array of 5 strings), description (string), chapters (array of {timestamp, title, isEstimate}), tags (array of strings), hashtags (array of strings), thumbnails (array of 3 objects with {id, conceptTitle, suggestedText, visualPrompt, compositionNotes}), and metadata ({category, language, madeForKids, license}).`,
        imageBase64: firstThumbRef?.dataUrl || null,
        imageMime: firstThumbRef?.mimeType || "image/jpeg",
        jsonMode: true,
      });
      return res.json(parseJsonClean(rawJson));
    }

    const ai = getAI();
    const parts: any[] = [{ text: prompt }];
    for (const img of (channelProfile?.thumbnailReferenceImages || []).slice(0, 2)) {
      if (img?.dataUrl) {
        const cleanB64 = String(img.dataUrl).replace(/^data:[^;]+;base64,/, "");
        parts.push({
          inlineData: { data: cleanB64, mimeType: img.mimeType || "image/jpeg" },
        });
      }
    }
    for (const img of (channelProfile?.styleReferenceImages || []).slice(0, 1)) {
      if (img?.dataUrl) {
        const cleanB64 = String(img.dataUrl).replace(/^data:[^;]+;base64,/, "");
        parts.push({
          inlineData: { data: cleanB64, mimeType: img.mimeType || "image/jpeg" },
        });
      }
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: [{ role: "user", parts }],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            titles: { type: Type.ARRAY, items: { type: Type.STRING } },
            description: { type: Type.STRING },
            chapters: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  timestamp: { type: Type.STRING },
                  title: { type: Type.STRING },
                  isEstimate: { type: Type.BOOLEAN },
                },
                required: ["timestamp", "title", "isEstimate"],
              },
            },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
            thumbnails: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  conceptTitle: { type: Type.STRING },
                  suggestedText: { type: Type.STRING },
                  visualPrompt: { type: Type.STRING },
                  compositionNotes: { type: Type.STRING },
                },
                required: ["id", "conceptTitle", "suggestedText", "visualPrompt", "compositionNotes"],
              },
            },
            metadata: {
              type: Type.OBJECT,
              properties: {
                category: { type: Type.STRING },
                language: { type: Type.STRING },
                madeForKids: { type: Type.BOOLEAN },
                license: { type: Type.STRING },
              },
              required: ["category", "language", "madeForKids", "license"],
            },
          },
          required: ["titles", "description", "chapters", "tags", "hashtags", "thumbnails", "metadata"],
        },
      },
    });

    res.json(parseJsonClean(response.text || "{}"));
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to generate YouTube SEO package." });
  }
});

// Explicit JSON 404 handler for any unknown /api/* route so it never falls through to HTML
app.all("/api/*all", (req, res) => {
  res.status(404).json({
    error: `API endpoint not found: ${req.method} ${req.originalUrl || req.url}`,
  });
});

export default app;
