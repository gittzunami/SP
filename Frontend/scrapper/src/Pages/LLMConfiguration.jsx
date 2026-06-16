import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api";
import {
  Box, Card, CardContent, Typography, Button, TextField,
  Chip, Stack, CircularProgress, Snackbar, Alert, IconButton,
  Divider,
} from "@mui/material";
import CheckCircleIcon  from "@mui/icons-material/CheckCircle";
import EditIcon         from "@mui/icons-material/Edit";
import VisibilityIcon   from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import SaveIcon         from "@mui/icons-material/Save";
import AutoAwesomeIcon  from "@mui/icons-material/AutoAwesome";
import SmartToyIcon     from "@mui/icons-material/SmartToy";
import { useAppTheme }      from "../AppThemeContext";
import { useNotifications } from "../NotificationContext";

const API_BASE = "http://localhost:8000";

const PROVIDER_MODELS = {
  openai: [
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "gpt-4o",      label: "GPT-4o" },
    { value: "gpt-4.1",     label: "GPT-4.1" },
    { value: "gpt-5",       label: "GPT-5" },
    { value: "gpt-5.1",     label: "GPT-5.1" },
    { value: "gpt-5.2",     label: "GPT-5.2" },
  ],
  anthropic: [
    { value: "claude-haiku-4-5",  label: "Claude Haiku 4.5" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-opus-4-7",   label: "Claude Opus 4.7" },
  ],
  gemini: [
    { value: "gemini-2.5-flash",       label: "Gemini 2.5 Flash" },
    { value: "gemini-2.5-pro",         label: "Gemini 2.5 Pro" },
    { value: "gemini-3-flash-preview",  label: "Gemini 3 Flash Preview" },
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
  ],
};

const PROVIDER_META = {
  openai: {
    label:    "OpenAI / ChatGPT",
    color:    "#10a37f",
    bg:       "#10a37f15",
    border:   "#10a37f",
    docsUrl:  "https://platform.openai.com/api-keys",
    hint:     "Get your key from platform.openai.com → API Keys",
  },
  anthropic: {
    label:   "Anthropic / Claude",
    color:   "#d97757",
    bg:      "#d9775715",
    border:  "#d97757",
    docsUrl: "https://console.anthropic.com/settings/keys",
    hint:    "Get your key from console.anthropic.com → API Keys",
  },
  gemini: {
    label:   "Google / Gemini",
    color:   "#4285f4",
    bg:      "#4285f415",
    border:  "#4285f4",
    docsUrl: "https://aistudio.google.com/app/apikey",
    hint:    "Get your key from Google AI Studio → Get API key",
  },
};

