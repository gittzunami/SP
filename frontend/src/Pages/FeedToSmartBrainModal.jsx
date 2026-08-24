import React, { useState, useEffect, useRef } from "react";
import { apiFetch } from "../api";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Typography, Button, CircularProgress, Chip,
  Divider, IconButton, Alert, Tooltip, Stack,
} from "@mui/material";
import PsychologyIcon   from "@mui/icons-material/Psychology";
import CloseIcon        from "@mui/icons-material/Close";
import FolderOpenIcon   from "@mui/icons-material/FolderOpen";
import HistoryIcon      from "@mui/icons-material/History";
import PlayArrowIcon    from "@mui/icons-material/PlayArrow";
import CheckCircleIcon  from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import DescriptionIcon  from "@mui/icons-material/Description";
import SaveIcon         from "@mui/icons-material/Save";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useAppTheme }  from "../AppThemeContext";
import { useNavigate }  from "react-router-dom";
import { useNotifications } from "../NotificationContext";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

function formatDateShort(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function groupByDay(entries) {
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const groups    = {};

  for (const entry of entries) {
    const raw = entry.created_at || entry.timestamp;
    let d = today;
    if (raw) {
      try {
        const dt = new Date(raw);
        if (!isNaN(dt.getTime())) d = dt.toISOString().slice(0, 10);
      } catch (_) {}
    }
    const label = d === today ? "Today" : d === yesterday ? "Yesterday" : d;
    if (!groups[label]) groups[label] = [];
    groups[label].push(entry);
  }
  return groups;
}

export default function FeedToSmartBrainModal({ open, onClose, selectedRows }) {
  const { C, isDark } = useAppTheme();
  const navigate = useNavigate();
  const { addNotification } = useNotifications();

  const [promptText,        setPromptText]        = useState("");
  const [selectedPromptId,  setSelectedPromptId]  = useState(null);
  const [promptsList,       setPromptsList]       = useState([]);
  const [promptsLoading,    setPromptsLoading]    = useState(false);
  const [parsing,           setParsing]           = useState(false);
  const [parseError,        setParseError]        = useState("");
  const [savingPrompt,      setSavingPrompt]      = useState(false);
  const [promptSaved,       setPromptSaved]       = useState(false);
  const [stage,             setStage]             = useState("idle"); // "idle" | "analyzing" | "done" | "error"
  const [error,             setError]             = useState("");
  const [frozen,            setFrozen]            = useState([]);
  const fileRef = useRef(null);

  // Load saved prompts and snapshot rows when modal opens
  useEffect(() => {
    if (!open) return;

    const rows = selectedRows || [];
    setFrozen(rows);
    setStage("idle");
    setError("");
    setParseError("");
    setPromptText("");
    setSelectedPromptId(null);
    setPromptSaved(false);
    setPromptsLoading(true);

    apiFetch(`${API_BASE}/api/smart-brain/prompts`)
      .then((r) => (r.ok ? r.json() : { prompts: [] }))
      .then((data) => {
        const list = data.prompts || [];
        setPromptsList(list);
        if (list.length > 0) {
          // Pre-select most recent prompt
          setSelectedPromptId(list[0].id);
          setPromptText(list[0].text || "");
          setPromptSaved(true);
        }
      })
      .catch(() => {})
      .finally(() => setPromptsLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectPrompt = (p) => {
    setSelectedPromptId(p.id);
    setPromptText(p.text || "");
    setPromptSaved(true);
  };

  const handleSavePrompt = async () => {
    const clean = promptText.trim();
    if (!clean) return;
    setSavingPrompt(true);
    setParseError("");
    try {
      const res = await apiFetch(`${API_BASE}/api/smart-brain/prompts`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ text: clean }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const created = await res.json();
      setPromptsList((prev) => [created, ...prev.filter((p) => p.id !== created.id)]);
      setSelectedPromptId(created.id);
      setPromptSaved(true);
    } catch (err) {
      setParseError(`Failed to save prompt: ${err.message}`);
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleClearPrompt = () => {
    setPromptText("");
    setSelectedPromptId(null);
    setPromptSaved(false);
  };

  const handleDeletePrompt = async (promptId, e) => {
    if (e) e.stopPropagation();
    setPromptsList((prev) => prev.filter((p) => p.id !== promptId));
    if (selectedPromptId === promptId) {
      setSelectedPromptId(null);
    }
    try {
      await apiFetch(`${API_BASE}/api/smart-brain/prompts/${promptId}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.error("Failed to delete prompt:", err);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setParseError("");
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await apiFetch(`${API_BASE}/api/smart-brain/parse-file`, {
        method: "POST",
        body:   form,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPromptText(data.text || "");
      setSelectedPromptId(null); // custom prompt now in textarea
    } catch (err) {
      setParseError(`Failed to parse file: ${err.message}`);
    } finally {
      setParsing(false);
      e.target.value = "";
    }
  };

  const runAnalysis = async () => {
    const cleanPrompt = promptText.trim();
    if (!cleanPrompt) return;

    // Auto-save prompt to DB library if not already saved
    const isAlreadySaved = promptsList.some(
      (p) => p.text.trim().toLowerCase() === cleanPrompt.toLowerCase()
    );
    if (!isAlreadySaved) {
      try {
        const pRes = await apiFetch(`${API_BASE}/api/smart-brain/prompts`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ text: cleanPrompt }),
        });
        if (pRes.ok) {
          const created = await pRes.json();
          setPromptsList((prev) => [created, ...prev]);
        }
      } catch (_) {}
    }

    setStage("analyzing");
    setError("");

    try {
      const records = frozen.map((r) => r._raw || r);
      const r2 = await apiFetch(`${API_BASE}/api/smart-brain/run-direct`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ prompt: promptText.trim(), records }),
      });
      if (!r2.ok) {
        const e = await r2.json().catch(() => ({}));
        throw new Error(e.detail || `HTTP ${r2.status}`);
      }
      const d2 = await r2.json();

      const payload = {
        result:          d2.response || "",
        provider:        d2.provider || "",
        model:           d2.model    || "",
        tokens_used:     d2.tokens_used  || 0,
        cost_usd:        d2.cost_usd     || 0,
        enhanced_prompt: promptText.trim(),
        prompt_used:     promptText.trim(),
        record_count:    records.length,
        timestamp:       new Date().toISOString(),
      };

      // Persist to analysis history in DB
      await apiFetch(`${API_BASE}/api/smart-brain/history`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });

      addNotification({
        title:   "Smart Brain analysis complete",
        message: `${records.length} record${records.length !== 1 ? "s" : ""} analysed`,
        type:    "success",
      });

      setStage("done");
      setTimeout(() => {
        onClose();
        navigate("/smart-brain", { state: { pending: true } });
      }, 1000);
    } catch (err) {
      setError(err.message);
      setStage("error");
    }
  };

  const selectedPromptObj = promptsList.find((p) => p.id === selectedPromptId) || null;
  const groups = groupByDay(promptsList);
  const isRunning = stage === "analyzing";

  return (
    <Dialog
      open={open}
      onClose={isRunning ? undefined : onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor:      C.card,
          border:       `1px solid ${C.border}`,
          borderRadius: 3,
          boxShadow:    C.shadow,
          overflow:     "hidden",
        },
      }}
    >
      <DialogTitle
        sx={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          color:          C.text,
          pb:             1.5,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <PsychologyIcon sx={{ color: "#a78bfa", fontSize: 26 }} />
          <Typography sx={{ fontWeight: 700, fontSize: "1.1rem" }}>
            Feed to Smart Brain
          </Typography>
          <Chip
            label={`${frozen.length || selectedRows?.length || 0} record${(frozen.length || selectedRows?.length) !== 1 ? "s" : ""}`}
            size="small"
            sx={{ ml: 0.5, bgcolor: "#a78bfa22", color: "#a78bfa", fontWeight: 600, fontSize: "0.75rem" }}
          />
        </Box>
        {!isRunning && (
          <IconButton size="small" onClick={onClose} sx={{ color: C.textMuted }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
      </DialogTitle>

      <Divider sx={{ bgcolor: C.border }} />

      <DialogContent sx={{ p: 0 }}>
        {/* ── State: Analyzing ── */}
        {stage === "analyzing" && (
          <Box sx={{ textAlign: "center", py: 8, px: 3 }}>
            <CircularProgress size={48} sx={{ color: "#a78bfa", mb: 3 }} />
            <Typography sx={{ color: C.text, fontWeight: 700, fontSize: "1.1rem", mb: 1 }}>
              Analyzing Records with Smart Brain…
            </Typography>
            <Typography variant="body2" sx={{ color: C.textSub, fontSize: "0.88rem" }}>
              Feeding {frozen.length} records to the AI model. This may take a few moments.
            </Typography>
          </Box>
        )}

        {/* ── State: Done ── */}
        {stage === "done" && (
          <Box sx={{ textAlign: "center", py: 7, px: 3 }}>
            <CheckCircleIcon sx={{ color: "#10b981", fontSize: 56, mb: 1.5 }} />
            <Typography sx={{ color: "#10b981", fontWeight: 700, fontSize: "1.2rem", mb: 0.5 }}>
              Analysis Complete!
            </Typography>
            <Typography variant="body2" sx={{ color: C.textSub, fontSize: "0.85rem" }}>
              Redirecting to Smart Brain results…
            </Typography>
          </Box>
        )}

        {/* ── State: Error ── */}
        {stage === "error" && (
          <Box sx={{ p: 3 }}>
            <Alert
              severity="error"
              sx={{
                bgcolor: isDark ? "#1c0a0a" : "#fef2f2",
                color:   "#ef4444",
                border:  "1px solid #ef444455",
                mb: 2,
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
                Analysis Failed
              </Typography>
              <Typography variant="caption">{error}</Typography>
            </Alert>
            <Box sx={{ display: "flex", gap: 1.5, justifyContent: "flex-end" }}>
              <Button onClick={() => setStage("idle")} sx={{ color: C.textMuted, textTransform: "none" }}>
                Back to Edit
              </Button>
              <Button
                variant="contained"
                onClick={runAnalysis}
                sx={{ bgcolor: "#7c3aed", textTransform: "none", "&:hover": { bgcolor: "#6d28d9" } }}
              >
                Retry
              </Button>
            </Box>
          </Box>
        )}

        {/* ── State: Idle (Main UI) ── */}
        {stage === "idle" && (
          <Box sx={{ display: "flex", flexDirection: "column" }}>
            {/* Top Prompt Input Section */}
            <Box sx={{ p: 2.5, borderBottom: `1px solid ${C.border}`, bgcolor: C.cardInner }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.2 }}>
                <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 700, letterSpacing: 0.8 }}>
                  ANALYSIS PROMPT
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={parsing ? <CircularProgress size={12} sx={{ color: C.textSub }} /> : <FolderOpenIcon sx={{ fontSize: 14 }} />}
                    onClick={() => fileRef.current?.click()}
                    disabled={parsing}
                    sx={{
                      fontSize:      "0.75rem",
                      borderColor:   C.border,
                      color:         C.textSub,
                      textTransform: "none",
                      py:            0.3,
                      px:            1.2,
                      "&:hover":     { borderColor: "#a78bfa", color: "#a78bfa" },
                    }}
                  >
                    {parsing ? "Parsing…" : "Upload Prompt File"}
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".txt,.pdf,.docx,.mx"
                    hidden
                    onChange={handleFileUpload}
                  />
                </Stack>
              </Box>

              {parseError && (
                <Alert severity="error" sx={{ mb: 1.5, py: 0.3, fontSize: "0.78rem" }}>
                  {parseError}
                </Alert>
              )}

              <textarea
                rows={4}
                placeholder="Type your prompt here, upload a file, or pick a saved prompt from the list below…"
                value={promptText}
                onChange={(e) => {
                  setPromptText(e.target.value);
                  setSelectedPromptId(null); // user modified text
                  setPromptSaved(false);
                }}
                style={{
                  width:        "100%",
                  boxSizing:    "border-box",
                  resize:       "vertical",
                  padding:      "10px 12px",
                  borderRadius: 8,
                  fontSize:     "0.88rem",
                  lineHeight:   1.6,
                  fontFamily:   "inherit",
                  background:   isDark ? "#0a0e17" : "#ffffff",
                  color:        isDark ? "#e2e8f0" : "#1e293b",
                  border:       `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                  outline:      "none",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#a78bfa")}
                onBlur={(e) => (e.target.style.borderColor = isDark ? "#334155" : "#cbd5e1")}
              />

              <Box sx={{ display: "flex", gap: 1, alignItems: "center", mt: 1.2 }}>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={savingPrompt ? <CircularProgress size={12} sx={{ color: "white" }} /> : <SaveIcon sx={{ fontSize: 15 }} />}
                  onClick={handleSavePrompt}
                  disabled={!promptText.trim() || savingPrompt}
                  sx={{
                    bgcolor:       "#7c3aed",
                    color:         "white",
                    fontSize:      "0.76rem",
                    fontWeight:    600,
                    textTransform: "none",
                    py:            0.4,
                    px:            1.5,
                    "&:hover":     { bgcolor: "#6d28d9" },
                    "&.Mui-disabled": { bgcolor: isDark ? "#3b2a6b" : "#ddd6fe", color: isDark ? "#7c5cbf" : "#8b5cf6" },
                  }}
                >
                  {savingPrompt ? "Saving…" : "Save Prompt"}
                </Button>

                {promptSaved && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.4, bgcolor: "#14532d44", borderRadius: 1, px: 0.8, py: 0.3 }}>
                    <CheckCircleIcon sx={{ fontSize: 12, color: "#4ade80" }} />
                    <Typography sx={{ fontSize: "0.7rem", color: "#4ade80", fontWeight: 700 }}>Saved</Typography>
                  </Box>
                )}

                {promptText && (
                  <Button
                    size="small"
                    onClick={handleClearPrompt}
                    sx={{
                      color:         C.textMuted,
                      fontSize:      "0.75rem",
                      textTransform: "none",
                      "&:hover":     { color: "#ef4444", bgcolor: "transparent" },
                    }}
                  >
                    Clear
                  </Button>
                )}
              </Box>
            </Box>

            {/* Split Section: Saved Prompts on Left, Prompt Preview on Right */}
            <Box
              sx={{
                display:   "flex",
                minHeight: 240,
                maxHeight: 320,
              }}
            >
              {/* Left Column: Saved Prompts List */}
              <Box
                sx={{
                  width:        { xs: "45%", sm: "38%" },
                  minWidth:     200,
                  maxWidth:     280,
                  borderRight:  `1px solid ${C.border}`,
                  bgcolor:      C.card,
                  display:      "flex",
                  flexDirection:"column",
                }}
              >
                <Box
                  sx={{
                    px:           1.5,
                    py:           1,
                    display:      "flex",
                    alignItems:   "center",
                    gap:          0.8,
                    borderBottom: `1px solid ${C.border}`,
                    bgcolor:      C.cardInner,
                  }}
                >
                  <HistoryIcon sx={{ color: "#a78bfa", fontSize: 16 }} />
                  <Typography sx={{ fontSize: "0.75rem", fontWeight: 700, color: C.text }}>
                    Prompt History
                  </Typography>
                  {promptsList.length > 0 && (
                    <Chip
                      label={promptsList.length}
                      size="small"
                      sx={{
                        ml:        "auto",
                        height:    18,
                        fontSize:  "0.65rem",
                        bgcolor:   isDark ? "#374151" : "#e5e7eb",
                        color:     C.textSub,
                        fontWeight:700,
                      }}
                    />
                  )}
                </Box>

                <Box
                  sx={{
                    flex:      1,
                    overflowY: "auto",
                    p:         1,
                    "&::-webkit-scrollbar":       { width: 4 },
                    "&::-webkit-scrollbar-thumb": { bgcolor: C.border, borderRadius: 4 },
                  }}
                >
                  {promptsLoading ? (
                    <Box sx={{ py: 4, textAlign: "center" }}>
                      <CircularProgress size={20} sx={{ color: "#a78bfa" }} />
                    </Box>
                  ) : promptsList.length === 0 ? (
                    <Box sx={{ py: 4, px: 1, textAlign: "center" }}>
                      <DescriptionIcon sx={{ color: C.textMuted, fontSize: 28, mb: 1, opacity: 0.5 }} />
                      <Typography sx={{ color: C.textMuted, fontSize: "0.75rem" }}>
                        No saved prompts yet.
                      </Typography>
                    </Box>
                  ) : (
                    Object.entries(groups).map(([label, items]) => (
                      <Box key={label} sx={{ mb: 1.2 }}>
                        <Typography
                          sx={{
                            color:         C.textMuted,
                            fontSize:      "0.62rem",
                            fontWeight:    700,
                            letterSpacing: 0.8,
                            px:            0.5,
                            py:            0.3,
                            textTransform: "uppercase",
                          }}
                        >
                          {label}
                        </Typography>
                        <Stack spacing={0.5}>
                          {items.map((p) => {
                            const isSelected = selectedPromptId === p.id;
                            return (
                              <Box
                                key={p.id}
                                onClick={() => handleSelectPrompt(p)}
                                sx={{
                                  px:           1.2,
                                  py:           0.8,
                                  borderRadius: 1.5,
                                  cursor:       "pointer",
                                  bgcolor:      isSelected ? "#a78bfa18" : "transparent",
                                  border:       `1px solid ${isSelected ? "#a78bfa55" : "transparent"}`,
                                  "&:hover":    { bgcolor: isSelected ? "#a78bfa22" : C.hover, "& .prompt-del-btn": { opacity: 1 } },
                                  transition:   "all 0.15s",
                                  position:     "relative",
                                }}
                              >
                                <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 0.5 }}>
                                  <Typography
                                    sx={{
                                      color:        isSelected ? C.text : C.textSub,
                                      fontSize:     "0.76rem",
                                      lineHeight:   1.35,
                                      fontWeight:   isSelected ? 600 : 400,
                                      display:      "-webkit-box",
                                      WebkitLineClamp: 2,
                                      WebkitBoxOrient: "vertical",
                                      overflow:     "hidden",
                                      flex:         1,
                                    }}
                                  >
                                    {p.text}
                                  </Typography>
                                  <Tooltip title="Delete Prompt">
                                    <IconButton
                                      size="small"
                                      className="prompt-del-btn"
                                      onClick={(e) => handleDeletePrompt(p.id, e)}
                                      sx={{
                                        p:          0.2,
                                        mt:         -0.3,
                                        mr:         -0.4,
                                        opacity:    0,
                                        color:      C.textMuted,
                                        transition: "opacity 0.15s, color 0.15s",
                                        "&:hover":  { color: "#ef4444", bgcolor: "transparent" },
                                      }}
                                    >
                                      <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                                    </IconButton>
                                  </Tooltip>
                                </Box>
                                <Typography sx={{ color: C.textMuted, fontSize: "0.62rem", mt: 0.4 }}>
                                  {formatDateShort(p.created_at)}
                                </Typography>
                              </Box>
                            );
                          })}
                        </Stack>
                      </Box>
                    ))
                  )}
                </Box>
              </Box>

              {/* Right Column: Full Prompt Preview */}
              <Box
                sx={{
                  flex:          1,
                  display:       "flex",
                  flexDirection: "column",
                  bgcolor:       C.bg,
                }}
              >
                <Box
                  sx={{
                    px:           2,
                    py:           1,
                    borderBottom: `1px solid ${C.border}`,
                    bgcolor:      C.cardInner,
                    display:      "flex",
                    alignItems:   "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 700, letterSpacing: 0.8 }}>
                    PROMPT PREVIEW
                  </Typography>
                  {selectedPromptObj && (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.8 }}>
                      <Typography variant="caption" sx={{ color: C.textMuted, fontSize: "0.7rem" }}>
                        Saved: {formatDateShort(selectedPromptObj.created_at)}
                      </Typography>
                      <Tooltip title="Delete this saved prompt">
                        <IconButton
                          size="small"
                          onClick={(e) => handleDeletePrompt(selectedPromptObj.id, e)}
                          sx={{
                            p: 0.3,
                            color: C.textMuted,
                            "&:hover": { color: "#ef4444", bgcolor: "transparent" },
                          }}
                        >
                          <DeleteOutlineIcon sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  )}
                </Box>

                <Box
                  sx={{
                    flex:       1,
                    overflowY:  "auto",
                    p:          2,
                    "&::-webkit-scrollbar":       { width: 4 },
                    "&::-webkit-scrollbar-thumb": { bgcolor: C.border, borderRadius: 4 },
                  }}
                >
                  {promptText ? (
                    <Typography
                      variant="body2"
                      sx={{
                        color:      C.text,
                        whiteSpace: "pre-wrap",
                        lineHeight: 1.65,
                        fontSize:   "0.82rem",
                      }}
                    >
                      {promptText}
                    </Typography>
                  ) : (
                    <Box sx={{ py: 5, textAlign: "center" }}>
                      <Typography sx={{ color: C.textMuted, fontSize: "0.8rem" }}>
                        Select a prompt from the history list on the left to preview it here.
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
          </Box>
        )}
      </DialogContent>

      <Divider sx={{ bgcolor: C.border }} />

      <DialogActions sx={{ px: 2.5, py: 1.5, gap: 1 }}>
        <Button
          onClick={onClose}
          disabled={isRunning}
          sx={{ color: C.textMuted, textTransform: "none", fontSize: "0.85rem" }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={runAnalysis}
          disabled={!promptText.trim() || isRunning}
          startIcon={<PlayArrowIcon />}
          sx={{
            bgcolor:       "#7c3aed",
            textTransform: "none",
            fontWeight:    600,
            fontSize:      "0.85rem",
            px:            2.5,
            "&:hover":     { bgcolor: "#6d28d9" },
            "&.Mui-disabled": { bgcolor: "#3b2a6b", color: "#7c5cbf" },
          }}
        >
          Run Analysis
        </Button>
      </DialogActions>
    </Dialog>
  );
}
