/**
 * LLMFeedModal.jsx
 * ─────────────────
 * Shown when user clicks "Feed to LLM" in Results page.
 *
 * Flow:
 *  1. Check if LLM is configured → if not, redirect to config page
 *  2. Show prompt input
 *  3. User submits → backend enhances prompt via GPT-4o
 *  4. Show enhanced prompt to user for confirmation
 *  5. User confirms → backend sends to active LLM → show response
 */

import React, { useState, useEffect } from "react";
import { apiFetch } from "../api";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Typography, TextField, Button, CircularProgress,
  Chip, Divider, IconButton, Alert, Stack,
} from "@mui/material";
import AutoAwesomeIcon  from "@mui/icons-material/AutoAwesome";
import CloseIcon        from "@mui/icons-material/Close";
import SendIcon         from "@mui/icons-material/Send";
import EditIcon         from "@mui/icons-material/Edit";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import SettingsIcon     from "@mui/icons-material/Settings";
import { useAppTheme }      from "../AppThemeContext";
import { useNavigate }      from "react-router-dom";
import { useNotifications } from "../NotificationContext";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const LLMFeedModal = ({ open, onClose, selectedRows = [], onNavigateToConfig }) => {
  const { C } = useAppTheme();
  const navigate = useNavigate();
  const { addNotification } = useNotifications();

  const [stage,           setStage]           = useState("prompt");
  const [rawPrompt,       setRawPrompt]       = useState("");
  const [enhanced,        setEnhanced]        = useState(null);
  const [error,           setError]           = useState("");
  const [llmConfig,       setLlmConfig]       = useState(null);
  const [configLoading,   setConfigLoading]   = useState(true);
  const [editingEnhanced, setEditingEnhanced] = useState(false);
  const [editedPrompt,    setEditedPrompt]    = useState("");
  // Snapshot rows when modal opens so re-renders of Results page don't wipe the selection
  const [frozenRows,      setFrozenRows]      = useState([]);

  useEffect(() => {
    if (open) {
      setFrozenRows(selectedRows);
      setStage("prompt");
      setRawPrompt("");
      setEnhanced(null);
      setError("");
      setEditingEnhanced(false);
      setEditedPrompt("");
      checkConfig();
    }
  }, [open]);

  const checkConfig = async () => {
    setConfigLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/llm/active-config`);
      if (res.ok) {
        const data = await res.json();
        setLlmConfig(data.configured ? data : null);
      } else {
        setLlmConfig(null);
      }
    } catch {
      setLlmConfig(null);
    } finally {
      setConfigLoading(false);
    }
  };

  const handleEnhance = async () => {
    if (!rawPrompt.trim()) return;
    setStage("enhance");
    setError("");
    try {
      // Generic schema stub — describes structure only, no real values
      const sampleRow = [{
        content: "<scraped text content>",
        author:  "<author or username>",
        date:    "<timestamp>",
        url:     "<source url>",
      }];
      const res = await apiFetch(`${API_BASE}/api/llm/enhance-prompt`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          prompt:      rawPrompt.trim(),
          sample_rows: sampleRow,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setEnhanced(data);
      setEditedPrompt(data.enhanced_prompt);
      setStage("confirm");
    } catch (e) {
      setError(e.message);
      setStage("error");
    }
  };

  const handleSubmit = async () => {
    setStage("running");
    setError("");
    const promptToSend = editingEnhanced ? editedPrompt : enhanced?.enhanced_prompt;
    const platforms = [...new Set(frozenRows.map(r => r.platform).filter(Boolean))];
    const keyword   = platforms.join(", ");
    try {
      const BODY_PLATFORMS = new Set(["reddit", "spiceworks", "edugeek", "stackexchange", "autodesk"]);
      const res = await apiFetch(`${API_BASE}/api/llm/feed`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          prompt:   promptToSend,
          keyword,
          rows:     frozenRows.slice(0, 15).map(r => {
            const entry = {
              platform: r.platform,
              content:  r.content,
              author:   r.author,
              date:     r.date,
              url:      r.url,
            };
            if (BODY_PLATFORMS.has(r.platform) && r._raw?.body) {
              entry.body = r._raw.body;
            }
            return entry;
          }),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const trendResult = {
        ...data,
        enhancedPrompt: promptToSend,
        rawPrompt,
        recordCount:    frozenRows.length,
        platforms,
        generatedAt:    new Date().toISOString(),
      };
      // Persist so analysis survives navigation away and back
      try { sessionStorage.setItem("TrendSense_trend_result", JSON.stringify(trendResult)); } catch {}
      addNotification({
        title:   "LLM Analysis complete",
        message: `${data.provider ? `${data.provider.charAt(0).toUpperCase() + data.provider.slice(1)} · ` : ""}${frozenRows.length} record${frozenRows.length !== 1 ? "s" : ""} analysed`,
        type:    "success",
      });
      onClose();
      navigate("/trends", { state: trendResult });
    } catch (e) {
      setError(e.message);
      setStage("error");
    }
  };

  const PROVIDER_COLORS = {
    openai:    "#10a37f",
    anthropic: "#d97757",
    gemini:    "#4285f4",
  };
  const PROVIDER_LABELS = {
    openai:    "OpenAI",
    anthropic: "Anthropic",
    gemini:    "Gemini",
  };

  const renderContent = () => {
    if (configLoading) {
      return (
        <Box sx={{ py: 6, textAlign: "center" }}>
          <CircularProgress sx={{ color: "#3b82f6" }} />
          <Typography variant="body2" sx={{ color: C.textMuted, mt: 2 }}>
            Checking LLM configuration…
          </Typography>
        </Box>
      );
    }

    if (!llmConfig) {
      return (
        <Box sx={{ py: 4, textAlign: "center" }}>
          <WarningAmberIcon sx={{ color: "#f59e0b", fontSize: 48, mb: 2 }} />
          <Typography sx={{ color: C.text, fontWeight: 700, mb: 1 }}>
            LLM Not Configured
          </Typography>
          <Typography variant="body2" sx={{ color: C.textSub, mb: 3, maxWidth: 380, mx: "auto" }}>
            You need to configure and activate an LLM provider before using this feature.
            Add your API key in LLM Configuration.
          </Typography>
          <Button
            variant="contained"
            startIcon={<SettingsIcon />}
            onClick={() => { onClose(); onNavigateToConfig?.(); }}
            sx={{ bgcolor: "#3b82f6", textTransform: "none" }}
          >
            Go to LLM Configuration
          </Button>
        </Box>
      );
    }

    if (stage === "prompt") {
      return (
        <Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2,
            p: 1.5, bgcolor: C.cardInner, borderRadius: 2, border: `1px solid ${C.border}` }}>
            <AutoAwesomeIcon sx={{ color: PROVIDER_COLORS[llmConfig.provider], fontSize: 18 }} />
            <Typography variant="caption" sx={{ color: C.textSub }}>
              Active provider:{" "}
              <strong style={{ color: PROVIDER_COLORS[llmConfig.provider] }}>
                {PROVIDER_LABELS[llmConfig.provider]} — {llmConfig.model}
              </strong>
            </Typography>
          </Box>

          <Box sx={{ mb: 2, p: 1.5, bgcolor: C.cardInner, borderRadius: 2, border: `1px solid ${C.border}` }}>
            <Typography variant="caption" sx={{ color: C.textMuted }}>
              Selected data: <strong style={{ color: C.text }}>{frozenRows.length} records</strong>
              {" "}from{" "}
              <strong style={{ color: C.text }}>
                {[...new Set(frozenRows.map(r => r.platform))].join(", ") || "various sources"}
              </strong>
            </Typography>
          </Box>

          <Typography variant="caption" sx={{ color: C.textMuted, display: "block", mb: 1 }}>
            WHAT WOULD YOU LIKE TO KNOW ABOUT THIS DATA?
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={5}
            placeholder={
              "e.g. Summarize the main themes and sentiment\n" +
              "e.g. Find the top complaints and suggest product improvements\n" +
              "e.g. What are people saying about competitor pricing?"
            }
            value={rawPrompt}
            onChange={(e) => setRawPrompt(e.target.value)}
            autoFocus
            sx={{
              mb: 1.5,
              "& .MuiOutlinedInput-root": {
                color: C.text, bgcolor: C.inputBg,
                "& fieldset": { borderColor: C.border },
                "&:hover fieldset": { borderColor: "#a855f7" },
                "&.Mui-focused fieldset": { borderColor: "#a855f7" },
              },
              "& .MuiInputBase-input": { color: C.text, fontSize: "0.9rem", lineHeight: 1.6 },
            }}
          />
          <Typography variant="caption" sx={{ color: C.textMuted }}>
            💡 Your prompt will be automatically enhanced by AI before sending.
            You'll see the improved version and can confirm or edit it.
          </Typography>
        </Box>
      );
    }

    if (stage === "enhance") {
      return (
        <Box sx={{ py: 6, textAlign: "center" }}>
          <CircularProgress sx={{ color: "#a855f7" }} />
          <Typography sx={{ color: C.text, fontWeight: 600, mt: 2 }}>
            Enhancing your prompt with AI…
          </Typography>
          <Typography variant="body2" sx={{ color: C.textMuted, mt: 1 }}>
            Using 1 sample row for context — full dataset sent after confirmation
          </Typography>
        </Box>
      );
    }

    if (stage === "confirm" && enhanced) {
      return (
        <Box>
          <Box sx={{ mb: 2, p: 2, bgcolor: "#0d1f12", borderRadius: 2,
            border: "1px solid #10b981" }}>
            <Typography variant="caption" sx={{ color: "#10b981", fontWeight: 700,
              letterSpacing: 1, display: "block", mb: 0.5 }}>
              ✓ AI UNDERSTOOD YOUR REQUEST
            </Typography>
            <Typography variant="body2" sx={{ color: "#d1fae5", lineHeight: 1.6 }}>
              {enhanced.summary_for_user}
            </Typography>
          </Box>

          <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 700,
            letterSpacing: 1, display: "block", mb: 1 }}>
            ENHANCED PROMPT (will be sent to {PROVIDER_LABELS[llmConfig.provider]})
          </Typography>

          {!editingEnhanced ? (
            <Box sx={{ position: "relative" }}>
              <Box sx={{ p: 2, bgcolor: C.cardInner, borderRadius: 2,
                border: `1px solid ${C.border}`, maxHeight: 200, overflowY: "auto" }}>
                <Typography variant="body2" sx={{ color: C.text, lineHeight: 1.7,
                  whiteSpace: "pre-wrap", fontSize: "0.85rem" }}>
                  {enhanced.enhanced_prompt}
                </Typography>
              </Box>
              <IconButton size="small"
                onClick={() => setEditingEnhanced(true)}
                sx={{ position: "absolute", top: 8, right: 8,
                  color: C.textMuted, bgcolor: C.card, "&:hover": { color: "#3b82f6" } }}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Box>
          ) : (
            <Box>
              <TextField
                fullWidth multiline rows={6}
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                sx={{
                  "& .MuiOutlinedInput-root": {
                    color: C.text, bgcolor: C.inputBg,
                    "& fieldset": { borderColor: "#3b82f6" },
                  },
                  "& .MuiInputBase-input": { color: C.text, fontSize: "0.85rem" },
                }}
              />
              <Button size="small" onClick={() => setEditingEnhanced(false)}
                sx={{ color: C.textMuted, mt: 0.5, textTransform: "none", fontSize: "0.75rem" }}>
                ✓ Done editing
              </Button>
            </Box>
          )}

          {enhanced.suggested_output_format && (
            <Typography variant="caption" sx={{ color: C.textMuted, display: "block", mt: 1 }}>
              Suggested output format: {enhanced.suggested_output_format}
            </Typography>
          )}
        </Box>
      );
    }

    if (stage === "running") {
      return (
        <Box sx={{ py: 6, textAlign: "center" }}>
          <CircularProgress sx={{ color: PROVIDER_COLORS[llmConfig?.provider] || "#3b82f6" }} />
          <Typography sx={{ color: C.text, fontWeight: 600, mt: 2 }}>
            Analyzing {frozenRows.length} records…
          </Typography>
          <Typography variant="body2" sx={{ color: C.textMuted, mt: 1 }}>
            {PROVIDER_LABELS[llmConfig?.provider]} is processing your request
          </Typography>
        </Box>
      );
    }

    if (stage === "error") {
      return (
        <Box sx={{ py: 3 }}>
          <Alert severity="error"
            sx={{ bgcolor: "#1c0a0a", color: "#fca5a5", border: "1px solid #ef4444",
              "& .MuiAlert-icon": { color: "#ef4444" } }}>
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Error</Typography>
            <Typography variant="caption">{error}</Typography>
          </Alert>
          {error?.includes("OpenAI") && (
            <Button size="small" onClick={() => { onClose(); onNavigateToConfig?.(); }}
              startIcon={<SettingsIcon />}
              sx={{ mt: 2, color: "#3b82f6", textTransform: "none" }}>
              Go to LLM Configuration
            </Button>
          )}
        </Box>
      );
    }

    return null;
  };

  const renderActions = () => {
    if (configLoading || !llmConfig) return null;

    if (stage === "prompt") {
      return (
        <>
          <Button onClick={onClose} sx={{ color: C.textMuted, textTransform: "none" }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleEnhance}
            disabled={!rawPrompt.trim()}
            startIcon={<AutoAwesomeIcon />}
            sx={{
              bgcolor: "#a855f7", textTransform: "none",
              "&:hover": { bgcolor: "#9333ea" },
              "&.Mui-disabled": { bgcolor: "#374151", color: "#6b7280" },
            }}
          >
            Enhance & Continue
          </Button>
        </>
      );
    }

    if (stage === "confirm") {
      return (
        <>
          <Button
            onClick={() => setStage("prompt")}
            sx={{ color: C.textMuted, textTransform: "none" }}
          >
            ← Edit Prompt
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            startIcon={<SendIcon />}
            sx={{
              bgcolor: PROVIDER_COLORS[llmConfig?.provider] || "#3b82f6",
              textTransform: "none",
              "&:hover": { filter: "brightness(1.1)" },
            }}
          >
            Send to {PROVIDER_LABELS[llmConfig?.provider]}
          </Button>
        </>
      );
    }

    if (stage === "error") {
      return (
        <>
          <Button onClick={() => setStage("prompt")} sx={{ color: C.textMuted, textTransform: "none" }}>
            Try Again
          </Button>
          <Button onClick={onClose} sx={{ color: C.textSub, textTransform: "none" }}>
            Close
          </Button>
        </>
      );
    }

    return null;
  };

  const titleMap = {
    prompt:  "Feed to LLM",
    enhance: "Enhancing Prompt…",
    confirm: "Confirm Analysis Request",
    running: "Running Analysis…",
    error:   "Something Went Wrong",
  };

  return (
    <Dialog
      open={open}
      onClose={stage === "running" || stage === "enhance" ? undefined : onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { bgcolor: C.card, border: `1px solid ${C.border}`, borderRadius: 3 } }}
    >
      <DialogTitle sx={{
        color: C.text, fontWeight: 700,
        display: "flex", justifyContent: "space-between", alignItems: "center", pb: 1,
      }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <AutoAwesomeIcon sx={{ color: "#a855f7" }} />
          {titleMap[stage] || "Feed to LLM"}
        </Box>
        {stage !== "running" && stage !== "enhance" && (
          <IconButton onClick={onClose} size="small" sx={{ color: C.textMuted }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
      </DialogTitle>

      <Divider sx={{ bgcolor: C.border }} />

      <DialogContent sx={{ pt: 2.5 }}>
        {renderContent()}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        {renderActions()}
      </DialogActions>
    </Dialog>
  );
};

export default LLMFeedModal;
