import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api";
import {
  Box, Card, CardContent, Typography, Grid, LinearProgress,
  Table, TableBody, TableCell, TableHead, TableRow, Stack,
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Chip, IconButton, CircularProgress, Snackbar,
  Alert, Divider, InputAdornment,
}
from "@mui/material";
import WarningAmberIcon  from "@mui/icons-material/WarningAmber";
import CloseIcon         from "@mui/icons-material/Close";
import TuneIcon          from "@mui/icons-material/Tune";
import BlockIcon         from "@mui/icons-material/Block";
import CheckCircleIcon   from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon  from "@mui/icons-material/ErrorOutline";
import EmailIcon         from "@mui/icons-material/Email";
import AttachMoneyIcon   from "@mui/icons-material/AttachMoney";

import { useBudget, EMAIL_ALERT_THRESHOLD, HARD_BLOCK_THRESHOLD } from "../BudgetContext";
import { useAppTheme } from "../AppThemeContext";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const DISPLAY_EMAIL_THRESHOLD = 80;
const DISPLAY_HARD_THRESHOLD  = 100;

const SCRAPER_KEYS = [
  "reddit", "edugeek", "stackexchange", "autodesk", "twitter", "google_news", "spiceworks", "quora", "facebook",
];
const SCRAPER_LABELS = {
  reddit:        "Reddit",
  edugeek:       "EduGeek",
  stackexchange: "StackExchange",
  autodesk:      "Autodesk",
  twitter:       "Twitter / X",
  google_news:   "Google News",
  spiceworks:    "Spiceworks",
  quora:         "Quora",
  facebook:      "Facebook Groups",
};

const PROVIDER_COLORS = {
  apify:          "#3b82f6",
  scrapecreators: "#a855f7",
  scrapingbee:    "#f59e0b",
  stackapps:      "#10b981",
  reddit_public:  "#ef4444",
  autodesk_liql:  "#06b6d4",
};

const LLM_PROVIDER_COLORS = {
  openai:    "#10a37f",
  anthropic: "#d97757",
  gemini:    "#4285f4",
};

const LLM_PROVIDER_LABELS = {
  openai:    "OpenAI",
  anthropic: "Anthropic",
  gemini:    "Gemini",
};

const ALLOC_KEY = "TrendSense_budget_alloc_v2";

function defaultAllocations(total) {
  const each = parseFloat((total / SCRAPER_KEYS.length).toFixed(2));
  const alloc = {};
  SCRAPER_KEYS.forEach((k) => { alloc[k] = each; });
  return alloc;
}

function loadAllocations(total) {
  try {
    const raw = localStorage.getItem(ALLOC_KEY);
    return raw ? JSON.parse(raw) : defaultAllocations(total);
  } catch { return defaultAllocations(total); }
}

function saveAllocations(a) {
  try { localStorage.setItem(ALLOC_KEY, JSON.stringify(a)); } catch {}
}

const fmt = (n) => {
  if (typeof n !== "number") return "$0.00";
  const decimals = n > 0 && n < 0.01 ? 4 : 2;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
};