// ── Provider Card ──────────────────────────────────────────────────────────────
const ProviderCard = ({ providerKey, config, isActive, onSave, onSetActive, onDeactivate, onDeleteKey }) => {
  const { C } = useAppTheme();
  const meta   = PROVIDER_META[providerKey];
  const models = PROVIDER_MODELS[providerKey];

  const [editing,       setEditing]       = useState(false);
  const [apiKey,        setApiKey]        = useState("");
  const [showKey,       setShowKey]       = useState(false);
  const [selectedModel, setSelectedModel] = useState(config?.model || models[0].value);
  const [saving,        setSaving]        = useState(false);

  useEffect(() => {
    if (config?.model) setSelectedModel(config.model);
  }, [config?.model]);

  const hasKey     = config?.has_key;
  const configured = hasKey && config?.model;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(providerKey, apiKey || null, selectedModel, isActive);
      setEditing(false);
      setApiKey("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card sx={{
      bgcolor:    C.card,
      border:     `2px solid ${isActive ? meta.border : C.border}`,
      borderRadius: 3,
      transition: "border-color 0.3s",
      boxShadow:  C.shadow,
    }}>
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>

        {/* Header */}
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box sx={{ p: 1, bgcolor: meta.bg, borderRadius: 2 }}>
              <SmartToyIcon sx={{ color: meta.color, fontSize: 22 }} />
            </Box>
            <Box>
              <Typography sx={{ color: C.text, fontWeight: 700, fontSize: "1rem" }}>
                {meta.label}
              </Typography>
              {configured && (
                <Typography variant="caption" sx={{ color: C.textMuted }}>
                  Model: {models.find(m => m.value === config.model)?.label || config.model}
                </Typography>
              )}
            </Box>
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {configured && (
              <Chip
                label={isActive ? "Active" : "Configured"}
                size="small"
                icon={isActive ? <CheckCircleIcon sx={{ fontSize: "14px !important" }} /> : undefined}
                sx={{
                  bgcolor: isActive ? meta.bg : C.hover,
                  color:   isActive ? meta.color : C.textMuted,
                  border:  isActive ? `1px solid ${meta.border}` : `1px solid ${C.border}`,
                  fontWeight: 600,
                }}
              />
            )}
            {!configured && (
              <Chip label="Not Configured" size="small"
                sx={{ bgcolor: C.hover, color: C.textMuted, border: `1px solid ${C.border}` }} />
            )}
          </Box>
        </Box>

        {/* API Key section */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 700,
            letterSpacing: 1, display: "block", mb: 1 }}>
            API KEY
          </Typography>

          {!editing ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1,
              p: 1.5, bgcolor: C.cardInner, borderRadius: 2, border: `1px solid ${C.border}` }}>
              <Typography variant="body2" sx={{ color: hasKey ? "#10b981" : C.textSub, flex: 1 }}>
                {hasKey ? "●●●●●●●●●●●●●●●● (saved)" : "No API key configured"}
              </Typography>
              <IconButton size="small" onClick={() => setEditing(true)}
                sx={{ color: C.textMuted, "&:hover": { color: "#3b82f6" } }}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Box>
          ) : (
            <Box sx={{ display: "flex", gap: 1 }}>
              <TextField
                fullWidth size="small"
                placeholder={hasKey ? "Enter new key to replace existing…" : `${meta.label} API key`}
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                helperText={meta.hint}
                sx={{
                  "& .MuiOutlinedInput-root": {
                    color: C.text, bgcolor: C.inputBg,
                    "& fieldset": { borderColor: C.border },
                    "&:hover fieldset": { borderColor: meta.color },
                    "&.Mui-focused fieldset": { borderColor: meta.color },
                  },
                  "& .MuiInputBase-input": { color: C.text, fontFamily: "monospace", fontSize: "0.8rem" },
                  "& .MuiFormHelperText-root": { color: C.textMuted },
                }}
                InputProps={{
                  endAdornment: (
                    <IconButton size="small" onClick={() => setShowKey(!showKey)}
                      sx={{ color: C.textMuted }}>
                      {showKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </IconButton>
                  ),
                }}
              />
              <Button size="small" onClick={() => { setEditing(false); setApiKey(""); }}
                sx={{ color: C.textMuted, minWidth: 0 }}>Cancel</Button>
            </Box>
          )}
        </Box>

        {/* Model selection */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 700,
            letterSpacing: 1, display: "block", mb: 1.5 }}>
            SELECT MODEL
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {models.map((m) => (
              <Chip
                key={m.value}
                label={m.label}
                onClick={() => setSelectedModel(m.value)}
                size="small"
                sx={{
                  cursor:  "pointer",
                  bgcolor: selectedModel === m.value ? meta.bg  : C.cardInner,
                  color:   selectedModel === m.value ? meta.color : C.textMuted,
                  border:  selectedModel === m.value
                    ? `1px solid ${meta.border}`
                    : `1px solid ${C.border}`,
                  fontWeight: selectedModel === m.value ? 700 : 400,
                  transition: "all 0.2s",
                  "&:hover": {
                    bgcolor: meta.bg,
                    color:   meta.color,
                    border:  `1px solid ${meta.border}`,
                  },
                }}
              />
            ))}
          </Box>
        </Box>

        <Divider sx={{ bgcolor: C.border, mb: 2 }} />

        {/* Action buttons */}
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
          <Button
            variant="contained"
            size="small"
            startIcon={saving
              ? <CircularProgress size={14} sx={{ color: "white" }} />
              : <SaveIcon />}
            disabled={saving || (!hasKey && !apiKey.trim())}
            onClick={handleSave}
            sx={{
              bgcolor: meta.color, textTransform: "none", fontSize: "0.8rem",
              "&:hover": { filter: "brightness(1.1)" },
              "&.Mui-disabled": { bgcolor: "#374151", color: "#6b7280" },
            }}
          >
            {saving ? "Saving…" : "Save Configuration"}
          </Button>

          {configured && !isActive && (
            <Button
              variant="outlined"
              size="small"
              onClick={() => onSetActive(providerKey)}
              sx={{
                borderColor: meta.color, color: meta.color, textTransform: "none",
                fontSize: "0.8rem",
                "&:hover": { bgcolor: meta.bg },
              }}
            >
              Set as Active
            </Button>
          )}

          {configured && isActive && (
            <Button
              variant="outlined"
              size="small"
              onClick={() => onDeactivate(providerKey)}
              sx={{
                borderColor: C.border, color: C.textSub, textTransform: "none",
                fontSize: "0.8rem",
                "&:hover": { borderColor: C.textSub, color: C.text },
              }}
            >
              Deactivate
            </Button>
          )}

          {hasKey && (
            <Button
              variant="outlined"
              size="small"
              onClick={() => onDeleteKey(providerKey)}
              sx={{
                borderColor: "#ef4444", color: "#ef4444", textTransform: "none",
                fontSize: "0.8rem", ml: "auto",
                "&:hover": { bgcolor: "#ef444415" },
              }}
            >
              Remove Key
            </Button>
          )}
        </Box>
      </CardContent>
    </Card>
  );
};


