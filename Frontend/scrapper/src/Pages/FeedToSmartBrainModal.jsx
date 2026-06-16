import React, { useState, useEffect } from "react";
import { apiFetch } from "../api";
import {
  Dialog, DialogTitle, DialogContent,
  Box, Typography, Button, CircularProgress, Chip,
  Divider, IconButton,
} from "@mui/material";
import PsychologyIcon  from "@mui/icons-material/Psychology";
import CloseIcon       from "@mui/icons-material/Close";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useAppTheme } from "../AppThemeContext";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "../NotificationContext";

const API_BASE      = "http://localhost:8000";
const SB_PROMPT_KEY = "sbPrompt";
const SB_RESULT_KEY = "sbLastResult";

export default function FeedToSmartBrainModal({ open, onClose, selectedRows }) {
  const { C }  = useAppTheme();
  const navigate = useNavigate();
  const { addNotification } = useNotifications();

  const [stage,   setStage]   = useState(null); // null | "enhancing" | "analyzing" | "done" | "no-prompt"
  const [error,   setError]   = useState("");
  const [frozen,  setFrozen]  = useState([]);

  useEffect(() => {
    if (!open) return;

    const prompt = localStorage.getItem(SB_PROMPT_KEY) || "";
    const rows   = selectedRows || [];

    setFrozen(rows);
    setError("");

    if (!prompt.trim()) {
      setStage("no-prompt");
      return;
    }

    // Auto-start immediately — no user interaction needed
    setStage("analyzing");
    runAnalysis(prompt.trim(), rows);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAnalysis = async (prompt, rows) => {
    try {
      const records = rows.map(r => r._raw || r);
      const r2 = await apiFetch(`${API_BASE}/api/smart-brain/run-direct`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ prompt, records }),
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
        enhanced_prompt: prompt,
        prompt_used:     prompt,
        record_count:    records.length,
        timestamp:       new Date().toISOString(),
      };
      // Save to DB for persistence
      await apiFetch(`${API_BASE}/api/smart-brain/history`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      // Also set pending key so SmartBrain page knows to reload
      localStorage.setItem(SB_RESULT_KEY, "1");

      addNotification({
        title:   "Smart Brain analysis complete",
        message: `${records.length} record${records.length !== 1 ? "s" : ""} analysed`,
        type:    "success",
      });

      setStage("done");
      setTimeout(() => { onClose(); navigate("/smart-brain"); }, 1200);

    } catch (err) {
      setError(err.message);
      setStage("error");
    }
  };

  const isRunning = stage === "enhancing" || stage === "analyzing";

  return (
    <Dialog
      open={open}
      onClose={isRunning ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { bgcolor: C.card, border: `1px solid ${C.border}`, borderRadius: 3 } }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1, color: C.text }}>
        <PsychologyIcon sx={{ color: "#a78bfa" }} />
        Feed to Smart Brain
        <Chip
          label={`${frozen.length || selectedRows?.length || 0} record${(frozen.length || selectedRows?.length) !== 1 ? "s" : ""}`}
          size="small"
          sx={{ ml: 0.5, bgcolor: "#a78bfa22", color: "#a78bfa", fontWeight: 600 }}
        />
        {!isRunning && (
          <IconButton size="small" onClick={onClose} sx={{ ml: "auto", color: C.textMuted }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
      </DialogTitle>

      <Divider sx={{ bgcolor: C.border }} />

      <DialogContent sx={{ pt: 2.5, pb: 3 }}>

        {/* ── No prompt saved ── */}
        {stage === "no-prompt" && (
          <Box sx={{ textAlign: "center", py: 3 }}>
            <WarningAmberIcon sx={{ color: "#f59e0b", fontSize: 48, mb: 2 }} />
            <Typography sx={{ fontWeight: 700, color: C.text, mb: 1 }}>
              No prompt saved
            </Typography>
            <Typography variant="body2" sx={{ color: C.textSub, mb: 3, maxWidth: 360, mx: "auto" }}>
              Go to the Smart Brain page, type your analysis prompt in the
              <strong style={{ color: "#a78bfa" }}> Analysis Prompt </strong>
              section and save it. Then come back and try again.
            </Typography>
            <Box sx={{ display: "flex", gap: 1.5, justifyContent: "center" }}>
              <Button onClick={onClose} sx={{ color: C.textMuted, textTransform: "none" }}>
                Cancel
              </Button>
              <Button variant="contained"
                startIcon={<PsychologyIcon />}
                onClick={() => { onClose(); navigate("/smart-brain"); }}
                sx={{ bgcolor: "#7c3aed", textTransform: "none", fontWeight: 600,
                  "&:hover": { bgcolor: "#6d28d9" } }}>
                Go to Smart Brain
              </Button>
            </Box>
          </Box>
        )}

        {/* ── Analyzing ── */}
        {stage === "analyzing" && (
          <Box sx={{ textAlign: "center", py: 4 }}>
            <CircularProgress size={44} sx={{ color: "#a78bfa", mb: 2.5 }} />
            <Typography sx={{ color: C.text, fontWeight: 700, mb: 0.5 }}>
              Analyzing Records…
            </Typography>
            <Typography variant="body2" sx={{ color: C.textSub, fontSize: "0.82rem" }}>
              Feeding {frozen.length} records to the AI…
            </Typography>
          </Box>
        )}

        {/* ── Done ── */}
        {stage === "done" && (
          <Box sx={{ textAlign: "center", py: 4 }}>
            <Typography sx={{ fontSize: "2.5rem", mb: 1 }}>✓</Typography>
            <Typography sx={{ color: "#4ade80", fontWeight: 700, mb: 0.5 }}>
              Analysis Complete!
            </Typography>
            <Typography variant="body2" sx={{ color: C.textSub, fontSize: "0.82rem" }}>
              Redirecting to Smart Brain…
            </Typography>
          </Box>
        )}

        {/* ── Error ── */}
        {stage === "error" && (
          <Box sx={{ textAlign: "center", py: 3 }}>
            <Typography sx={{ color: "#ef4444", fontWeight: 700, mb: 1 }}>
              Something went wrong
            </Typography>
            <Typography variant="body2" sx={{ color: C.textSub, fontSize: "0.82rem", mb: 3 }}>
              {error}
            </Typography>
            <Box sx={{ display: "flex", gap: 1.5, justifyContent: "center" }}>
              <Button onClick={onClose} sx={{ color: C.textMuted, textTransform: "none" }}>
                Close
              </Button>
              <Button variant="contained"
                onClick={() => {
                  const prompt = localStorage.getItem(SB_PROMPT_KEY) || "";
                  setStage("enhancing");
                  setError("");
                  runAnalysis(prompt.trim(), frozen);
                }}
                sx={{ bgcolor: "#7c3aed", textTransform: "none", "&:hover": { bgcolor: "#6d28d9" } }}>
                Retry
              </Button>
            </Box>
          </Box>
        )}

      </DialogContent>
    </Dialog>
  );
}