const timeAgo = (iso) => {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

// ── Error state ───────────────────────────────────────────────────────────────
const ErrorState = ({ error, onRetry, C }) => (
  <Box sx={{ p: 4, textAlign: "center" }}>
    <ErrorOutlineIcon sx={{ color: "#ef4444", fontSize: 48, mb: 2 }} />
    <Typography sx={{ color: "#ef4444", fontWeight: 700, mb: 1, fontSize: "1.1rem" }}>
      Could not load cost data
    </Typography>
    <Typography variant="body2" sx={{ color: C.textSub, mb: 1, maxWidth: 500, mx: "auto" }}>
      {error}
    </Typography>
    <Typography variant="caption" sx={{ color: C.textMuted, display: "block", mb: 3 }}>
      Make sure your backend is running and DATABASE_URL is set.
    </Typography>
    <Button variant="outlined" onClick={onRetry} sx={{ borderColor: "#3b82f6", color: "#3b82f6" }}>
      Retry
    </Button>
  </Box>
);

// ══════════════════════════════════════════════════════════════════════════════
const CostGovernance = () => {
  const { C } = useAppTheme();
  const [data,          setData]          = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [modsModal,     setModsModal]     = useState(false);
  const [llmData,       setLlmData]       = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [toast,         setToast]         = useState({ open: false, msg: "", severity: "success" });

  const [budgetInput,   setBudgetInput]   = useState(1000);
  const [allocations,   setAllocations]   = useState({});
  const [allocError,    setAllocError]    = useState("");

  const [emails,        setEmails]        = useState([]);
  const [emailInput,    setEmailInput]    = useState("");

  const { isHardBlocked, isEmailAlert, budgetPct, refresh: refreshBudget, setDismissed } = useBudget();

  const showToast = (msg, severity = "success") => setToast({ open: true, msg, severity });

  const fetchSummary = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/spending/summary`);
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { const b = await res.json(); detail = b.detail || b.message || detail; } catch (_) {}
        throw new Error(detail);
      }
      setData(await res.json());
    } catch (e) {
      setError(e.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
    const id = setInterval(fetchSummary, 30_000);
    return () => clearInterval(id);
  }, [fetchSummary]);

  useEffect(() => {
    const fetchLlm = async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/llm/spending`);
        if (res.ok) setLlmData(await res.json());
      } catch (_) {}
    };
    fetchLlm();
    const id = setInterval(fetchLlm, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Guard: never overwrite user's in-progress edits while the modal is open.
    // The 30-second background poll updates `data` and would otherwise reset
    // every field the user has changed but not yet saved.
    if (!data || modsModal) return;
    const total = data.budget_usd ?? 1000;
    setBudgetInput(total);
    const backendBudgets = data.scraper_budgets || {};
    const hasBackendData = Object.keys(backendBudgets).length > 0;
    if (hasBackendData) {
      const alloc = {};
      SCRAPER_KEYS.forEach((k) => {
        alloc[k] = backendBudgets[k]?.budget_usd ?? loadAllocations(total)[k] ?? 0;
      });
      setAllocations(alloc);
    } else {
      setAllocations(loadAllocations(total));
    }
  }, [data, modsModal]);

  const openModsModal = async () => {
    setAllocError("");
    setEmailInput("");
    setModsModal(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/spending/alert-emails`);
      if (res.ok) {
        const data = await res.json();
        setEmails(data.emails || []);
      }
    } catch (_) {}
  };

  const addEmail = () => {
    const trimmed = emailInput.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) return;
    if (emails.includes(trimmed)) { setEmailInput(""); return; }
    setEmails((prev) => [...prev, trimmed]);
    setEmailInput("");
  };

  const removeEmail = (email) => setEmails((prev) => prev.filter((e) => e !== email));

  const scraperBudgets = data?.scraper_budgets || {};

  const totalAllocated  = Object.values(allocations).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const isOverBudget    = totalAllocated > budgetInput + 0.01;
  const hasBelowSpend   = SCRAPER_KEYS.some((k) => {
    const alloc = allocations[k] ?? 0;
    const spent = scraperBudgets[k]?.spent_usd ?? 0;
    return alloc > 0 && alloc < spent;
  });

  const handleAllocChange = (key, raw) => {
    const val  = Math.max(0, parseFloat(raw) || 0);
    const next = { ...allocations, [key]: val };
    setAllocations(next);
    const total = Object.values(next).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    if (total > budgetInput + 0.01) {
      setAllocError(
        `Total allocation ${fmt(total)} exceeds the overall budget ${fmt(budgetInput)}. ` +
        `Please reduce some values or increase the overall budget first.`
      );
    } else {
      setAllocError("");
    }
  };

  const redistributeEvenly = () => {
    setAllocations(defaultAllocations(budgetInput));
    setAllocError("");
  };


  const handleSave = async () => {
    if (isOverBudget) {
      showToast(
        `Total allocation ${fmt(totalAllocated)} exceeds overall budget ${fmt(budgetInput)}. ` +
        "Reduce source allocations or increase the overall budget first.",
        "error",
      );
      return;
    }
    setSaving(true);
    try {
      const budgetRes = await apiFetch(`${API_BASE}/api/spending/budget`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthly_limit_usd: budgetInput, alert_threshold_pct: 80 }),
      });
      if (!budgetRes.ok) {
        const b = await budgetRes.json().catch(() => ({}));
        throw new Error(b.detail || `HTTP ${budgetRes.status}`);
      }

      const scraperBudgetRes = await apiFetch(`${API_BASE}/api/spending/scraper-budgets`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgets: allocations }),
      });
      if (!scraperBudgetRes.ok) {
        const b = await scraperBudgetRes.json().catch(() => ({}));
        throw new Error(b.detail || `HTTP ${scraperBudgetRes.status}`);
      }

      saveAllocations(allocations);

      const emailRes = await apiFetch(`${API_BASE}/api/spending/alert-emails`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      if (!emailRes.ok) {
        const b = await emailRes.json().catch(() => ({}));
        throw new Error(b.detail || `HTTP ${emailRes.status}`);
      }

      if (data && budgetInput > data.budget_usd) setDismissed(false);

      showToast("Modifications saved!");
      setModsModal(false);
      await fetchSummary();
      refreshBudget();
    } catch (e) {
      showToast(`Save failed: ${e.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const budgetUsedPct    = data?.budget_used_pct ?? 0;
  const todayChange      = data?.today_vs_7d_avg_pct ?? 0;
  const todayChangeLabel = todayChange >= 0
    ? `↑ +${todayChange}% vs 7d avg`
    : `↓ ${todayChange}% vs 7d avg`;

  const budgetColor = budgetUsedPct >= HARD_BLOCK_THRESHOLD
    ? "#ef4444"
    : budgetUsedPct >= EMAIL_ALERT_THRESHOLD
    ? "#f97316"
    : "#10b981";

  const cardSx = {
    bgcolor: C.card,
    border:  `1px solid ${C.border}`,
    boxShadow: C.shadow,
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", height: "50vh", gap: 2 }}>
        <CircularProgress size={40} sx={{ color: "#3b82f6" }} />
        <Typography sx={{ color: C.textMuted }}>Loading cost data…</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ width: "100%", p: { xs: 0, md: 1 } }}>
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontWeight: "bold", color: C.text, fontSize: { xs: "1.2rem", md: "1.75rem" } }}>
            Cost Governance
          </Typography>
          <Typography variant="body2" sx={{ color: C.textSub }}>
            Monitor API usage, infrastructure spend, and budget limits.
          </Typography>
        </Box>
        <Card sx={cardSx}>
          <CardContent><ErrorState error={error} onRetry={fetchSummary} C={C} /></CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <>
      <Box sx={{ width: "100%", display: "flex", flexDirection: "column", p: { xs: 0, md: 1 } }}>

        {/* Header */}
        <Box sx={{ mb: { xs: 3, md: 4 }, display: "flex", justifyContent: "space-between",
          alignItems: "flex-start", flexWrap: "wrap", gap: 2 }}>
          <Box>
            <Typography sx={{ fontWeight: "bold", color: C.text,
              fontSize: { xs: "1.2rem", sm: "1.4rem", md: "1.75rem" } }}>
              Cost Governance
            </Typography>
            <Typography variant="body2" sx={{ color: C.textSub }}>
              Monitor API usage, infrastructure spend, and budget limits.
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={<TuneIcon />}
            onClick={openModsModal}
            sx={{ borderColor: "#3b82f6", color: "#3b82f6", fontWeight: 600,
              textTransform: "none",
              "&:hover": { bgcolor: "#3b82f610", borderColor: "#60a5fa" } }}
          >
            {data?.budget_usd ? `Modifications · ${fmt(data.budget_usd)}/mo` : "Modifications"}
          </Button>
        </Box>

        {/* Overall alert bar */}
        {isEmailAlert && (
          <Box sx={{ mb: 3, p: 2, borderRadius: 2,
            bgcolor: isHardBlocked ? "#7f1d1d30" : "#78350f30",
            border: `1px solid ${isHardBlocked ? "#dc2626" : "#d97706"}`,
            display: "flex", alignItems: "center", gap: 1.5 }}>
            {isHardBlocked
              ? <BlockIcon sx={{ color: "#ef4444", flexShrink: 0 }} />
              : <EmailIcon sx={{ color: "#f59e0b", flexShrink: 0 }} />
            }
            <Typography variant="body2" sx={{ color: isHardBlocked ? "#fca5a5" : "#fde68a" }}>
              {isHardBlocked
                ? `🚫 Overall budget exceeded (${budgetPct.toFixed(1)}%). All collections blocked.`
                : `📧 Alert email sent at ${budgetPct.toFixed(1)}% overall usage. Collections continue running.`
              }
            </Typography>
          </Box>
        )}

        {/* Top Metric Cards */}
        <Grid container spacing={{ xs: 2, md: 3 }} sx={{ width: "100%", mb: { xs: 3, md: 4 }, ml: 0 }}>

          <Grid item xs={12} sm={6} md={4} sx={{ display: "flex", flexGrow: 1 }}>
            <Card sx={{ ...cardSx, width: "100%",
              minHeight: { xs: "auto", md: "140px" }, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 700, fontSize: { xs: "0.65rem", md: "0.75rem" } }}>
                  SPEND TODAY
                </Typography>
                <Typography sx={{ fontWeight: "bold", color: C.text, fontSize: { xs: "1.6rem", sm: "2rem", md: "2.5rem" }, my: 0.5 }}>
                  {fmt(data?.today_usd)}
                </Typography>
                <Typography variant="caption" sx={{ color: todayChange >= 0 ? "#10b981" : "#ef4444" }}>
                  {data?.today_usd > 0 ? todayChangeLabel : "No spend recorded today"}
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6} md={4} sx={{ display: "flex", flexGrow: 1 }}>
            <Card sx={{ ...cardSx, width: "100%",
              minHeight: { xs: "auto", md: "140px" }, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 700, fontSize: { xs: "0.65rem", md: "0.75rem" } }}>
                  SPEND THIS MONTH
                </Typography>
                <Typography sx={{ fontWeight: "bold", color: C.text, fontSize: { xs: "1.6rem", sm: "2rem", md: "2.5rem" }, my: 0.5 }}>
                  {fmt(data?.month_usd)}
                </Typography>
                <Typography variant="caption" sx={{ color: data?.budget_usd > 0 ? C.textSub : "#64748b" }}>
                  {data?.budget_usd > 0
                    ? `Budget: ${fmt(data.budget_usd)}`
                    : "No budget set — configure in Modifications"}
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6} md={4} sx={{ display: "flex", flexGrow: 1 }}>
            <Card sx={{ bgcolor: C.card,
              border: `1px solid ${budgetUsedPct >= EMAIL_ALERT_THRESHOLD ? budgetColor : C.border}`,
              boxShadow: C.shadow,
              width: "100%", minHeight: { xs: "auto", md: "140px" },
              display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 700, fontSize: { xs: "0.65rem", md: "0.75rem" } }}>
                  OVERALL BUDGET STATUS
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, my: 0.5 }}>
                  <Typography sx={{ fontWeight: "bold", color: C.text, fontSize: { xs: "1.6rem", sm: "2rem", md: "2.5rem" } }}>
                    {Math.min(budgetUsedPct, 100).toFixed(1)}%
                  </Typography>
                  {budgetUsedPct >= HARD_BLOCK_THRESHOLD && <BlockIcon sx={{ color: budgetColor, fontSize: "2rem" }} />}
                  {budgetUsedPct >= EMAIL_ALERT_THRESHOLD && budgetUsedPct < HARD_BLOCK_THRESHOLD && <WarningAmberIcon sx={{ color: budgetColor, fontSize: "2rem" }} />}
                  {budgetUsedPct > 0 && budgetUsedPct < EMAIL_ALERT_THRESHOLD && <CheckCircleIcon sx={{ color: "#10b981", fontSize: "1.8rem" }} />}
                </Box>
                <Typography variant="caption" sx={{ color: C.textSub }}>
                  {data?.budget_usd > 0
                    ? `${fmt(data.month_usd)} / ${fmt(data.budget_usd)} monthly limit`
                    : "Click 'Modifications' to set your budget"}
                </Typography>
                {data?.budget_usd > 0 && (
                  <>
                    <LinearProgress variant="determinate" value={Math.min(budgetUsedPct, 100)}
                      sx={{ mt: 1.5, height: 6, borderRadius: 3, bgcolor: C.border,
                        "& .MuiLinearProgress-bar": { bgcolor: budgetColor } }} />
                    <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.5 }}>
                      <Typography variant="caption" sx={{ color: C.textMuted, fontSize: "0.65rem" }}>
                        📧 Alert at {DISPLAY_EMAIL_THRESHOLD}%
                      </Typography>
                      <Typography variant="caption" sx={{ color: C.textMuted, fontSize: "0.65rem" }}>
                        🚫 Block at {DISPLAY_HARD_THRESHOLD}%
                      </Typography>
                    </Box>
                  </>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Bottom Cards */}
        <Grid container spacing={{ xs: 2, md: 3 }} sx={{ width: "100%", ml: 0 }}>

          {/* Per-scraper budget status */}
          <Grid item xs={12} md={6} sx={{ display: "flex", flexGrow: 1 }}>
            <Card sx={{ ...cardSx, width: "100%", p: 1 }}>
              <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                <Typography sx={{ color: C.text, fontWeight: 600, mb: 1, fontSize: { xs: "1rem", md: "1.1rem" } }}>
                  Per-Source Budget
                </Typography>
                <Typography variant="caption" sx={{ color: C.textSub, display: "block", mb: 3 }}>
                  Month-to-date spend vs. individual source allocation
                </Typography>

                {Object.keys(scraperBudgets).length === 0 ? (
                  <Box sx={{ py: 3, textAlign: "center" }}>
                    <Typography variant="body2" sx={{ color: C.textSub }}>
                      No per-source budgets set yet.
                    </Typography>
                    <Typography variant="caption" sx={{ color: C.textMuted }}>
                      Open Modifications to allocate budgets per source.
                    </Typography>
                  </Box>
                ) : (
                  <Stack spacing={2.5}>
                    {SCRAPER_KEYS.map((key) => {
                      const info      = scraperBudgets[key];
                      const allocUsd  = allocations[key] ?? info?.budget_usd ?? 0;
                      const spentUsd  = info?.spent_usd ?? 0;
                      const pct       = allocUsd > 0 ? Math.min((spentUsd / allocUsd) * 100, 100) : 0;
                      const isBlocked = info?.is_blocked ?? false;
                      const isWarning = info?.is_warning ?? false;
                      const barColor  = isBlocked ? "#ef4444" : isWarning ? "#f97316" : "#3b82f6";

                      return (
                        <Box key={key}>
                          <Box sx={{ display: "flex", justifyContent: "space-between",
                            alignItems: "center", mb: 0.8, flexWrap: "wrap", gap: 0.5 }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              <Typography variant="body2" sx={{ color: C.text, fontWeight: 600 }}>
                                {SCRAPER_LABELS[key]}
                              </Typography>
                              {isBlocked && (
                                <Chip label="BLOCKED" size="small"
                                  sx={{ bgcolor: "#ef444420", color: "#ef4444", fontSize: "0.6rem", height: 18 }} />
                              )}
                              {!isBlocked && isWarning && (
                                <Chip label="WARNING" size="small"
                                  sx={{ bgcolor: "#f9731620", color: "#f97316", fontSize: "0.6rem", height: 18 }} />
                              )}
                            </Box>
                            <Typography variant="caption" sx={{ color: C.textSub }}>
                              {fmt(spentUsd)} / {allocUsd > 0 ? fmt(allocUsd) : "—"}
                              {allocUsd > 0 && (
                                <span style={{ color: barColor, marginLeft: 6 }}>
                                  ({pct.toFixed(1)}%)
                                </span>
                              )}
                            </Typography>
                          </Box>
                          <LinearProgress variant="determinate"
                            value={allocUsd > 0 ? pct : 0}
                            sx={{ height: 7, borderRadius: 4, bgcolor: C.border,
                              "& .MuiLinearProgress-bar": { bgcolor: barColor } }} />
                        </Box>
                      );
                    })}
                  </Stack>
                )}

                <Box sx={{ mt: 3, p: 1.5, bgcolor: C.cardInner, borderRadius: 2, border: `1px solid ${C.border}` }}>
                  <Typography variant="caption" sx={{ color: C.textMuted }}>
                    ℹ️ At <strong style={{ color: "#fde68a" }}>80%</strong> of source budget — warning email sent.
                    At <strong style={{ color: "#fca5a5" }}>100%</strong> — that source is blocked.
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* High-Cost Operations */}
          <Grid item xs={12} md={6} sx={{ display: "flex", flexGrow: 1 }}>
            <Card sx={{ ...cardSx, width: "100%", p: 1, display: "flex", flexDirection: "column" }}>
              <CardContent sx={{ p: { xs: 2, md: 3 }, display: "flex", flexDirection: "column", flex: 1 }}>
                <Typography sx={{ color: C.text, fontWeight: 600, mb: 1, fontSize: { xs: "1rem", md: "1.1rem" } }}>
                  High-Cost Operations
                </Typography>
                <Typography variant="caption" sx={{ color: C.textSub, display: "block", mb: 2 }}>
                  Recent jobs costing $5.00+
                </Typography>
                {(!data?.recent_high_cost || data.recent_high_cost.length === 0) ? (
                  <Box sx={{ py: 4, textAlign: "center" }}>
                    <Typography variant="body2" sx={{ color: C.textSub }}>No high-cost operations yet.</Typography>
                    <Typography variant="caption" sx={{ color: C.textMuted }}>Operations costing $5+ will appear here.</Typography>
                  </Box>
                ) : (
                  <Box sx={{
                    flex: 1, overflowY: "auto",
                    pr: 1,
                    "&::-webkit-scrollbar": { width: 4 },
                    "&::-webkit-scrollbar-track": { bgcolor: "transparent" },
                    "&::-webkit-scrollbar-thumb": { bgcolor: C.border, borderRadius: 2 },
                  }}>
                    {data.recent_high_cost.map((row, i) => (
                      <Box key={i} sx={{
                        display: "flex", alignItems: "center", gap: 2,
                        py: 1,
                        borderBottom: i < data.recent_high_cost.length - 1
                          ? `1px solid ${C.border}` : "none",
                      }}>
                        {/* Icon dot */}
                        <Box sx={{
                          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                          bgcolor: "#f97316", mt: 0.3,
                        }} />

                        {/* Main info */}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ color: C.text, fontWeight: 600, fontSize: "0.88rem", lineHeight: 1.3 }}>
                            {SCRAPER_LABELS[row.scraper] || row.service || "Unknown"}
                          </Typography>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <Typography variant="caption" sx={{ color: C.textMuted }}>
                              {timeAgo(row.called_at)}
                            </Typography>
                            {row.items > 0 && (
                              <Typography variant="caption" sx={{ color: C.textMuted }}>
                                · {row.items.toLocaleString()} items
                              </Typography>
                            )}
                            {row.is_estimated && (
                              <Typography variant="caption" sx={{ color: "#f59e0b" }}>
                                · ~estimated
                              </Typography>
                            )}
                          </Stack>
                          {row.job_id && (
                            <Typography variant="caption" sx={{
                              color: C.textMuted, fontFamily: "monospace",
                              fontSize: "0.68rem", letterSpacing: 0.3,
                            }}>
                              {String(row.job_id).slice(0, 12)}…
                            </Typography>
                          )}
                        </Box>

                        {/* Cost */}
                        <Typography sx={{
                          color: "#f97316", fontWeight: 700,
                          fontSize: "1rem", flexShrink: 0,
                        }}>
                          {fmt(row.cost_usd)}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>


        </Grid>
      </Box>

      {/* ── Modifications Modal ─────────────────────────────────────────────── */}
      <Dialog open={modsModal} onClose={() => setModsModal(false)} maxWidth="sm" fullWidth
        PaperProps={{ sx: { bgcolor: C.card, border: `1px solid ${C.border}`, borderRadius: 3 } }}>
        <DialogTitle sx={{ color: C.text, fontWeight: 700, display: "flex",
          justifyContent: "space-between", alignItems: "center", pb: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <TuneIcon sx={{ color: "#3b82f6" }} />
            Modifications
          </Box>
          <IconButton onClick={() => setModsModal(false)} size="small" sx={{ color: C.textMuted }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ pt: 1 }}>

          <Typography variant="caption" sx={{ color: "#3b82f6", fontWeight: 700, letterSpacing: 1, display: "block", mb: 1.5 }}>
            OVERALL MONTHLY BUDGET
          </Typography>
          <TextField
            fullWidth label="Monthly Budget (USD)" type="number"
            value={budgetInput}
            onChange={(e) => {
              const val = parseFloat(e.target.value) || 0;
              setBudgetInput(val);
              const total = Object.values(allocations).reduce((s, v) => s + (parseFloat(v) || 0), 0);
              if (total > val + 0.01) {
                setAllocError(`Total allocation ${fmt(total)} exceeds the new overall budget ${fmt(val)}.`);
              } else {
                setAllocError("");
              }
            }}
            inputProps={{ min: 1, step: 10 }}
            sx={{ mb: 2,
              "& .MuiOutlinedInput-root": { color: C.text, bgcolor: C.inputBg,
                "& fieldset": { borderColor: C.border },
                "&:hover fieldset": { borderColor: "#3b82f6" },
                "&.Mui-focused fieldset": { borderColor: "#3b82f6" } },
              "& .MuiInputBase-input": { color: C.text } }}
            InputLabelProps={{ style: { color: C.textSub } }}
            InputProps={{ startAdornment: <Typography sx={{ color: C.textMuted, mr: 0.5 }}>$</Typography> }}
          />

          <Box sx={{ mb: 3, p: 2, bgcolor: C.cardInner, borderRadius: 2, border: `1px solid ${C.border}` }}>
            <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 700, display: "block", mb: 1 }}>
              AUTOMATIC THRESHOLDS
            </Typography>
            <Stack spacing={0.8}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <EmailIcon sx={{ color: "#f59e0b", fontSize: 16 }} />
                <Typography variant="caption" sx={{ color: C.textSub }}>
                  <strong style={{ color: "#fde68a" }}>80% used</strong> — Alert email sent. Collections keep running.
                  {budgetInput > 0 && <span style={{ color: C.textMuted }}> (triggers at {fmt(budgetInput * 0.77)})</span>}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <BlockIcon sx={{ color: "#ef4444", fontSize: 16 }} />
                <Typography variant="caption" sx={{ color: C.textSub }}>
                  <strong style={{ color: "#fca5a5" }}>100% used</strong> — All collections permanently blocked.
                  {budgetInput > 0 && <span style={{ color: C.textMuted }}> (triggers at {fmt(budgetInput * 0.97)})</span>}
                </Typography>
              </Box>
            </Stack>
          </Box>

          <Divider sx={{ bgcolor: C.border, mb: 3 }} />

          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
            <Typography variant="caption" sx={{ color: "#3b82f6", fontWeight: 700, letterSpacing: 1 }}>
              BUDGET PER SOURCE
            </Typography>
            <Button size="small" onClick={redistributeEvenly}
              sx={{ color: C.textMuted, fontSize: "0.7rem", textTransform: "none", p: 0.5 }}>
              Split evenly
            </Button>
          </Box>

          {allocError && (
            <Alert severity="error" sx={{ mb: 2, bgcolor: "#7f1d1d30", color: "#fca5a5",
              border: "1px solid #dc2626", fontSize: "0.78rem",
              "& .MuiAlert-icon": { color: "#ef4444" } }}>
              {allocError}
            </Alert>
          )}

          <Typography variant="caption" sx={{ color: C.textMuted, display: "block", mb: 2 }}>
            Total allocated: {fmt(totalAllocated)} / {fmt(budgetInput)}
            {isOverBudget && (
              <span style={{ color: "#ef4444", marginLeft: 8, fontWeight: 700 }}>
                ▲ Over by {fmt(totalAllocated - budgetInput)}
              </span>
            )}
          </Typography>

          <Stack spacing={1.5} sx={{ mb: 1 }}>
            {SCRAPER_KEYS.map((key) => {
              const allocVal    = allocations[key] ?? 0;
              const pctOfTotal  = budgetInput > 0 ? Math.min((allocVal / budgetInput) * 100, 100) : 0;
              const info        = scraperBudgets[key];
              const spentPct    = info?.pct ?? 0;
              const spentUsd    = info?.spent_usd ?? 0;
              const noBudget    = info?.no_budget !== false && allocVal <= 0;
              const belowSpend  = allocVal > 0 && allocVal < spentUsd;
              const fieldError  = belowSpend;
              const barColor    = info?.is_blocked ? "#ef4444" : info?.is_warning ? "#f97316" : "#3b82f6";

              return (
                <Box key={key}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: belowSpend ? 0.2 : 0.5 }}>
                    <Typography variant="body2" sx={{ color: noBudget ? "#ef4444" : C.text, width: 120, flexShrink: 0, fontSize: "0.8rem", fontWeight: noBudget ? 700 : 400 }}>
                      {SCRAPER_LABELS[key]}
                      {noBudget && <Typography component="span" sx={{ color: "#ef4444", fontSize: "0.6rem", ml: 0.5 }}>NO BUDGET</Typography>}
                    </Typography>
                    <TextField
                      size="small" type="number"
                      value={allocVal}
                      onChange={(e) => handleAllocChange(key, e.target.value)}
                      inputProps={{ min: 0, step: 1 }}
                      error={fieldError}
                      sx={{ width: 110, flexShrink: 0,
                        "& .MuiOutlinedInput-root": { color: C.text, bgcolor: C.inputBg,
                          "& fieldset": { borderColor: fieldError ? "#ef4444" : isOverBudget ? "#ef4444" : C.border },
                          "&:hover fieldset": { borderColor: fieldError ? "#ef4444" : "#3b82f6" },
                          "&.Mui-focused fieldset": { borderColor: fieldError ? "#ef4444" : "#3b82f6" } },
                        "& .MuiInputBase-input": { color: C.text, fontSize: "0.8rem" } }}
                      InputProps={{ startAdornment: <Typography sx={{ color: C.textMuted, mr: 0.3, fontSize: "0.8rem" }}>$</Typography> }}
                    />
                    <Box sx={{ flex: 1 }}>
                      <LinearProgress variant="determinate" value={pctOfTotal}
                        sx={{ height: 5, borderRadius: 3, bgcolor: C.border, mb: 0.4,
                          "& .MuiLinearProgress-bar": { bgcolor: "#3b82f640" } }} />
                      {info && (
                        <LinearProgress variant="determinate" value={Math.min(spentPct, 100)}
                          sx={{ height: 5, borderRadius: 3, bgcolor: C.border,
                            "& .MuiLinearProgress-bar": { bgcolor: barColor } }} />
                      )}
                    </Box>
                    <Box sx={{ width: 52, textAlign: "right", flexShrink: 0 }}>
                      <Typography variant="caption" sx={{ color: C.textMuted, fontSize: "0.68rem", display: "block" }}>
                        {pctOfTotal.toFixed(0)}% of total
                      </Typography>
                      {info && (
                        <Typography variant="caption" sx={{ color: barColor, fontSize: "0.68rem", display: "block" }}>
                          {spentPct.toFixed(0)}% spent
                        </Typography>
                      )}
                    </Box>
                  </Box>
                  {belowSpend && (
                    <Typography sx={{ color: "#ef4444", fontSize: "0.68rem", ml: "130px", mb: 0.5 }}>
                      Min ${spentUsd.toFixed(4)} (already spent this month)
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Stack>

          <Box sx={{ mb: 3, p: 1.5, bgcolor: C.cardInner, borderRadius: 2, border: `1px solid ${C.border}` }}>
            <Typography variant="caption" sx={{ color: C.textMuted }}>
              ℹ️ Sources with <strong style={{ color: "#ef4444" }}>$0 allocation are blocked</strong> and cannot run.
              Each allocated source warns at 77% and hard-blocks at 97% independently of the overall budget.
              Budget cannot be set below current month spend.
            </Typography>
          </Box>

          <Divider sx={{ bgcolor: C.border, mb: 3 }} />

          {/* Alert Emails */}
          <Typography variant="caption" sx={{ color: "#3b82f6", fontWeight: 700, letterSpacing: 1, display: "block", mb: 1.5 }}>
            ALERT EMAILS
          </Typography>
          <Typography variant="caption" sx={{ color: C.textSub, display: "block", mb: 2 }}>
            These addresses receive emails when overall budget hits 80% (warning) or 100% (blocked).
          </Typography>

          <Box sx={{ display: "flex", gap: 1, mb: 1.5 }}>
            <TextField
              size="small"
              fullWidth
              placeholder="name@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } }}
              sx={{
                "& .MuiOutlinedInput-root": {
                  color: C.text, bgcolor: C.inputBg,
                  "& fieldset": { borderColor: C.border },
                  "&:hover fieldset": { borderColor: "#3b82f6" },
                  "&.Mui-focused fieldset": { borderColor: "#3b82f6" },
                },
                "& .MuiInputBase-input": { color: C.text },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <EmailIcon sx={{ color: C.textMuted, fontSize: 18 }} />
                  </InputAdornment>
                ),
              }}
            />
            <Button
              variant="outlined"
              onClick={addEmail}
              disabled={!emailInput.trim() || !emailInput.includes("@")}
              sx={{ borderColor: "#3b82f6", color: "#3b82f6", textTransform: "none", whiteSpace: "nowrap",
                "&:hover": { bgcolor: "#3b82f610", borderColor: "#60a5fa" } }}
            >
              Add
            </Button>
          </Box>

          {emails.length === 0 ? (
            <Box sx={{ py: 1.5, px: 2, bgcolor: C.cardInner, borderRadius: 2, border: `1px solid ${C.border}`, mb: 2 }}>
              <Typography variant="caption" sx={{ color: C.textMuted }}>
                No alert emails configured. Add at least one to receive budget notifications.
              </Typography>
            </Box>
          ) : (
            <Stack spacing={0.8} sx={{ mb: 2 }}>
              {emails.map((email) => (
                <Box key={email} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                  px: 1.5, py: 0.8, bgcolor: C.cardInner, borderRadius: 1.5, border: `1px solid ${C.border}` }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <EmailIcon sx={{ color: "#f59e0b", fontSize: 16 }} />
                    <Typography variant="body2" sx={{ color: C.text, fontSize: "0.82rem" }}>{email}</Typography>
                  </Box>
                  <IconButton size="small" onClick={() => removeEmail(email)} sx={{ color: C.textMuted,
                    "&:hover": { color: "#ef4444" } }}>
                    <CloseIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              ))}
            </Stack>
          )}

          <Box sx={{ p: 1.5, bgcolor: C.cardInner, borderRadius: 2, border: `1px solid ${C.border}` }}>
            <Typography variant="caption" sx={{ color: C.textMuted }}>
              ℹ️ SMTP credentials must be set in your <strong style={{ color: C.text }}>.env</strong> file:
              <code style={{ color: "#93c5fd", display: "block", marginTop: 4, fontSize: "0.72rem" }}>
                ALERT_SMTP_HOST · ALERT_SMTP_PORT · ALERT_SMTP_USER · ALERT_SMTP_PASS
              </code>
            </Typography>
          </Box>

        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={() => setModsModal(false)} sx={{ color: C.textMuted, textTransform: "none" }}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave}
            disabled={saving || budgetInput <= 0 || isOverBudget || hasBelowSpend}
            startIcon={saving ? <CircularProgress size={14} sx={{ color: "white" }} /> : <AttachMoneyIcon />}
            sx={{ bgcolor: (isOverBudget || hasBelowSpend) ? "#374151" : "#3b82f6", textTransform: "none",
              "&:hover": { bgcolor: (isOverBudget || hasBelowSpend) ? "#374151" : "#2563eb" } }}>
            {saving ? "Saving…" : isOverBudget ? "Over Budget — Adjust First" : hasBelowSpend ? "Below Spend — Adjust First" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Toast */}
      <Snackbar open={toast.open} autoHideDuration={5000}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        <Alert severity={toast.severity} onClose={() => setToast((t) => ({ ...t, open: false }))}
          sx={{ bgcolor: C.hover, color: C.text, "& .MuiAlert-icon": { color: "inherit" } }}>
          {toast.msg}
        </Alert>
      </Snackbar>
    </>
  );
};

export default CostGovernance;
