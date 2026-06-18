import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api";
import {
  Box, Card, CardContent, Typography, Grid,
  Stack, CircularProgress, Tooltip, useMediaQuery, useTheme,
} from "@mui/material";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartTooltip, ResponsiveContainer, Cell,
} from "recharts";
import TrendingUpIcon          from "@mui/icons-material/Timeline";
import StorageIcon             from "@mui/icons-material/Storage";
import WarningAmberIcon        from "@mui/icons-material/WarningAmber";
import AutoAwesomeIcon         from "@mui/icons-material/AutoAwesome";
import CheckCircleIcon         from "@mui/icons-material/CheckCircle";
import ErrorIcon               from "@mui/icons-material/Error";
import HourglassEmptyIcon      from "@mui/icons-material/HourglassEmpty";
import BoltIcon                from "@mui/icons-material/Bolt";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import { useAppTheme }    from "../AppThemeContext";
import { useBudget }      from "../BudgetContext";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

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

const ALL_SCRAPERS = [
  "reddit", "edugeek", "stackexchange",
  "autodesk", "twitter", "google_news", "spiceworks", "quora", "facebook",
];

function friendlyError(raw) {
  if (!raw) return "";
  const s = raw.toLowerCase();
  if (s.includes("503") || s.includes("service unavailable"))
    return "Data provider temporarily unavailable — try again later.";
  if (s.includes("502") || s.includes("bad gateway"))
    return "Data provider gateway error — try again later.";
  if (s.includes("504") || s.includes("gateway timeout"))
    return "Request timed out — the service is slow, try again.";
  if (s.includes("500") || s.includes("internal server error"))
    return "Data provider had an internal error — try again later.";
  if (s.includes("401") || s.includes("unauthorized") || s.includes("invalid api key"))
    return "Invalid API key — check your credentials in settings.";
  if (s.includes("402") || s.includes("payment required") || s.includes("out of credits") || s.includes("credits exhausted"))
    return "API credits exhausted — top up your account.";
  if (s.includes("429") || s.includes("too many requests") || s.includes("rate limit"))
    return "Rate limited — too many requests. Wait a few minutes and retry.";
  if (s.includes("403") || s.includes("forbidden"))
    return "Access denied — your API key may lack the required permissions.";
  if (s.includes("404") || s.includes("not found"))
    return "Resource not found — the API endpoint may have changed.";
  if (s.includes("api key") && s.includes("not set"))
    return "API key not configured — add it to your .env file.";
  if (s.includes("connectionerror") || (s.includes("connection") && s.includes("refused")))
    return "Connection failed — check your network or service status.";
  if (s.includes("timeout") || s.includes("timed out"))
    return "Request timed out — the service may be overloaded.";
  if (s.includes("ssl") || s.includes("certificate"))
    return "SSL/certificate error — check your network security settings.";
  return "An error occurred — hover for technical details.";
}

function timeAgo(isoString) {
  if (!isoString) return "—";
  const diff = Math.floor((Date.now() - new Date(isoString)) / 1000);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function statusMeta(status) {
  switch (status) {
    case "completed": return { color: "#10b981", icon: <CheckCircleIcon    sx={{ fontSize: 20, color: "#10b981" }} /> };
    case "running":   return { color: "#3b82f6", icon: <BoltIcon           sx={{ fontSize: 20, color: "#3b82f6" }} /> };
    case "queued":    return { color: "#f59e0b", icon: <HourglassEmptyIcon sx={{ fontSize: 20, color: "#f59e0b" }} /> };
    case "failed":    return { color: "#ef4444", icon: <ErrorIcon          sx={{ fontSize: 20, color: "#ef4444" }} /> };
    default:          return { color: "#64748b", icon: <StorageIcon        sx={{ fontSize: 20, color: "#64748b" }} /> };
  }
}

const STORAGE_KEY = "scraper_cards_v3";

function readEnabledFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw);
    const result = {};
    for (const key of Object.keys(saved)) {
      result[key] = saved[key]?.enabled !== false;
    }
    return result;
  } catch {
    return {};
  }
}

