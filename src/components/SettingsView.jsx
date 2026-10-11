"use client";
import { useState, useEffect } from "react";
import {
  SUPPORTED_VOICES,
  CODECRAFT_TEXT_MODELS,
  CODECRAFT_IMAGE_MODELS,
  CODECRAFT_TTS_MODELS,
  createDefaultGlobalSettings,
} from "../lib/narrativeModel";
import { fetchProviderStatus, updateServerCodeCraftConfig } from "../lib/aiService";
import { showConfirm, showPrompt } from "./Dialog";
import {
  Plus,
  Trash2,
  Copy,
  Check,
  RotateCcw,
  Sun,
  Moon,
  Globe,
  Cpu,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Eye,
  EyeOff,
} from "lucide-react";

export default function SettingsView({
  settings,
  onSaveSettings,
  theme,
  setTheme,
  uiLang,
  setUiLang,
}) {
  const isAr = uiLang === "ar";
  const [local, setLocal] = useState(() => {
    const def = createDefaultGlobalSettings();
    return {
      ...def,
      ...(settings || {}),
      aiSettings: {
        ...def.aiSettings,
        ...(settings?.aiSettings || {}),
        codecraft: {
          ...def.aiSettings.codecraft,
          ...(settings?.aiSettings?.codecraft || {}),
        },
      },
    };
  });
  const [activeScriptId, setActiveScriptId] = useState(
    () => settings?.scriptPresets?.[0]?.id || "documentary"
  );
  const [activeVisualId, setActiveVisualId] = useState(
    () => settings?.visualPresets?.[0]?.id || "cinematic_realistic"
  );
  const [savedNotice, setSavedNotice] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const [providerStatus, setProviderStatus] = useState({
    geminiConfigured: true,
    codecraftConfigured: false,
    testing: false,
    testMessage: null,
    testOk: false,
    discoveredModels: [],
  });

  useEffect(() => {
    fetchProviderStatus().then((st) => {
      if (st) {
        setProviderStatus((prev) => ({
          ...prev,
          geminiConfigured: !!st.geminiConfigured,
          codecraftConfigured: !!st.codecraftConfigured,
        }));
      }
    });
  }, []);

  const activeScript =
    local.scriptPresets.find((p) => p.id === activeScriptId) || local.scriptPresets[0];
  const activeVisual =
    local.visualPresets.find((p) => p.id === activeVisualId) || local.visualPresets[0];

  const cc = local.aiSettings?.codecraft || {
    apiKey: "",
    baseUrl: "https://codecraftapi.com/v1",
    textModel: "gpt-4o",
    imageModel: "dall-e-3",
    ttsModel: "tts-1",
    ttsVoice: "onyx",
  };

  const updateCodeCraft = (patch) => {
    setLocal((prev) => ({
      ...prev,
      aiSettings: {
        ...prev.aiSettings,
        codecraft: {
          ...(prev.aiSettings?.codecraft || {}),
          ...patch,
        },
      },
    }));
  };

  const handleSave = async () => {
    try {
      const res = await updateServerCodeCraftConfig({
        apiKey: cc.apiKey || "",
        baseUrl: cc.baseUrl,
        textModel: cc.textModel,
        imageModel: cc.imageModel,
        ttsModel: cc.ttsModel,
        ttsVoice: cc.ttsVoice,
      });
      if (res) {
        setProviderStatus((p) => ({
          ...p,
          codecraftConfigured: !!(res.hasKey || (cc.apiKey && cc.apiKey.trim())),
        }));
      }
    } catch (_) {}
    await onSaveSettings(local);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleTestCodeCraft = async () => {
    setProviderStatus((p) => ({ ...p, testing: true, testMessage: null }));
    try {
      const res = await updateServerCodeCraftConfig({
        apiKey: cc.apiKey || "",
        baseUrl: cc.baseUrl,
        textModel: cc.textModel,
        imageModel: cc.imageModel,
        ttsModel: cc.ttsModel,
        ttsVoice: cc.ttsVoice,
        testConnection: true,
      });
      await onSaveSettings(local);
      setProviderStatus((p) => ({
        ...p,
        testing: false,
        codecraftConfigured: !!res.hasKey,
        testOk: true,
        discoveredModels: res.models || [],
        testMessage: isAr
          ? `تم الاتصال بنجاح بـ CodeCraft API (${res.baseUrl})`
          : `Successfully connected to CodeCraft API (${res.baseUrl})`,
      }));
    } catch (err) {
      setProviderStatus((p) => ({
        ...p,
        testing: false,
        testOk: false,
        testMessage: err.message || String(err),
      }));
    }
  };

  const updateScriptPreset = (id, patch) => {
    setLocal((prev) => ({
      ...prev,
      scriptPresets: prev.scriptPresets.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  };

  const addScriptPreset = async () => {
    const name = await showPrompt(
      isAr ? "اسم قالب السيناريو الجديد:" : "New Script Preset Name:",
      {
        title: isAr ? "إضافة قالب سيناريو" : "Create Script Preset",
        defaultValue: "Custom Narrative Style",
      }
    );
    if (!name || !name.trim()) return;
    const id = `sp_${Date.now()}`;
    const newPreset = {
      id,
      name: name.trim(),
      nameAr: name.trim(),
      tone: "Engaging, structured, authentic",
      pov: "Second-person ('you')",
      pacing: "Balanced progression",
      hookStyle: "Curiosity gap question",
      endingStyle: "Memorable takeaway",
      language: "English (US)",
      instructions:
        "Maintain strong narrative momentum, clear transitions, and natural spoken cadence.",
    };
    setLocal((prev) => ({
      ...prev,
      scriptPresets: [...prev.scriptPresets, newPreset],
      defaultScriptPresetId: id,
    }));
    setActiveScriptId(id);
  };

  const duplicateScriptPreset = (preset) => {
    const id = `sp_${Date.now()}`;
    const copy = {
      ...preset,
      id,
      name: `${preset.name} (Copy)`,
      nameAr: `${preset.nameAr || preset.name} (نسخة)`,
    };
    setLocal((prev) => ({
      ...prev,
      scriptPresets: [...prev.scriptPresets, copy],
    }));
    setActiveScriptId(id);
  };

  const deleteScriptPreset = async (id) => {
    if (local.scriptPresets.length <= 1) return;
    const ok = await showConfirm(
      isAr ? "هل تريد حذف قالب السيناريو هذا؟" : "Delete this script preset?",
      { danger: true, okText: isAr ? "حذف" : "Delete" }
    );
    if (!ok) return;
    const remaining = local.scriptPresets.filter((p) => p.id !== id);
    setLocal((prev) => ({
      ...prev,
      scriptPresets: remaining,
      defaultScriptPresetId:
        prev.defaultScriptPresetId === id ? remaining[0].id : prev.defaultScriptPresetId,
    }));
    setActiveScriptId(remaining[0].id);
  };

  const updateVisualPreset = (id, patch) => {
    setLocal((prev) => ({
      ...prev,
      visualPresets: prev.visualPresets.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  };

  const addVisualPreset = async () => {
    const name = await showPrompt(
      isAr ? "اسم النمط البصري الجديد:" : "New Visual Style Preset Name:",
      {
        title: isAr ? "إضافة نمط بصري" : "Create Visual Style Preset",
        defaultValue: "Custom Visual Style",
      }
    );
    if (!name || !name.trim()) return;
    const id = `vp_${Date.now()}`;
    const newPreset = {
      id,
      name: name.trim(),
      nameAr: name.trim(),
      colorPalette: "Rich cinematic contrast with warm highlights and deep shadows",
      lighting: "Volumetric natural lighting",
      characterRules: "Consistent character proportions and expressive faces",
      composition: "Widescreen rule-of-thirds framing",
      detailLevel: "High detail, clean edges",
      aspectRatio: "16:9",
      negativePrompt: "no text in this frame, no watermarks, no logos",
      thumbGradient: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)",
    };
    setLocal((prev) => ({
      ...prev,
      visualPresets: [...prev.visualPresets, newPreset],
      defaultVisualPresetId: id,
    }));
    setActiveVisualId(id);
  };

  const deleteVisualPreset = async (id) => {
    if (local.visualPresets.length <= 1) return;
    const ok = await showConfirm(
      isAr ? "هل تريد حذف هذا النمط البصري؟" : "Delete this visual style preset?",
      { danger: true, okText: isAr ? "حذف" : "Delete" }
    );
    if (!ok) return;
    const remaining = local.visualPresets.filter((p) => p.id !== id);
    setLocal((prev) => ({
      ...prev,
      visualPresets: remaining,
      defaultVisualPresetId:
        prev.defaultVisualPresetId === id ? remaining[0].id : prev.defaultVisualPresetId,
    }));
    setActiveVisualId(remaining[0].id);
  };

  const resetDefaults = async () => {
    const ok = await showConfirm(
      isAr
        ? "استعادة كافة إعدادات الإنتاج الافتراضية؟"
        : "Reset all production presets to factory defaults?",
      { okText: isAr ? "استعادة" : "Reset" }
    );
    if (!ok) return;
    const def = createDefaultGlobalSettings();
    setLocal(def);
    setActiveScriptId(def.scriptPresets[0].id);
    setActiveVisualId(def.visualPresets[0].id);
    await onSaveSettings(def);
  };

  return (
    <div className="uyns-settings" dir={isAr ? "rtl" : "ltr"}>
      <div className="uyns-settings__header">
        <div>
          <h1 className="uyns-settings__title">
            {isAr ? "إعدادات الإنتاج ومزودات الذكاء الاصطناعي" : "Settings — Production Presets & CodeCraft API"}
          </h1>
          <p className="uyns-settings__subtitle">
            {isAr
              ? "اضبط تكامل CodeCraft API (لتوليد النصوص والصور والصوت) وقوالب السيناريو والأنماط البصرية."
              : "Configure CodeCraft API (for Text, Image & Audio generation), reusable script styles, and visual presets."}
          </p>
        </div>
        <div className="uyns-settings__actions">
          <button type="button" className="uyns-btn uyns-btn--ghost" onClick={resetDefaults}>
            <RotateCcw className="w-4 h-4" />
            <span>{isAr ? "استعادة الافتراضي" : "Reset Defaults"}</span>
          </button>
          <button type="button" className="uyns-btn uyns-btn--primary" onClick={handleSave}>
            <Check className="w-4 h-4" />
            <span>
              {savedNotice
                ? isAr
                  ? "تم الحفظ بنجاح"
                  : "Settings Saved"
                : isAr
                ? "حفظ الإعدادات"
                : "Save Settings"}
            </span>
          </button>
        </div>
      </div>

      <div className="uyns-settings__grid">
        {/* 0. CodeCraft API Integration Section (Text, Image & Audio Generation) */}
        <section className="uyns-card border-[var(--line-glow)]">
          <div className="uyns-card__head">
            <div className="flex items-center gap-2.5">
              <Cpu className="w-5 h-5 text-[var(--accent)]" />
              <div>
                <h2 className="uyns-card__title">
                  {isAr
                    ? "تكامل CodeCraft API — توليد النصوص والصور والصوت"
                    : "CodeCraft API Integration — Text, Image & Audio Generation"}
                </h2>
                <p className="text-xs text-[var(--muted)]">
                  {isAr
                    ? "اختر المحرك المستخدم لكل مهمة (CodeCraft API أو Gemini) وحدد موديلات النص والصور والصوت."
                    : "Select your preferred provider (CodeCraft API or Gemini) for text, image, and voiceover tasks."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`text-xs font-semibold flex items-center gap-1 ${
                  providerStatus.geminiConfigured
                    ? "text-[var(--accent)]"
                    : "text-amber-400"
                }`}
              >
                {providerStatus.geminiConfigured ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{isAr ? "Gemini API جاهز" : "Gemini API Ready"}</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>
                      {isAr
                        ? "أضف GEMINI_API_KEY في إعدادات Vercel"
                        : "Set GEMINI_API_KEY in Vercel Env"}
                    </span>
                  </>
                )}
              </span>

              <span
                className={`text-xs font-semibold flex items-center gap-1 ${
                  providerStatus.codecraftConfigured || (cc.apiKey && cc.apiKey.trim())
                    ? "text-[var(--accent)]"
                    : "text-amber-400"
                }`}
              >
                {providerStatus.codecraftConfigured || (cc.apiKey && cc.apiKey.trim()) ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{isAr ? "مفتاح CodeCraft جاهز" : "CodeCraft API Key Ready"}</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{isAr ? "أدخل مفتاح CodeCraft بالأسفل" : "Enter CodeCraft API Key below"}</span>
                  </>
                )}
              </span>

              <button
                type="button"
                disabled={providerStatus.testing}
                onClick={handleTestCodeCraft}
                className="uyns-btn uyns-btn--ghost uyns-btn--sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${providerStatus.testing ? "animate-spin" : ""}`} />
                <span>{isAr ? "فحص اتصال CodeCraft" : "Test CodeCraft API"}</span>
              </button>
            </div>
          </div>

          <div className="mb-4 p-3 rounded-xl bg-[var(--panel-2)] border border-[var(--line-soft)] text-xs text-[var(--muted)]">
            <strong className="text-[var(--text)]">
              {isAr
                ? "إعداد متغيرات البيئة على Vercel (Server-Side Secrets):"
                : "Vercel Environment Variables Setup:"}
            </strong>{" "}
            {isAr
              ? "في لوحة تحكم Vercel (Project Settings → Environment Variables)، أضف GEMINI_API_KEY لتفعيل Gemini، واختيارياً YOUTUBE_API_KEY و CODECRAFT_API_KEY ثم أعد النشر (Redeploy)."
              : "In your Vercel Dashboard (Project Settings → Environment Variables), add GEMINI_API_KEY for Gemini AI, and optionally YOUTUBE_API_KEY and CODECRAFT_API_KEY, then Redeploy."}
          </div>

          {providerStatus.testMessage && (
            <div
              className={`uyns-banner mb-3 ${
                providerStatus.testOk ? "uyns-banner--busy" : "uyns-banner--error"
              }`}
            >
              <span>{providerStatus.testMessage}</span>
            </div>
          )}

          {/* Task Provider Routing */}
          <div className="uyns-form-grid mb-4 pb-4 border-b border-[var(--line-soft)]">
            <div className="uyns-field">
              <label>
                {isAr
                  ? "1. محرك توليد النصوص والسيناريو والأوامر (Text Provider)"
                  : "1. Text, Script, Scenes & SEO Provider"}
              </label>
              <select
                value={local.aiSettings?.textProvider || "gemini"}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    aiSettings: { ...p.aiSettings, textProvider: e.target.value },
                  }))
                }
              >
                <option value="codecraft">CodeCraft API (GPT-4o / Claude / DeepSeek)</option>
                <option value="gemini">Google Gemini 3.8 Flash</option>
              </select>
            </div>

            <div className="uyns-field">
              <label>
                {isAr
                  ? "2. محرك توليد صور المشاهد الفعلي (Image Generation Provider)"
                  : "2. Scene Image Generation Provider"}
              </label>
              <select
                value={local.aiSettings?.imageProvider || "codecraft"}
                onChange={(e) =>
                  setLocal((p) => ({
                    ...p,
                    imageSettings: { ...p.imageSettings, provider: e.target.value },
                    aiSettings: { ...p.aiSettings, imageProvider: e.target.value },
                  }))
                }
              >
                <option value="codecraft">CodeCraft API (/v1/images/generations)</option>
                <option value="gemini">Google Gemini Flash Image</option>
              </select>
            </div>

            <div className="uyns-field">
              <label>
                {isAr
                  ? "3. محرك توليد التعليق الصوتي (Audio / TTS Provider)"
                  : "3. Voice-Over Audio (TTS) Provider"}
              </label>
              <select
                value={local.aiSettings?.audioProvider || "gemini"}
                onChange={(e) => {
                  const prov = e.target.value;
                  const defaultVoice = prov === "codecraft" ? cc.ttsVoice || "onyx" : "Charon";
                  setLocal((p) => ({
                    ...p,
                    voiceSettings: {
                      ...p.voiceSettings,
                      provider: prov,
                      voiceId: defaultVoice,
                    },
                    aiSettings: { ...p.aiSettings, audioProvider: prov },
                  }));
                }}
              >
                <option value="codecraft">CodeCraft API (/v1/audio/speech)</option>
                <option value="gemini">Google Gemini 3.8 TTS</option>
              </select>
            </div>
          </div>

          {/* CodeCraft API Key, Base URL & Custom Model Names */}
          <div className="uyns-form-grid">
            <div className="uyns-field uyns-field--full">
              <label className="flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span>
                  {isAr
                    ? "1. مفتاح الـ API (اكتب أو الصق مفتاح API يدوياً)"
                    : "1. API Key (Type or paste your API key manually)"}
                </span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={cc.apiKey || ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setLocal((prev) => ({
                      ...prev,
                      aiSettings: {
                        ...prev.aiSettings,
                        // Automatically route text, image & audio to CodeCraft when user enters their key
                        textProvider: val.trim() ? "codecraft" : prev.aiSettings?.textProvider || "gemini",
                        imageProvider: val.trim() ? "codecraft" : prev.aiSettings?.imageProvider || "codecraft",
                        audioProvider: val.trim() ? "codecraft" : prev.aiSettings?.audioProvider || "gemini",
                        codecraft: {
                          ...(prev.aiSettings?.codecraft || {}),
                          apiKey: val,
                        },
                      },
                    }));
                  }}
                  placeholder={
                    isAr
                      ? "اكتب مفتاح الـ API هنا (مثال: sk-...)"
                      : "Enter your API key here (e.g. sk-...)"
                  }
                  className="flex-1 font-mono text-xs"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  className="uyns-btn uyns-btn--ghost uyns-btn--sm"
                  title={showApiKey ? (isAr ? "إخفاء المفتاح" : "Hide Key") : isAr ? "إظهار المفتاح" : "Show Key"}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  <span>{showApiKey ? (isAr ? "إخفاء" : "Hide") : isAr ? "إظهار" : "Show"}</span>
                </button>
              </div>
              <span className="text-[11px] text-[var(--muted)] mt-1 block">
                {isAr
                  ? "بمجرد إدخال المفتاح، سيتم تفعيل CodeCraft تلقائياً لتوليد النصوص والصور والصوت."
                  : "Entering an API key automatically enables CodeCraft for Text, Image, and Audio generation."}
              </span>
            </div>

            <div className="uyns-field uyns-field--full">
              <label>
                {isAr
                  ? "2. رابط الـ API الأساسي (Base URL — اكتب أي رابط متوافق)"
                  : "2. API Base URL (Type any custom OpenAI/CodeCraft compatible URL)"}
              </label>
              <input
                type="text"
                value={cc.baseUrl ?? "https://codecraftapi.com/v1"}
                onChange={(e) => updateCodeCraft({ baseUrl: e.target.value })}
                placeholder="https://codecraftapi.com/v1"
                className="font-mono text-xs"
              />
              <span className="text-[11px] text-[var(--muted)] mt-1 block">
                {isAr
                  ? "مثال: https://codecraftapi.com/v1 (تُضاف إليه تلقائياً مسارات /chat/completions و /images/generations و /audio/speech)"
                  : "Example: https://codecraftapi.com/v1 (automatically calls /chat/completions, /images/generations, and /audio/speech)"}
              </span>
            </div>

            <div className="uyns-field">
              <label>
                {isAr
                  ? "3. اسم موديل النصوص (Text Model Name — اكتب اسم الموديل بحرية)"
                  : "3. Text Model Name (Type any custom model ID)"}
              </label>
              <input
                list="cc-text-models"
                type="text"
                value={cc.textModel ?? ""}
                onChange={(e) => updateCodeCraft({ textModel: e.target.value })}
                placeholder={isAr ? "اكتب اسم الموديل مثل: gpt-4o أو claude-3-5-sonnet" : "Type model name, e.g. gpt-4o"}
                className="font-mono text-xs"
              />
              <datalist id="cc-text-models">
                {CODECRAFT_TEXT_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                {providerStatus.discoveredModels.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            </div>

            <div className="uyns-field">
              <label>
                {isAr
                  ? "4. اسم موديل الصور (Image Model Name — اكتب اسم الموديل بحرية)"
                  : "4. Image Model Name (Type any custom image model ID)"}
              </label>
              <input
                list="cc-image-models"
                type="text"
                value={cc.imageModel ?? ""}
                onChange={(e) => updateCodeCraft({ imageModel: e.target.value })}
                placeholder={isAr ? "اكتب اسم موديل الصور مثل: dall-e-3 أو flux-1.1-pro" : "Type image model, e.g. dall-e-3 or flux"}
                className="font-mono text-xs"
              />
              <datalist id="cc-image-models">
                {CODECRAFT_IMAGE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                {providerStatus.discoveredModels.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            </div>

            <div className="uyns-field">
              <label>
                {isAr
                  ? "5. اسم موديل الصوت (Audio TTS Model Name — اكتب اسم الموديل بحرية)"
                  : "5. Audio TTS Model Name (Type any custom TTS model ID)"}
              </label>
              <input
                list="cc-tts-models"
                type="text"
                value={cc.ttsModel ?? ""}
                onChange={(e) => updateCodeCraft({ ttsModel: e.target.value })}
                placeholder={isAr ? "اكتب اسم موديل الصوت مثل: tts-1 أو tts-1-hd" : "Type TTS model, e.g. tts-1 or tts-1-hd"}
                className="font-mono text-xs"
              />
              <datalist id="cc-tts-models">
                {CODECRAFT_TTS_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                {providerStatus.discoveredModels.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            </div>

            <div className="uyns-field">
              <label>
                {isAr
                  ? "6. اسم الصوت (Voice Name / ID — اكتب اسم الصوت أو اختر من القائمة)"
                  : "6. Voice Name / ID (Type custom voice ID or pick suggestion)"}
              </label>
              <input
                list="cc-voice-ids"
                type="text"
                value={cc.ttsVoice ?? ""}
                onChange={(e) => updateCodeCraft({ ttsVoice: e.target.value })}
                placeholder={isAr ? "اكتب اسم الصوت مثل: onyx أو alloy أو nova" : "Type voice ID, e.g. onyx, alloy, nova"}
                className="font-mono text-xs"
              />
              <datalist id="cc-voice-ids">
                {SUPPORTED_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </datalist>
            </div>
          </div>
        </section>

        {/* Language Toggle & Theme */}
        <section className="uyns-card">
          <div className="uyns-card__head">
            <h2 className="uyns-card__title">
              {isAr ? "لغة الواجهة والمظهر" : "Language Toggle & Theme"}
            </h2>
          </div>

          <div className="uyns-form-grid">
            <div className="uyns-field">
              <label>{isAr ? "لغة واجهة الاستوديو" : "Interface Language (EN / عربي)"}</label>
              <div className="uyns-segmented">
                <button
                  type="button"
                  onClick={() => setUiLang("en")}
                  className={`uyns-segmented__btn ${uiLang === "en" ? "is-active" : ""}`}
                >
                  <Globe className="w-4 h-4" />
                  <span>EN · English</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUiLang("ar")}
                  className={`uyns-segmented__btn ${uiLang === "ar" ? "is-active" : ""}`}
                >
                  <Globe className="w-4 h-4" />
                  <span>عربي · Arabic (RTL)</span>
                </button>
              </div>
            </div>

            <div className="uyns-field">
              <label>{isAr ? "المظهر اللوني" : "Workspace Theme"}</label>
              <div className="uyns-segmented">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={`uyns-segmented__btn ${theme === "light" ? "is-active" : ""}`}
                >
                  <Sun className="w-4 h-4" />
                  <span>{isAr ? "نهاري (Light)" : "Light"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={`uyns-segmented__btn ${theme === "dark" ? "is-active" : ""}`}
                >
                  <Moon className="w-4 h-4" />
                  <span>{isAr ? "ليلي (Dark)" : "Dark"}</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