// ══════════════════════════════════════════════════════════════════════════════
const LLMConfiguration = () => {
  const { C } = useAppTheme();
  const { addNotification } = useNotifications();
  const [configs,  setConfigs]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [toast,    setToast]    = useState({ open: false, msg: "", severity: "success" });
  const showToast = (msg, severity = "success") => setToast({ open: true, msg, severity });

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/llm/configs`);
      if (res.ok) setConfigs(await res.json());
    } catch (e) {
      showToast("Failed to load LLM configs", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const handleSave = async (provider, apiKey, model, keepActive) => {
    try {
      const activeProvider = configs.find(c => c.is_active)?.provider;
      const setActive = keepActive || (activeProvider === provider);

      const res = await apiFetch(`${API_BASE}/api/llm/config`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ provider, api_key: apiKey, model, set_active: setActive }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      showToast(`${PROVIDER_META[provider].label} configuration saved!`);
      addNotification({
        title:   `${PROVIDER_META[provider].label} configured`,
        message: `Model: ${model}${setActive ? " — set as active provider" : ""}`,
        type:    setActive ? "success" : "info",
      });
      await fetchConfigs();
    } catch (e) {
      showToast(`Save failed: ${e.message}`, "error");
    }
  };

  const handleSetActive = async (provider) => {
    const cfg = configs.find(c => c.provider === provider);
    if (!cfg) return;
    await handleSave(provider, null, cfg.model, true);
    showToast(`${PROVIDER_META[provider].label} set as active provider!`);
  };

  const handleDeactivate = async (provider) => {
    try {
      const res = await apiFetch(`${API_BASE}/api/llm/config`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ provider, api_key: null, model: configs.find(c => c.provider === provider)?.model || "", set_active: false }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast(`${PROVIDER_META[provider].label} deactivated.`);
      await fetchConfigs();
    } catch (e) {
      showToast(`Failed to deactivate: ${e.message}`, "error");
    }
  };

  const handleDeleteKey = async (provider) => {
    if (!window.confirm(`Remove the API key for ${PROVIDER_META[provider].label}? This cannot be undone.`)) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/llm/config/${provider}/key`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast(`API key for ${PROVIDER_META[provider].label} removed.`);
      await fetchConfigs();
    } catch (e) {
      showToast(`Failed to remove key: ${e.message}`, "error");
    }
  };

  const activeProvider   = configs.find(c => c.is_active)?.provider;
  const configuredCount  = configs.filter(c => c.has_key && c.model).length;

  return (
    <Box sx={{ width: "100%", pb: 4 }}>
      {/* Header */}
      <Box sx={{ mb: { xs: 3, md: 4 } }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}>
          <AutoAwesomeIcon sx={{ color: "#a855f7", fontSize: 28 }} />
          <Typography sx={{ fontWeight: "bold", color: C.text,
            fontSize: { xs: "1.2rem", sm: "1.4rem", md: "1.75rem" } }}>
            LLM Configuration
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ color: C.textSub }}>
          Configure your AI providers to power the Feed to LLM feature in Results.
        </Typography>
      </Box>

      {/* Status banner */}
      {!loading && (
        <Card sx={{
          bgcolor:  activeProvider ? "#0d1f12" : "#1c1009",
          border:   `1px solid ${activeProvider ? "#10b981" : "#d97706"}`,
          mb: 3, borderRadius: 2,
        }}>
          <CardContent sx={{ py: 1.5, px: 2, "&:last-child": { pb: 1.5 } }}>
            <Typography variant="body2" sx={{ color: activeProvider ? "#10b981" : "#fde68a" }}>
              {activeProvider
                ? `✓ Active provider: ${PROVIDER_META[activeProvider]?.label} — Ready to use Feed to LLM`
                : configuredCount > 0
                ? `${configuredCount} provider(s) configured but none set as active. Click "Set as Active" to enable Feed to LLM.`
                : "No providers configured yet. Add an API key below to get started."}
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* How it works */}
      <Card sx={{ bgcolor: C.cardInner, border: `1px solid ${C.border}`, mb: 3, borderRadius: 2 }}>
        <CardContent sx={{ p: 2 }}>
          <Typography variant="caption" sx={{ color: "#3b82f6", fontWeight: 700,
            letterSpacing: 1, display: "block", mb: 1 }}>
            HOW IT WORKS
          </Typography>
          <Stack spacing={0.5}>
            {[
              "1. Configure one or more AI providers below with your API key.",
              "2. Select models and set one provider as Active.",
              "3. In Results, select data rows → click Feed to LLM.",
              "4. Enter your prompt (AI will auto-enhance it) → confirm → get analysis.",
              "Note: Prompt enhancement always uses GPT-4o (requires OpenAI key).",
            ].map((line, i) => (
              <Typography key={i} variant="caption" sx={{ color: i === 4 ? "#f59e0b" : C.textMuted }}>
                {line}
              </Typography>
            ))}
          </Stack>
        </CardContent>
      </Card>

      {/* Provider Cards */}
      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress sx={{ color: "#3b82f6" }} />
        </Box>
      ) : (
        <Stack spacing={3}>
          {["openai", "anthropic", "gemini"].map((providerKey) => {
            const cfg = configs.find(c => c.provider === providerKey);
            return (
              <ProviderCard
                key={providerKey}
                providerKey={providerKey}
                config={cfg}
                isActive={activeProvider === providerKey}
                onSave={handleSave}
                onSetActive={handleSetActive}
                onDeactivate={handleDeactivate}
                onDeleteKey={handleDeleteKey}
              />
            );
          })}
        </Stack>
      )}

      {/* Toast */}
      <Snackbar open={toast.open} autoHideDuration={4000}
        onClose={() => setToast(t => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        <Alert severity={toast.severity}
          onClose={() => setToast(t => ({ ...t, open: false }))}
          sx={{ bgcolor: C.hover, color: C.text, "& .MuiAlert-icon": { color: "inherit" } }}>
          {toast.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default LLMConfiguration;