const Dashboard = () => {
  const { C }          = useAppTheme();
  const { isHardBlocked } = useBudget();
  const theme   = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const kwMaxChars = isMobile ? 10 : 20;

  const [scraperStatus, setScraperStatus] = useState({});
  const [scraperBlocks, setScraperBlocks] = useState({});
  const [tasks,         setTasks]         = useState([]);
  const [stats24h,      setStats24h]      = useState({ total_items: 0, change_7d_pct: null });
  const [pendingJobs,   setPendingJobs]   = useState(0);
  const [llmSpending,   setLlmSpending]   = useState(null);
  const [spendData,     setSpendData]     = useState(null);
  const [monthlyStats,  setMonthlyStats]  = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [now,           setNow]           = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, tasksRes, statsRes, pendingRes, llmRes, blocksRes, spendRes, monthlyRes] = await Promise.allSettled([
        apiFetch(`${API_BASE}/api/status`),
        apiFetch(`${API_BASE}/api/tasks`),
        apiFetch(`${API_BASE}/api/stats/24h`),
        apiFetch(`${API_BASE}/api/newsletter/pending`),
        apiFetch(`${API_BASE}/api/llm/spending`),
        apiFetch(`${API_BASE}/api/spending/scraper-status`),
        apiFetch(`${API_BASE}/api/spending/summary`),
        apiFetch(`${API_BASE}/api/stats/monthly`),
      ]);

      if (statusRes.status === "fulfilled" && statusRes.value.ok)
        setScraperStatus(await statusRes.value.json());

      if (blocksRes.status === "fulfilled" && blocksRes.value.ok) {
        const bd = await blocksRes.value.json();
        setScraperBlocks(bd.scrapers || {});
      }

      if (tasksRes.status === "fulfilled" && tasksRes.value.ok) {
        const t = await tasksRes.value.json();
        setTasks(
          [...(t.tasks || [])]
            .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
            .slice(0, 5)
        );
      }

      if (statsRes.status === "fulfilled" && statsRes.value.ok)
        setStats24h(await statsRes.value.json());

      if (pendingRes.status === "fulfilled" && pendingRes.value.ok) {
        const p = await pendingRes.value.json();
        setPendingJobs((p.jobs || []).length);
      }

      if (llmRes.status === "fulfilled" && llmRes.value.ok)
        setLlmSpending(await llmRes.value.json());

      if (spendRes.status === "fulfilled" && spendRes.value.ok)
        setSpendData(await spendRes.value.json());

      if (monthlyRes.status === "fulfilled" && monthlyRes.value.ok) {
        const m = await monthlyRes.value.json();
        setMonthlyStats(m.months || []);
      }

    } catch (_) {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [fetchData]);

  const runningCount  = ALL_SCRAPERS.filter((key) => scraperStatus[key]?.running).length;

  const enabledMap   = readEnabledFromStorage();
  const activeCount  = ALL_SCRAPERS.filter((key) => {
    const isEnabled  = enabledMap[key] !== false;
    const isBlocked  = isHardBlocked || scraperBlocks[key]?.is_blocked === true;
    return isEnabled && !isBlocked;
  }).length;
  const disabledCount = ALL_SCRAPERS.filter((key) => enabledMap[key] === false).length;
  const blockedCount  = ALL_SCRAPERS.filter((key) =>
    enabledMap[key] !== false && (isHardBlocked || scraperBlocks[key]?.is_blocked === true)
  ).length;

  const change7d    = stats24h.change_7d_pct;
  const changeLabel = change7d === null
    ? "vs 7d avg: no data yet"
    : change7d >= 0 ? `↑ +${change7d}% vs 7d avg` : `↓ ${change7d}% vs 7d avg`;
  const changeColor = change7d === null ? "#64748b" : change7d >= 0 ? "#10b981" : "#ef4444";

  const llmCallCount   = llmSpending?.by_provider?.reduce((s, r) => s + (r.call_count   || 0), 0) || 0;
  const llmTotalTokens = llmSpending?.by_provider?.reduce((s, r) => s + (r.total_tokens || 0), 0) || 0;
  const llmMonthUsd    = llmSpending?.total_month_usd || 0;

  const fmtTokens = (n) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  };

  const fmtUsd = (n) => {
    if (typeof n !== "number") return "$0.00";
    const decimals = n > 0 && n < 0.01 ? 4 : 2;
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  };

  const metrics = [
    {
      label:    "ACTIVE COLLECTORS",
      value:    loading ? "…" : `${activeCount}/${ALL_SCRAPERS.length}`,
      icon:     StorageIcon,
      color:    activeCount < ALL_SCRAPERS.length ? "#f59e0b" : "#10b981",
      iconBg:   activeCount < ALL_SCRAPERS.length ? "rgba(245,158,11,0.1)" : "rgba(16,185,129,0.1)",
      sub:      runningCount > 0
        ? `● ${runningCount} currently running`
        : blockedCount > 0
          ? `● ${blockedCount} budget-blocked`
          : disabledCount > 0
            ? `● ${disabledCount} disabled`
            : "● All configured",
      subColor: runningCount > 0 ? "#3b82f6" : blockedCount > 0 ? "#ef4444" : disabledCount > 0 ? "#f59e0b" : "#10b981",
    },
    {
      label:    "ITEMS COLLECTED (24H)",
      value:    loading ? "…" : (stats24h.total_items || 0).toLocaleString(),
      icon:     TrendingUpIcon,
      color:    "#3b82f6",
      iconBg:   "rgba(59,130,246,0.1)",
      sub:      changeLabel,
      subColor: changeColor,
    },
    {
      label:    "PENDING APPROVALS",
      value:    loading ? "…" : String(pendingJobs),
      icon:     WarningAmberIcon,
      color:    pendingJobs > 0 ? "#f97316" : "#64748b",
      iconBg:   pendingJobs > 0 ? "rgba(249,115,22,0.1)" : "rgba(100,116,139,0.1)",
      sub:      pendingJobs > 0 ? "Newsletters awaiting review" : "No pending approvals",
      subColor: pendingJobs > 0 ? "#f97316" : "#64748b",
    },
    {
      label:    "SPEND THIS MONTH",
      value:    loading ? "…" : fmtUsd(spendData?.month_usd || 0),
      icon:     AccountBalanceWalletIcon,
      color:    "#10b981",
      iconBg:   "rgba(16,185,129,0.1)",
      sub:      spendData?.budget_usd > 0
        ? `Budget: $${spendData.budget_usd.toFixed(2)}`
        : "No budget set",
      subColor: spendData?.budget_usd > 0 ? "#10b981" : "#64748b",
    },
  ];

  const BAR_COLOR  = "#3b82f6";
  const maxMonthly = Math.max(...monthlyStats.map((m) => m.total), 1);

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload || {};
    const scrapers = Object.entries(d).filter(
      ([k]) => !["month", "label", "total"].includes(k)
    );
    return (
      <Box sx={{
        bgcolor: "#111827", border: "1px solid #1e293b",
        borderRadius: 2, p: 1.5, minWidth: 160,
      }}>
        <Typography sx={{ color: "#94a3b8", fontSize: "0.72rem", mb: 0.5 }}>{label}</Typography>
        <Typography sx={{ color: "#fff", fontWeight: 700, fontSize: "0.9rem", mb: 0.5 }}>
          {(d.total || 0).toLocaleString()} total
        </Typography>
        {scrapers.map(([k, v]) => (
          <Typography key={k} sx={{ color: "#64748b", fontSize: "0.7rem" }}>
            {SCRAPER_LABELS[k] || k}: {Number(v).toLocaleString()}
          </Typography>
        ))}
      </Box>
    );
  };

  const cardSx = {
    bgcolor:     C.card,
    border:      `1px solid ${C.border}`,
    borderRadius: 3,
    boxShadow:   C.shadow,
    width: "100%",
    display: "flex",
    flexDirection: "column",
  };

  return (
    <Box sx={{ width: "100%", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <Box sx={{ mb: { xs: 3, md: 4 } }}>
        <Typography sx={{
          fontWeight: "bold", color: C.text,
          fontSize: { xs: "1.2rem", sm: "1.4rem", md: "1.5rem" },
        }}>
          Operations Dashboard
        </Typography>
        <Typography variant="body2" sx={{ color: C.textMuted, fontSize: { xs: "0.75rem", md: "0.875rem" } }}>
          SYS_TIME: {now.toISOString().replace("T", " ").slice(0, 19)}Z
        </Typography>
      </Box>

      {/* Metric Cards */}
      <Grid container spacing={{ xs: 2, md: 3 }} sx={{ width: "100%", mb: { xs: 3, md: 4 }, mx: 0 }}>
        {metrics.map((metric, idx) => {
          const Icon = metric.icon;
          return (
            <Grid item xs={12} sm={6} md={3} key={idx} sx={{ display: "flex", flexGrow: 1 }}>
              <Card sx={cardSx}>
                <CardContent sx={{ p: { xs: 2, md: 3 }, flexGrow: 1 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
                    <Typography variant="caption" sx={{
                      color: C.textMuted, fontWeight: 700, letterSpacing: "1px",
                      fontSize: { xs: "0.65rem", md: "0.75rem" },
                    }}>
                      {metric.label}
                    </Typography>
                    <Box sx={{ p: 1, borderRadius: 2, bgcolor: metric.iconBg, display: "flex" }}>
                      <Icon sx={{ color: metric.color, fontSize: { xs: 20, md: 24 } }} />
                    </Box>
                  </Stack>

                  <Typography sx={{
                    fontWeight: 800, mb: 1, color: C.text,
                    fontSize: { xs: "1.8rem", sm: "2rem", md: "2.5rem" },
                    lineHeight: 1.1,
                  }}>
                    {metric.value}
                  </Typography>

                  <Typography variant="caption" sx={{ color: metric.subColor, fontWeight: 600 }}>
                    {metric.sub}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {/* Bottom Cards */}
      <Grid container spacing={{ xs: 2, md: 3 }} sx={{ width: "100%", mx: 0 }}>

        {/* System Activity */}
        <Grid item xs={12} md={6} sx={{ display: "flex", flexGrow: 1 }}>
          <Card sx={{ ...cardSx, height: "100%" }}>
            <CardContent sx={{ p: { xs: 2, md: 4 } }}>
              <Typography sx={{ mb: 1, fontWeight: 700, color: C.text, fontSize: { xs: "1rem", md: "1.25rem" } }}>
                System Activity
              </Typography>
              <Typography variant="caption" sx={{ color: C.textMuted, display: "block", mb: 3 }}>
                Last 5 operations
              </Typography>

              {tasks.length === 0 ? (
                <Box sx={{ py: 4, textAlign: "center" }}>
                  <Typography variant="body2" sx={{ color: C.textSub }}>
                    No tasks yet — start a collection to see activity here.
                  </Typography>
                </Box>
              ) : (
                <Stack spacing={0}>
                  {tasks.map((task) => {
                    const meta = statusMeta(task.status);
                    const totalTaskItems =
                      task.result?.total_posts     ??
                      task.result?.total_tweets    ??
                      task.result?.total_articles  ??
                      task.result?.total_questions ??
                      task.result?.total_items     ?? null;
                    const keyword =
                      task.result?.keyword ||
                      (task.result?.keywords?.length ? task.result.keywords[0] : null);

                    return (
                      <Box key={task.task_id} sx={{
                        py: 2,
                        borderBottom: `1px solid ${C.border}`,
                        display: "flex",
                        alignItems: "center",
                        "&:last-child": { borderBottom: "none" },
                      }}>
                        <Box sx={{ mr: 2 }}>
                          <Box sx={{ p: 1, bgcolor: meta.color + "15", borderRadius: 1.5, display: "flex" }}>
                            {task.status === "running" || task.status === "queued"
                              ? <CircularProgress size={20} sx={{ color: meta.color }} />
                              : meta.icon}
                          </Box>
                        </Box>

                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" sx={{
                            fontWeight: 600, color: C.text,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {SCRAPER_LABELS[task.scraper] || task.scraper}
                            {keyword
                              ? <Tooltip title={keyword.length > kwMaxChars ? keyword : ""} placement="top" arrow>
                                  <span>{` · "${keyword.length > kwMaxChars ? keyword.slice(0, kwMaxChars) + "…" : keyword}"`}</span>
                                </Tooltip>
                              : ""}{" "}—{" "}
                            <span style={{ color: meta.color }}>{task.status}</span>
                          </Typography>
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, overflow: "hidden", flexWrap: "wrap" }}>
                            <Typography variant="caption" sx={{ color: C.textSub, flexShrink: 0 }}>
                              {task.task_id.slice(0, 8)}
                            </Typography>
                            {totalTaskItems !== null && (
                              <Typography variant="caption" sx={{ color: C.textMuted }}>
                                · {totalTaskItems} items
                              </Typography>
                            )}
                            {task.error && (
                              <Tooltip
                                title={task.error}
                                placement="top"
                                arrow
                                componentsProps={{ tooltip: { sx: { maxWidth: 400, fontSize: "0.68rem", fontFamily: "monospace", whiteSpace: "pre-wrap" } } }}
                              >
                                <Typography variant="caption" sx={{ color: "#ef4444", cursor: "help" }}>
                                  · {friendlyError(task.error)}
                                </Typography>
                              </Tooltip>
                            )}
                          </Stack>
                        </Box>

                        <Typography variant="caption" sx={{ color: C.textMuted, pl: 1, textAlign: "right", whiteSpace: "nowrap" }}>
                          {timeAgo(task.finished_at || task.started_at)}
                        </Typography>
                      </Box>
                    );
                  })}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Monthly Collection Volume */}
        <Grid item xs={12} md={6} sx={{ display: "flex", flexGrow: 1 }}>
          <Card sx={{ ...cardSx, height: "100%" }}>
            <CardContent sx={{ p: { xs: 2, md: 4 }, display: "flex", flexDirection: "column", height: "100%" }}>
              <Typography sx={{ fontWeight: 700, color: C.text, fontSize: { xs: "1rem", md: "1.25rem" } }}>
                Monthly Collection Volume
              </Typography>
              <Typography variant="caption" sx={{ color: C.textMuted, display: "block", mb: 2.5 }}>
                Items collected per month — last 12 months
              </Typography>

              {monthlyStats.length === 0 ? (
                <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Typography variant="body2" sx={{ color: C.textSub, textAlign: "center" }}>
                    No data yet — run collections to see monthly volume here.
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ flex: 1, minHeight: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyStats} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                      barCategoryGap="30%">
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: "#64748b", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: "#64748b", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}
                      />
                      <RechartTooltip content={<CustomTooltip />} cursor={{ fill: "rgba(59,130,246,0.06)" }} />
                      <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                        {monthlyStats.map((entry, i) => (
                          <Cell
                            key={i}
                            fill={entry.total === maxMonthly ? "#3b82f6" : "#1e3a5f"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              )}

              {monthlyStats.length > 0 && (
                <Stack direction="row" spacing={3} sx={{ mt: 2, pt: 2, borderTop: `1px solid ${C.border}` }}>
                  <Box>
                    <Typography sx={{ fontSize: "0.68rem", color: C.textMuted, letterSpacing: "0.08em" }}>
                      TOTAL (12M)
                    </Typography>
                    <Typography sx={{ fontWeight: 700, color: C.text, fontSize: "1rem" }}>
                      {monthlyStats.reduce((s, m) => s + m.total, 0).toLocaleString()}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: "0.68rem", color: C.textMuted, letterSpacing: "0.08em" }}>
                      BEST MONTH
                    </Typography>
                    <Typography sx={{ fontWeight: 700, color: "#3b82f6", fontSize: "1rem" }}>
                      {maxMonthly.toLocaleString()}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: "0.68rem", color: C.textMuted, letterSpacing: "0.08em" }}>
                      AVG / MONTH
                    </Typography>
                    <Typography sx={{ fontWeight: 700, color: C.text, fontSize: "1rem" }}>
                      {Math.round(monthlyStats.reduce((s, m) => s + m.total, 0) / monthlyStats.length).toLocaleString()}
                    </Typography>
                  </Box>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

      </Grid>
    </Box>
  );
};

export default Dashboard;
