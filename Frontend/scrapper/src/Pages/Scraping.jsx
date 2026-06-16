import React, { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "../api";
import {
  Box, Card, CardContent, Typography, Button, Switch,
  IconButton, Stack, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Chip, CircularProgress,
  Alert, Snackbar, Tooltip, Tab, Tabs, Divider,
} from "@mui/material";
import PlayArrow          from "@mui/icons-material/PlayArrow";
import Warning            from "@mui/icons-material/Warning";
import CheckCircle        from "@mui/icons-material/CheckCircle";
import RadioButtonChecked from "@mui/icons-material/RadioButtonChecked";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import CloseIcon          from "@mui/icons-material/Close";
import BlockIcon          from "@mui/icons-material/Block";
import CalendarTodayIcon  from "@mui/icons-material/CalendarToday";
import LabelIcon          from "@mui/icons-material/Label";
import HelpOutlineIcon    from "@mui/icons-material/HelpOutline";
import { useBudget }          from "../BudgetContext";
import { useAppTheme }        from "../AppThemeContext";
import { useNotifications }   from "../NotificationContext";

const API_BASE    = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const STORAGE_KEY = "scraper_cards_v3";

// comments/replies are auto-calculated: max_posts × 50
const calcReplies = (posts) => (Number(posts) || 0) * 50;

// ── Scraper definitions — keywords come from the saved pool, not typed in modal ─
const SCRAPER_DEFS = [
  {
    key: "autodesk", name: "Autodesk", endpoint: "/api/run/autodesk", pool: "shared",
    fields: [
      { id: "max_posts", label: "Max Posts", type: "number", default: 20 },
    ],
    buildPayload: (fv, keyword, sinceDate) => ({
      keyword,
      max_posts:     Number(fv.max_posts) || 20,
      max_replies:   calcReplies(fv.max_posts),
      content_types: ["all"],
      ...(sinceDate ? { since_date: sinceDate } : {}),
    }),
  },
  {
    key: "edugeek", name: "EduGeek", endpoint: "/api/run/edugeek", pool: "shared",
    fields: [
      { id: "max_items", label: "Max Items", type: "number", default: 20 },
    ],
    buildPayload: (fv, keyword, sinceDate) => ({
      keyword,
      max_items:   Number(fv.max_items) || 20,
      max_replies: calcReplies(fv.max_items),
      categories:  ["forums"],
      ...(sinceDate ? { since_date: sinceDate } : {}),
    }),
  },
  {
    key: "facebook", name: "Facebook Groups", endpoint: "/api/run/facebook", pool: "shared",
    fields: [
      { id: "max_posts", label: "Max Posts", type: "number", default: 9 },
    ],
    // groupUrl is passed as 4th arg — comes from the per-card groups pool, not a form field
    buildPayload: (fv, keyword, sinceDate, groupUrl) => ({
      keyword,
      group_url:  groupUrl || "",
      max_posts:  Number(fv.max_posts) || 9,
      ...(sinceDate ? { since_date: sinceDate } : {}),
    }),
  },
  {
    key: "google_news", name: "Google News", endpoint: "/api/run/google-news", pool: "google_news",
    fields: [
      { id: "max_results", label: "Max Articles", type: "number", default: 20 },
    ],
    buildPayload: (fv, keyword, sinceDate) => ({
      keywords:    [keyword],
      max_results: Number(fv.max_results) || 20,
      ...(sinceDate ? { since_date: sinceDate } : {}),
    }),
  },
  {
    key: "quora", name: "Quora", endpoint: "/api/run/quora", pool: "shared", noDate: true,
    fields: [
      { id: "max_results", label: "Max Questions", type: "number", default: 20 },
    ],
    buildPayload: (fv, keyword) => ({
      keyword,
      max_results: Number(fv.max_results) || 20,
    }),
  },
  {
    key: "reddit", name: "Reddit", endpoint: "/api/run/reddit", pool: "shared",
    fields: [
      { id: "max_posts", label: "Max Posts", type: "number", default: 20 },
    ],
    buildPayload: (fv, keyword, sinceDate) => ({
      keyword,
      max_posts:    Number(fv.max_posts) || 20,
      max_comments: calcReplies(fv.max_posts),
      ...(sinceDate ? { since_date: sinceDate } : {}),
    }),
  },
  {
    key: "spiceworks", name: "Spiceworks", endpoint: "/api/run/spiceworks", pool: "shared",
    fields: [
      { id: "max_results", label: "Max Results", type: "number", default: 20 },
    ],
    buildPayload: (fv, keyword, sinceDate) => ({
      keyword,
      max_results: Number(fv.max_results) || 20,
      ...(sinceDate ? { since_date: sinceDate } : {}),
    }),
  },
  {
    key: "stackexchange", name: "StackExchange", endpoint: "/api/run/stackexchange", pool: "shared",
    fields: [
      { id: "max_per_site", label: "Max Per Site", type: "number", default: 20 },
    ],
    buildPayload: (fv, keyword, sinceDate) => ({
      keyword,
      sites:        ["stackoverflow"],
      max_per_site: Number(fv.max_per_site) || 20,
      max_answers:  calcReplies(fv.max_per_site),
      ...(sinceDate ? { since_date: sinceDate } : {}),
    }),
  },
  {
    key: "twitter", name: "Twitter / X", endpoint: "/api/run/twitter", pool: "shared",
    fields: [
      { id: "max_tweets", label: "Max Tweets", type: "number", default: 20 },
    ],
    buildPayload: (fv, keyword, sinceDate) => ({
      keywords:   [keyword],
      max_tweets: Number(fv.max_tweets) || 20,
      lang:       "en",
      ...(sinceDate ? { since_date: sinceDate } : {}),
    }),
  },
];

const STATUS_META = {
  idle:      { label: "Idle",    color: "#64748b", bg: "#64748b20" },
  running:   { label: "Running", color: "#3b82f6", bg: "#3b82f620" },
  completed: { label: "Done",    color: "#10b981", bg: "#10b98120" },
  failed:    { label: "Failed",  color: "#ef4444", bg: "#ef444420" },
  queued:    { label: "Queued",  color: "#f59e0b", bg: "#f59e0b20" },
};

const defaultCard = () => ({
  status: "idle", taskId: null, totalItems: null, itemsProcessed: null,
  lastRun: null, error: null, enabled: true,
});

function buildDefault() {
  return Object.fromEntries(SCRAPER_DEFS.map((d) => [d.key, defaultCard()]));
}

function loadCards() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildDefault();
    const saved  = JSON.parse(raw);
    const result = buildDefault();
    for (const key of Object.keys(result)) {
      if (saved[key]) {
        result[key] = {
          ...result[key],
          ...saved[key],
          status: saved[key].status === "queued" ? "idle" : saved[key].status,
        };
      }
    }
    return result;
  } catch {
    return buildDefault();
  }
}

function persist(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

const TODAY = new Date().toISOString().slice(0, 10);

// ══════════════════════════════════════════════════════════════════════════════
const Scraping = () => {
  const { C, isDark } = useAppTheme();
  const [cards,        setCards]        = useState(loadCards);
  const [modal,        setModal]        = useState({ open: false, mode: "single", scraperKey: null });
  const [formValues,   setFormValues]   = useState({});
  const [runDate,      setRunDate]      = useState(null);
  const [submitting,   setSubmitting]   = useState(false);
  const [toast,        setToast]        = useState({ open: false, msg: "", severity: "success" });
  const [hasPending,   setHasPending]   = useState(false);
  const [scraperBlocks,setScraperBlocks]= useState({});
  const [maxItems,     setMaxItems]     = useState(20);

  // Keywords
  const [keywords,    setKeywords]    = useState({ shared: [], google_news: [] });
  const [selectedKws, setSelectedKws] = useState({});

  // Facebook Groups — persisted in DB
  const [fbGroups,    setFbGroups]    = useState([]);
  const [fbGroupsLoading, setFbGroupsLoading] = useState(false);
  const [fbSelIds,    setFbSelIds]    = useState(() => {
    try { return JSON.parse(localStorage.getItem("facebook_sel_groups_v1") || "[]"); }
    catch { return []; }
  });
  const [fbMgmtOpen,  setFbMgmtOpen]  = useState(false);
  const [fbNewName,   setFbNewName]   = useState("");
  const [fbNewUrl,    setFbNewUrl]    = useState("");
  const [fbAddSaving, setFbAddSaving] = useState(false);
  const [kwModal,       setKwModal]       = useState({ open: false, tab: "shared" });
  const [kwInput,       setKwInput]       = useState("");
  const [kwSaving,      setKwSaving]      = useState(false);
  const [modalKwInputs, setModalKwInputs] = useState({ shared: "", google_news: "" });
  const [modalKwSaving, setModalKwSaving] = useState({ shared: false, google_news: false });

  const { isHardBlocked, budgetPct } = useBudget();
  const { addNotification } = useNotifications();

  const cardsRef    = useRef(cards);
  const notifiedRef = useRef(new Set()); // taskIds already notified on completion/failure
  useEffect(() => {
    cardsRef.current = cards;
    persist(cards);
  }, [cards]);

  const showToast = (msg, severity = "success") =>
    setToast({ open: true, msg, severity });

  const updateCard = useCallback((key, patch) => {
    setCards((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  // ── Sync last_run + totalItems from backend on mount ─────────────────────
  useEffect(() => {
    apiFetch(`${API_BASE}/api/status`)
      .then((r) => r.json())
      .then((status) => {
        setCards((prev) => {
          const next = { ...prev };
          for (const [key, s] of Object.entries(status)) {
            if (!next[key]) continue;

            // Fix stuck running/queued state
            if (!s.running &&
                (next[key].status === "running" || next[key].status === "queued")) {
              next[key] = {
                ...next[key],
                status:  s.last_run ? "completed" : "idle",
                lastRun: s.last_run
                  ? new Date(s.last_run).toLocaleString()
                  : next[key].lastRun,
              };
            }

            // Restore lastRun if missing locally
            if (s.last_run && !next[key].lastRun) {
              next[key] = { ...next[key], lastRun: new Date(s.last_run).toLocaleString() };
            }

            // Always restore totalItems from backend (authoritative source)
            if (s.last_total_items != null && next[key].totalItems == null) {
              next[key] = { ...next[key], totalItems: s.last_total_items };
            }
            if (s.last_newsletters_created != null && next[key].itemsProcessed == null) {
              next[key] = { ...next[key], itemsProcessed: s.last_newsletters_created };
            }
          }
          return next;
        });
      })
      .catch(() => {});
  }, []);

  // ── Pending newsletter jobs ───────────────────────────────────────────────
  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res  = await apiFetch(`${API_BASE}/api/newsletter/pending`);
        if (!res.ok) return;
        const data = await res.json();
        setHasPending((data.jobs || []).length > 0);
      } catch (_) {}
    };
    fetch_();
    const id = setInterval(fetch_, 10_000);
    return () => clearInterval(id);
  }, []);

  // ── Per-scraper budget blocks ─────────────────────────────────────────────
  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res  = await apiFetch(`${API_BASE}/api/spending/scraper-status`);
        if (!res.ok) return;
        const data = await res.json();
        setScraperBlocks(data.scrapers || {});
      } catch (_) {}
    };
    fetch_();
    const id = setInterval(fetch_, 15_000);
    return () => clearInterval(id);
  }, []);

  // ── Poll running tasks ────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(async () => {
      const active = Object.entries(cardsRef.current).filter(
        ([, s]) => s.taskId && (s.status === "queued" || s.status === "running")
      );
      if (!active.length) return;
      for (const [key, s] of active) {
        try {
          const res  = await apiFetch(`${API_BASE}/api/tasks/${s.taskId}`);
          if (!res.ok) continue;
          const task = await res.json();
          const patch = { status: task.status };
          if (task.finished_at) patch.lastRun = new Date(task.finished_at).toLocaleString();
          if (task.result) {
            patch.totalItems =
              task.result.total_posts     ??
              task.result.total_tweets    ??
              task.result.total_articles  ??
              task.result.total_questions ??
              task.result.total_items     ??
              cardsRef.current[key].totalItems;
            if (task.result.newsletters_created != null)
              patch.itemsProcessed = task.result.newsletters_created;
          }
          patch.error = task.status === "failed" ? (task.error || "Run failed") : null;
          updateCard(key, patch);

          if (!notifiedRef.current.has(s.taskId)) {
            const name = SCRAPER_DEFS.find((d) => d.key === key)?.name || key;
            if (task.status === "completed") {
              notifiedRef.current.add(s.taskId);
              addNotification({
                title:   `${name} completed`,
                message: patch.totalItems != null
                  ? `${patch.totalItems.toLocaleString()} items extracted successfully`
                  : "Collection completed successfully",
                type: "success",
              });
            } else if (task.status === "failed") {
              notifiedRef.current.add(s.taskId);
              addNotification({
                title:   `${name} failed`,
                message: (task.error || "The collection failed — check logs for details").split("|||")[0],
                type:    "error",
              });
            }
          }
        } catch (_) {}
      }
    }, 3000);
    return () => clearInterval(id);
  }, [updateCard, addNotification]);

  // ── Fetch saved keywords ──────────────────────────────────────────────────
  const fetchKeywords = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/keywords`);
      if (res.ok) setKeywords(await res.json());
    } catch {}
  }, []);

  const fetchSelections = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/keyword-selections`);
      if (res.ok) {
        const data = await res.json();
        setSelectedKws(data.selections || {});
      }
    } catch {}
  }, []);

  useEffect(() => { fetchKeywords(); fetchSelections(); }, [fetchKeywords, fetchSelections]);

  // ── Keyword helpers ───────────────────────────────────────────────────────
  const toggleKeyword = async (scraperKey, kwId) => {
    const isSelected = (selectedKws[scraperKey] || []).includes(kwId);
    // Optimistic update
    setSelectedKws((prev) => {
      const cur  = prev[scraperKey] || [];
      const next = isSelected ? cur.filter((id) => id !== kwId) : [...cur, kwId];
      return { ...prev, [scraperKey]: next };
    });
    try {
      await apiFetch(`${API_BASE}/api/keyword-selections`, {
        method:  isSelected ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ scraper: scraperKey, keyword_id: kwId }),
      });
    } catch {
      // Roll back on failure
      setSelectedKws((prev) => {
        const cur  = prev[scraperKey] || [];
        const next = isSelected ? [...cur, kwId] : cur.filter((id) => id !== kwId);
        return { ...prev, [scraperKey]: next };
      });
    }
  };

  const handleSaveKeywords = async (tab) => {
    const kws = kwInput.split(",").map((k) => k.trim()).filter(Boolean);
    if (!kws.length) return;
    setKwSaving(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/keywords`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ keywords: kws, pool: tab }),
      });
      if (res.ok) {
        await fetchKeywords();
        setKwInput("");
        showToast(`${kws.length} keyword${kws.length !== 1 ? "s" : ""} saved!`);
      }
    } catch {} finally { setKwSaving(false); }
  };

  const handleDeleteKeyword = async (id) => {
    try {
      const allKws = [...keywords.shared, ...keywords.google_news];
      const deleted = allKws.find((k) => k.id === id);
      await apiFetch(`${API_BASE}/api/keywords/${id}`, { method: "DELETE" });
      setKeywords((prev) => ({
        shared:      prev.shared.filter((k) => k.id !== id),
        google_news: prev.google_news.filter((k) => k.id !== id),
      }));
      setSelectedKws((prev) => {
        const updated = {};
        for (const [sk, ids] of Object.entries(prev))
          updated[sk] = ids.filter((kwId) => kwId !== id);
        return updated;
      });
      showToast(`Keyword "${deleted?.keyword || id}" deleted.`, "info");
    } catch {}
  };

  const handleModalAddKeyword = async (pool) => {
    const raw = (modalKwInputs[pool] || "").trim();
    if (!raw) return;
    const kws = raw.split(",").map((k) => k.trim()).filter(Boolean);
    if (!kws.length) return;
    setModalKwSaving((prev) => ({ ...prev, [pool]: true }));
    try {
      const res = await apiFetch(`${API_BASE}/api/keywords`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({ keywords: kws, pool }),
      });
      if (!res.ok) return;
      const kRes   = await apiFetch(`${API_BASE}/api/keywords`);
      if (!kRes.ok) return;
      const updated = await kRes.json();
      setKeywords(updated);
      const poolList  = pool === "google_news" ? updated.google_news : updated.shared;
      const addedObjs = poolList.filter((kw) =>
        kws.some((k) => k.toLowerCase() === kw.keyword.toLowerCase())
      );
      if (modal.mode === "single" && modal.scraperKey) {
        const scraperKey = modal.scraperKey;
        const newIds = addedObjs.map((k) => k.id).filter((id) => !(selectedKws[scraperKey] || []).includes(id));
        setSelectedKws((prev) => {
          const cur = prev[scraperKey] || [];
          return { ...prev, [scraperKey]: [...cur, ...newIds] };
        });
        for (const kwId of newIds) {
          apiFetch(`${API_BASE}/api/keyword-selections`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scraper: scraperKey, keyword_id: kwId }),
          }).catch(() => {});
        }
      } else if (modal.mode === "all") {
        const targets = SCRAPER_DEFS.filter((d) => cards[d.key]?.enabled && d.pool === pool);
        setSelectedKws((prev) => {
          const upd = { ...prev };
          targets.forEach((d) => {
            const cur    = prev[d.key] || [];
            const newIds = addedObjs.map((k) => k.id).filter((id) => !cur.includes(id));
            upd[d.key]   = [...cur, ...newIds];
            for (const kwId of newIds) {
              apiFetch(`${API_BASE}/api/keyword-selections`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ scraper: d.key, keyword_id: kwId }),
              }).catch(() => {});
            }
          });
          return upd;
        });
      }
      setModalKwInputs((prev) => ({ ...prev, [pool]: "" }));
      showToast(
        `${kws.length} keyword${kws.length !== 1 ? "s" : ""} added and selected!`
      );
    } catch {}
    finally { setModalKwSaving((prev) => ({ ...prev, [pool]: false })); }
  };

  // ── Facebook groups — DB-backed ──────────────────────────────────────────
  const fetchFbGroups = useCallback(async () => {
    setFbGroupsLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/facebook/groups`);
      if (res.ok) {
        const data = await res.json();
        setFbGroups(data.groups || []);
      }
    } catch {}
    finally { setFbGroupsLoading(false); }
  }, []);

  useEffect(() => { fetchFbGroups(); }, [fetchFbGroups]);

  // Keep selected IDs in sync with what exists (prune deleted groups)
  useEffect(() => {
    if (!fbGroups.length) return;
    const existingIds = new Set(fbGroups.map((g) => g.id));
    setFbSelIds((prev) => {
      const pruned = prev.filter((id) => existingIds.has(id));
      if (pruned.length !== prev.length) {
        try { localStorage.setItem("facebook_sel_groups_v1", JSON.stringify(pruned)); } catch {}
        return pruned;
      }
      return prev;
    });
  }, [fbGroups]);

  useEffect(() => {
    try { localStorage.setItem("facebook_sel_groups_v1", JSON.stringify(fbSelIds)); } catch {}
  }, [fbSelIds]);

  const fbSelectedGroups = fbGroups.filter((g) => fbSelIds.includes(g.id));

  const toggleFbGroup = (id) =>
    setFbSelIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const deleteFbGroup = async (id) => {
    try {
      await apiFetch(`${API_BASE}/api/facebook/groups/${id}`, { method: "DELETE" });
      setFbGroups((prev) => prev.filter((g) => g.id !== id));
      setFbSelIds((prev) => prev.filter((x) => x !== id));
    } catch {
      showToast("Failed to delete group.", "error");
    }
  };

  const addFbGroup = async () => {
    const name = fbNewName.trim();
    const url  = fbNewUrl.trim();
    if (!name || !url) return;
    setFbAddSaving(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/facebook/groups`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name, url }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || "Failed to save group.", "error");
        return;
      }
      const grp = await res.json();
      setFbGroups((prev) => [...prev, grp]);
      setFbSelIds((prev) => [...prev, grp.id]);
      setFbNewName(""); setFbNewUrl("");
    } catch {
      showToast("Failed to save group.", "error");
    } finally {
      setFbAddSaving(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const handleToggle = (key) => updateCard(key, { enabled: !cards[key].enabled });

  const isScraperBlocked = (key) => isHardBlocked || scraperBlocks[key]?.is_blocked === true;
  const getBlockReason   = (key) => {
    if (isHardBlocked) return `Overall budget at ${budgetPct.toFixed(0)}% — increase in Cost Governance`;
    const b = scraperBlocks[key];
    if (b?.is_blocked) {
      return b.no_budget
        ? `No budget allocated for ${key} — set one in Cost Governance`
        : `${key} budget limit reached (${b.pct?.toFixed(0)}%) — increase allocation in Cost Governance`;
    }
    return "";
  };

  const checkBudgetBlock = (key = null) => {
    if (key && isScraperBlocked(key)) { showToast(`🚫 ${getBlockReason(key)}`, "error"); return true; }
    if (!key && isHardBlocked)        { showToast(`🚫 Budget at ${budgetPct.toFixed(0)}% — increase budget in Cost Governance.`, "error"); return true; }
    return false;
  };

  const openSingleModal = (key) => {
    if (checkBudgetBlock(key)) return;
    const def = SCRAPER_DEFS.find((d) => d.key === key);
    setFormValues(Object.fromEntries(def.fields.map((f) => [f.id, f.default])));
    setRunDate(null);
    setModalKwInputs({ shared: "", google_news: "" });
    setModal({ open: true, mode: "single", scraperKey: key });
  };

  const openRunAllModal = () => {
    if (checkBudgetBlock()) return;
    const enabled = SCRAPER_DEFS.filter((d) => cards[d.key].enabled);
    if (enabled.length === 0) { showToast("No scrapers are enabled.", "warning"); return; }
    setMaxItems(20);
    setRunDate(null);
    setModalKwInputs({ shared: "", google_news: "" });
    setModal({ open: true, mode: "all", scraperKey: null });
  };

  const closeModal = () => setModal({ open: false, mode: "single", scraperKey: null });

  const fireScraper = async (def, payload) => {
    const res = await apiFetch(`${API_BASE}${def.endpoint}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const detail = err.detail;
      const msg = typeof detail === "string"
        ? detail
        : Array.isArray(detail)
        ? detail.map((d) => d.msg || JSON.stringify(d)).join("; ")
        : detail
        ? JSON.stringify(detail)
        : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return (await res.json()).task_id;
  };

  // "All" mode helpers — operate on all enabled scrapers in a pool at once
  const isPoolKwSelected = (kwId, pool) =>
    SCRAPER_DEFS.filter((d) => cards[d.key]?.enabled && d.pool === pool)
      .some((d) => (selectedKws[d.key] || []).includes(kwId));

  const togglePoolKw = (kwId, pool) => {
    const targets = SCRAPER_DEFS.filter((d) => cards[d.key]?.enabled && d.pool === pool);
    const anySelected = targets.some((d) => (selectedKws[d.key] || []).includes(kwId));
    setSelectedKws((prev) => {
      const updated = { ...prev };
      targets.forEach((d) => {
        const cur = prev[d.key] || [];
        updated[d.key] = anySelected
          ? cur.filter((id) => id !== kwId)
          : cur.includes(kwId) ? cur : [...cur, kwId];
      });
      return updated;
    });
    targets.forEach((d) => {
      apiFetch(`${API_BASE}/api/keyword-selections`, {
        method:  anySelected ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ scraper: d.key, keyword_id: kwId }),
      }).catch(() => {});
    });
  };

  // Returns the selected keyword objects for a given scraper key
  const getSelectedKwObjects = (scraperKey) => {
    const def    = SCRAPER_DEFS.find((d) => d.key === scraperKey);
    const pool   = def?.pool === "google_news" ? keywords.google_news : keywords.shared;
    const kwIds  = selectedKws[scraperKey] || [];
    return pool.filter((kw) => kwIds.includes(kw.id));
  };

  const isRunDisabled = (() => {
    if (submitting) return true;
    const _def = modal.scraperKey ? SCRAPER_DEFS.find((d) => d.key === modal.scraperKey) : null;
    if (!runDate && !(modal.mode === "single" && _def?.noDate)) return true;
    if (modal.mode === "all") {
      if (!maxItems || maxItems < 1) return true;
      const enabled = SCRAPER_DEFS.filter((d) => cards[d.key]?.enabled);
      if (enabled.some((d) => d.key === "facebook") && fbSelectedGroups.length === 0) return true;
      return !enabled.every((def) => getSelectedKwObjects(def.key).length > 0);
    }
    if (modal.mode === "single") {
      if (modal.scraperKey === "facebook" && fbSelectedGroups.length === 0) return true;
      const hasInvalidField = (_def?.fields || []).some(
        (f) => f.type === "number" && Number(formValues[f.id] ?? 0) < 1
      );
      return hasInvalidField || getSelectedKwObjects(modal.scraperKey || "").length === 0;
    }
    return false;
  })();

  const handleRun = async () => {
    if (checkBudgetBlock()) { closeModal(); return; }
    setSubmitting(true);
    try {
      if (modal.mode === "single") {
        const def        = SCRAPER_DEFS.find((d) => d.key === modal.scraperKey);
        const scraperKws = getSelectedKwObjects(def.key);

        // ── Facebook: fire one job per (group × keyword) ──────────────────
        if (def.key === "facebook") {
          if (fbSelectedGroups.length === 0) {
            showToast("No Facebook groups selected — add groups on the card first.", "error");
            setSubmitting(false); return;
          }
          if (scraperKws.length === 0) {
            showToast("No keywords selected — pick keywords on the card first.", "error");
            setSubmitting(false); return;
          }
          const pairs = [];
          fbSelectedGroups.forEach((grp) => scraperKws.forEach((kw) => pairs.push({ grp, kw })));
          const results = await Promise.allSettled(
            pairs.map(({ grp, kw }) =>
              fireScraper(def, def.buildPayload(formValues, kw.keyword, runDate, grp.url))
            )
          );
          const succeeded = results.filter((r) => r.status === "fulfilled");
          if (succeeded.length > 0)
            updateCard("facebook", { status: "queued", taskId: succeeded[succeeded.length - 1].value, error: null });
          showToast(
            `Facebook Groups: ${succeeded.length}/${pairs.length} job${pairs.length !== 1 ? "s" : ""} queued!`,
            succeeded.length === 0 ? "error" : "success"
          );
          addNotification({
            title: "Facebook Groups started",
            message: `${pairs.length} job${pairs.length !== 1 ? "s" : ""} (${fbSelectedGroups.length} group${fbSelectedGroups.length !== 1 ? "s" : ""} × ${scraperKws.length} keyword${scraperKws.length !== 1 ? "s" : ""})`,
            type: "info",
          });
          closeModal();
        } else {
          // ── All other scrapers ────────────────────────────────────────────
          if (scraperKws.length === 0) {
            showToast("No keywords selected — pick keywords on the card first.", "error");
            setSubmitting(false);
            return;
          }
          const results = await Promise.allSettled(
            scraperKws.map((kw) => fireScraper(def, def.buildPayload(formValues, kw.keyword, runDate)))
          );
          const succeeded = results.filter((r) => r.status === "fulfilled");
          if (succeeded.length > 0)
            updateCard(def.key, { status: "queued", taskId: succeeded[succeeded.length - 1].value, error: null });
          showToast(
            succeeded.length === scraperKws.length
              ? `${def.name}: ${succeeded.length} job${succeeded.length !== 1 ? "s" : ""} queued!`
              : `${def.name}: ${succeeded.length}/${scraperKws.length} queued (${scraperKws.length - succeeded.length} failed)`,
            succeeded.length === 0 ? "error" : succeeded.length < scraperKws.length ? "warning" : "success"
          );
          addNotification({
            title:   `${def.name} started`,
            message: `Running ${scraperKws.length} keyword${scraperKws.length !== 1 ? "s" : ""}`,
            type:    "info",
          });
          closeModal();
        }
      } else {
        // ── Run All: build flat (scraper, keyword, group?) job list ────────
        const enabled = SCRAPER_DEFS.filter((d) => cards[d.key].enabled);
        const jobs = [];
        enabled.forEach((def) => {
          if (def.key === "facebook") {
            fbSelectedGroups.forEach((grp) =>
              getSelectedKwObjects("facebook").forEach((kw) => jobs.push({ def, kw, grp }))
            );
          } else {
            getSelectedKwObjects(def.key).forEach((kw) => jobs.push({ def, kw, grp: null }));
          }
        });
        if (jobs.length === 0) {
          showToast("No keywords selected for any enabled scraper.", "error");
          setSubmitting(false);
          return;
        }
        const results = await Promise.allSettled(
          jobs.map(async ({ def, kw, grp }) => {
            const fv = Object.fromEntries(def.fields.map((f) => [f.id, f.default]));
            if (def.fields[0]) fv[def.fields[0].id] = maxItems;
            const taskId = await fireScraper(def, def.buildPayload(fv, kw.keyword, runDate, grp?.url));
            return { key: def.key, taskId };
          })
        );
        let queued = 0;
        setCards((prev) => {
          const next = { ...prev };
          results.forEach((r) => {
            if (r.status === "fulfilled") {
              const { key, taskId } = r.value;
              next[key] = { ...next[key], status: "queued", taskId, error: null };
              queued++;
            }
          });
          return next;
        });
        showToast(`${queued}/${jobs.length} jobs queued!`);
        if (queued > 0)
          addNotification({
            title:   `${queued} job${queued !== 1 ? "s" : ""} started`,
            message: `Running ${enabled.length} scrapers across ${jobs.length} keyword combinations`,
            type:    "info",
          });
        closeModal();
      }
    } catch (e) {
      showToast(`Error: ${e.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const activeDef    = modal.scraperKey ? SCRAPER_DEFS.find((d) => d.key === modal.scraperKey) : null;
  const enabledCount = SCRAPER_DEFS.filter((d) => cards[d.key].enabled).length;

  return (
    <Box sx={{ width: "100%", p: { xs: 0, md: 1 } }}>

      {/* Header */}
      <Box sx={{
        display: "flex", flexDirection: { xs: "column", sm: "row" },
        justifyContent: "space-between",
        alignItems: { xs: "flex-start", sm: "center" },
        gap: { xs: 2, sm: 0 }, mb: { xs: 3, md: 4 },
      }}>
        <Box>
          <Typography sx={{ fontWeight: 800, color: C.text,
            fontSize: { xs: "1.2rem", sm: "1.4rem", md: "1.75rem" } }}>
            Monitoring 
          </Typography>
          <Typography variant="body2" sx={{ color: C.textMuted }}>
            Configure data sources and trigger extraction jobs.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button
            variant="outlined"
            startIcon={<LabelIcon />}
            onClick={() => setKwModal({ open: true, tab: "shared" })}
            sx={{
              borderColor: C.border, color: C.textSub, textTransform: "none",
              fontSize: { xs: "0.75rem", md: "0.875rem" },
              "&:hover": { borderColor: "#a855f7", color: "#a855f7" },
            }}
          >
            Manage Keywords
          </Button>
          <Button
            variant="contained"
            onClick={openRunAllModal}
            disabled={isHardBlocked}
            startIcon={isHardBlocked ? <BlockIcon /> : null}
            sx={{
              bgcolor:   isHardBlocked ? "#374151" : "#3b82f6",
              color:     isHardBlocked ? "#9ca3af" : "white",
              textTransform: "none",
              fontSize:  { xs: "0.75rem", md: "0.875rem" },
              "&:hover": { bgcolor: isHardBlocked ? "#374151" : "#2563eb" },
              "&.Mui-disabled": { bgcolor: "#374151", color: "#9ca3af" },
            }}
          >
            {isHardBlocked
              ? `Blocked — Budget at ${budgetPct.toFixed(0)}%`
              : `Run All Active (${enabledCount})`}
          </Button>
        </Stack>
      </Box>

      {/* Cards */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: "16px", width: "100%" }}>
        {SCRAPER_DEFS.map((def) => {
          const s           = cards[def.key];
          const meta        = STATUS_META[s.status] || STATUS_META.idle;
          const isRunning   = s.status === "queued" || s.status === "running";
          const blocked     = isScraperBlocked(def.key);
          const blockReason = getBlockReason(def.key);
          const showPending = def.key === "google_news" && hasPending;

          return (
            <Card key={def.key} sx={{
              bgcolor: C.card,
              border: `1px solid ${
                blocked               ? "#374151" :
                !s.enabled            ? C.border :
                s.status === "failed" ? "#ef4444" :
                isRunning             ? "#3b82f6" : C.border
              }`,
              borderRadius: 3, boxShadow: C.shadow,
              flexBasis: { xs: "100%", sm: "calc(50% - 8px)", md: "calc(33.33% - 11px)" },
              flexGrow: 0, flexShrink: 0,
              opacity: (blocked || !s.enabled) ? 0.65 : 1,
              transition: "all 0.3s ease",
            }}>
              <CardContent sx={{ p: { xs: 2, md: 3 } }}>

                {/* Name + Toggle */}
                <Stack direction="row" justifyContent="space-between"
                  alignItems="center" sx={{ mb: 1.5 }}>
                  <Typography sx={{
                    color: s.enabled ? C.text : C.textMuted,
                    fontWeight: 700, fontSize: { xs: "1rem", md: "1.1rem" },
                  }}>
                    {def.name}
                  </Typography>
                  <Switch checked={s.enabled} onChange={() => handleToggle(def.key)}
                    color="success" size="small" />
                </Stack>

                {/* Status chip */}
                <Box sx={{ mb: 2 }}>
                  <Chip
                    icon={
                      isRunning
                        ? <CircularProgress size={10} sx={{ color: meta.color + " !important" }} />
                        : s.status === "completed"
                        ? <CheckCircle sx={{ fontSize: "14px !important", color: meta.color + " !important" }} />
                        : s.status === "failed"
                        ? <Warning sx={{ fontSize: "14px !important", color: meta.color + " !important" }} />
                        : <RadioButtonChecked sx={{ fontSize: "14px !important", color: meta.color + " !important" }} />
                    }
                    label={meta.label}
                    size="small"
                    sx={{ bgcolor: meta.bg, color: meta.color, fontWeight: 600, fontSize: "0.7rem" }}
                  />
                </Box>

                {showPending && (
                  <Box sx={{ p: 1.5, bgcolor: "rgba(168,85,247,0.08)",
                    border: "1px solid rgba(168,85,247,0.25)", borderRadius: 2, mb: 2,
                    display: "flex", alignItems: "center", gap: 1 }}>
                    <HourglassEmptyIcon sx={{ color: "#a855f7", fontSize: 14 }} />
                    <Typography variant="caption" sx={{ color: "#d8b4fe" }}>
                      Newsletter pending approval — collection can still run
                    </Typography>
                  </Box>
                )}

                {s.error && (() => {
                  const [short, detail] = s.error.split("|||");
                  return (
                    <Box sx={{ p: 1.5, bgcolor: "rgba(239,68,68,0.1)",
                      borderRadius: 2, mb: 2, display: "flex", alignItems: "center", gap: 1 }}>
                      <Warning sx={{ color: "#ef4444", fontSize: 16, flexShrink: 0 }} />
                      {detail ? (
                        <Tooltip title={detail} placement="top" arrow
                          componentsProps={{ tooltip: { sx: { maxWidth: 480, fontSize: "0.72rem",
                            lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-all" } } }}>
                          <Typography variant="caption" sx={{ color: "#fca5a5",
                            cursor: "help", textDecoration: "underline dotted #fca5a580" }}>
                            {short}
                          </Typography>
                        </Tooltip>
                      ) : (
                        <Typography variant="caption" sx={{ color: "#fca5a5" }}>{short}</Typography>
                      )}
                    </Box>
                  );
                })()}

                {blocked && (
                  <Box sx={{ p: 1.5, bgcolor: "rgba(239,68,68,0.1)",
                    borderRadius: 2, mb: 2, display: "flex", alignItems: "center", gap: 1 }}>
                    <BlockIcon sx={{ color: "#ef4444", fontSize: 16 }} />
                    <Typography variant="caption" sx={{ color: "#fca5a5" }}>{blockReason}</Typography>
                  </Box>
                )}

                {/* Last Run + Task ID */}
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 2 }}>
                  <Box>
                    <Typography variant="caption" sx={{ color: C.textMuted }}>Last Run</Typography>
                    <Typography variant="body2" sx={{
                      color: s.enabled ? C.text : C.textSub, fontWeight: 600, fontSize: "0.78rem",
                    }}>
                      {s.lastRun || "—"}
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: "right" }}>
                    <Typography variant="caption" sx={{ color: C.textMuted }}>Task ID</Typography>
                    <Typography variant="body2" sx={{ color: C.textMuted, fontWeight: 500, fontSize: "0.7rem" }}>
                      {s.taskId ? s.taskId.slice(0, 8) + "…" : "—"}
                    </Typography>
                  </Box>
                </Stack>

                {/* Items Extracted (+ Items Processed for Google News) */}
                {def.key === "google_news" ? (
                  <Box sx={{ mb: 2, display: "flex", gap: 1 }}>
                    <Box sx={{ flex: 1, p: 1.5, bgcolor: C.cardInner, borderRadius: 2,
                      border: s.enabled ? `1px solid ${C.border}` : "1px solid transparent" }}>
                      <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 700, fontSize: "0.65rem" }}>
                        ITEMS EXTRACTED
                      </Typography>
                      <Typography sx={{ color: s.enabled ? C.text : C.textSub, fontWeight: 800, fontSize: { xs: "1.2rem", md: "1.5rem" } }}>
                        {s.totalItems !== null ? Number(s.totalItems).toLocaleString() : "—"}
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1, p: 1.5, bgcolor: C.cardInner, borderRadius: 2,
                      border: s.enabled ? `1px solid ${C.border}` : "1px solid transparent" }}>
                      <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 700, fontSize: "0.65rem" }}>
                        ITEMS PROCESSED
                      </Typography>
                      <Typography sx={{ color: s.enabled ? "#10b981" : C.textSub, fontWeight: 800, fontSize: { xs: "1.2rem", md: "1.5rem" } }}>
                        {s.itemsProcessed !== null ? Number(s.itemsProcessed).toLocaleString() : "—"}
                      </Typography>
                    </Box>
                  </Box>
                ) : (
                  <Box sx={{ mb: 2, p: 1.5, bgcolor: C.cardInner, borderRadius: 2,
                    border: s.enabled ? `1px solid ${C.border}` : "1px solid transparent" }}>
                    <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 700 }}>
                      ITEMS EXTRACTED
                    </Typography>
                    <Typography sx={{
                      color: s.enabled ? C.text : C.textSub,
                      fontWeight: 800, fontSize: { xs: "1.2rem", md: "1.5rem" },
                    }}>
                      {s.totalItems !== null ? Number(s.totalItems).toLocaleString() : "—"}
                    </Typography>
                  </Box>
                )}

                {/* Run button */}
                <Tooltip title={
                  blocked      ? blockReason
                  : !s.enabled ? "Enable collector first"
                  : isRunning  ? "Already running…"
                  : ""
                }>
                  <span style={{ display: "block" }}>
                    <Button
                      fullWidth
                      variant="outlined"
                      disabled={!s.enabled || isRunning || blocked}
                      startIcon={
                        blocked
                          ? <BlockIcon sx={{ fontSize: "14px !important" }} />
                          : isRunning
                          ? <CircularProgress size={14} sx={{ color: "#3b82f6" }} />
                          : <PlayArrow />
                      }
                      onClick={() => openSingleModal(def.key)}
                      sx={{
                        color:       blocked ? "#6b7280" : C.textSub,
                        borderColor: blocked ? "#374151" : C.border,
                        textTransform: "none", fontSize: "0.8rem",
                        "&:hover": {
                          borderColor: blocked ? "#374151" : "#3b82f6",
                          color:       blocked ? "#6b7280" : "#3b82f6",
                        },
                      }}
                    >
                      {blocked ? "Budget Blocked" : isRunning ? "Running…" : "Run Now"}
                    </Button>
                  </span>
                </Tooltip>

              </CardContent>
            </Card>
          );
        })}
      </Box>

      {/* Run Modal */}
      <Dialog open={modal.open} onClose={closeModal} maxWidth="md" fullWidth
        PaperProps={{ sx: { bgcolor: C.card, border: `1px solid ${C.border}`, borderRadius: 3, maxWidth: 880 } }}>
        <DialogTitle sx={{
          color: C.text, fontWeight: 700,
          display: "flex", justifyContent: "space-between", alignItems: "center", pb: 1,
        }}>
          {modal.mode === "all" ? `Run All Active (${enabledCount})` : `Run ${activeDef?.name}`}
          <IconButton onClick={closeModal} size="small" sx={{ color: C.textMuted }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ pt: 1 }}>
          {modal.mode === "all" ? (() => {
            const enabledDefs = SCRAPER_DEFS.filter((d) => cards[d.key]?.enabled);
            const hasShared   = enabledDefs.some((d) => d.pool === "shared");
            const hasGN       = enabledDefs.some((d) => d.pool === "google_news");

            const KwSection = ({ pool, heading }) => {
              const pool_kws = pool === "google_news" ? keywords.google_news : keywords.shared;
              const selCount = pool_kws.filter((kw) => isPoolKwSelected(kw.id, pool)).length;
              return (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{
                    color: C.textMuted, fontWeight: 700, fontSize: "0.65rem", letterSpacing: 0.5,
                  }}>
                    {heading}{selCount > 0 && ` (${selCount} selected)`}
                  </Typography>

                  {/* Quick-add input */}
                  <Stack direction="row" spacing={0.75} sx={{ mt: 0.75, mb: 1 }}>
                    <TextField
                      size="small" fullWidth
                      placeholder="Add keywords (comma-separated)…"
                      value={modalKwInputs[pool]}
                      onChange={(e) => setModalKwInputs((prev) => ({ ...prev, [pool]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") handleModalAddKeyword(pool); }}
                      sx={{
                        "& .MuiOutlinedInput-root": {
                          color: C.text, bgcolor: C.inputBg, fontSize: "0.8rem",
                          "& fieldset": { borderColor: C.border },
                          "&:hover fieldset": { borderColor: "#3b82f6" },
                          "&.Mui-focused fieldset": { borderColor: "#3b82f6" },
                        },
                        "& .MuiInputBase-input": { color: C.text, py: "6px" },
                      }}
                    />
                    <Button
                      variant="outlined" size="small"
                      onClick={() => handleModalAddKeyword(pool)}
                      disabled={modalKwSaving[pool] || !modalKwInputs[pool]?.trim()}
                      sx={{
                        borderColor: C.border, color: C.textSub, textTransform: "none",
                        whiteSpace: "nowrap", minWidth: 56, fontSize: "0.78rem",
                        "&:hover": { borderColor: "#3b82f6", color: "#3b82f6" },
                        "&.Mui-disabled": { borderColor: C.border, color: C.textMuted },
                      }}
                    >
                      {modalKwSaving[pool] ? <CircularProgress size={13} sx={{ color: "inherit" }} /> : "Add"}
                    </Button>
                  </Stack>

                  {pool_kws.length === 0 ? (
                    <Typography variant="caption" sx={{ color: C.textMuted }}>
                      Type above to add keywords, or use{" "}
                      <Typography component="span" variant="caption"
                        sx={{ color: "#a855f7", fontWeight: 700, cursor: "pointer", textDecoration: "underline dotted" }}
                        onClick={() => { closeModal(); setKwModal({ open: true, tab: pool }); }}
                      >
                        Manage Keywords
                      </Typography>.
                    </Typography>
                  ) : (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                      {[...pool_kws].sort((a, b) => a.keyword.localeCompare(b.keyword)).map((kw) => {
                        const sel = isPoolKwSelected(kw.id, pool);
                        return (
                          <Chip
                            key={kw.id} label={kw.keyword} size="small"
                            onClick={() => togglePoolKw(kw.id, pool)}
                            sx={{
                              cursor: "pointer",
                              bgcolor: sel ? "#3b82f620" : "transparent",
                              color:   sel ? "#3b82f6"   : C.textMuted,
                              border:  `1px solid ${sel ? "#3b82f6" : C.border}`,
                              fontWeight: sel ? 700 : 400, fontSize: "0.72rem",
                              "&:hover": { borderColor: "#3b82f6", color: "#3b82f6" },
                            }}
                          />
                        );
                      })}
                    </Box>
                  )}
                </Box>
              );
            };

            return (
              <>
                <Typography variant="caption" sx={{ color: C.textMuted, display: "block", mb: 2 }}>
                  Applied equally to all {enabledCount} enabled scrapers.
                </Typography>
                <TextField
                  fullWidth autoFocus
                  label="Max items per collection"
                  type="number"
                  value={maxItems}
                  inputProps={{ min: 1 }}
                  onChange={(e) => setMaxItems(Math.max(1, Number(e.target.value) || 1))}
                  sx={{
                    mb: 2,
                    "& .MuiOutlinedInput-root": {
                      color: C.text, bgcolor: C.inputBg,
                      "& fieldset": { borderColor: C.border },
                      "&:hover fieldset": { borderColor: "#3b82f6" },
                      "&.Mui-focused fieldset": { borderColor: "#3b82f6" },
                    },
                    "& .MuiInputBase-input": { color: C.text },
                  }}
                  InputLabelProps={{ style: { color: C.textSub } }}
                />
                {hasShared && KwSection({ pool: "shared", heading: hasGN ? "ALL COLLECTORS KEYWORDS" : "KEYWORDS" })}
                {hasGN && KwSection({ pool: "google_news", heading: "GOOGLE NEWS KEYWORDS" })}
              </>
            );
          })() : (
            <>
              <Typography variant="caption" sx={{ color: C.textMuted, display: "block", mb: 2 }}>
                Fill in the parameters below.
              </Typography>
              {activeDef?.fields.map((field) => (
                <TextField
                  key={field.id} fullWidth label={field.label} type={field.type}
                  value={formValues[field.id] ?? ""} required={field.required}
                  placeholder={field.placeholder}
                  inputProps={field.type === "number" ? { min: 1 } : undefined}
                  onChange={(e) =>
                    setFormValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                  }
                  sx={{
                    mb: 2,
                    "& .MuiOutlinedInput-root": {
                      color: C.text, bgcolor: C.inputBg,
                      "& fieldset": { borderColor: C.border },
                      "&:hover fieldset": { borderColor: "#3b82f6" },
                      "&.Mui-focused fieldset": { borderColor: "#3b82f6" },
                    },
                    "& .MuiInputBase-input": { color: C.text },
                  }}
                  InputLabelProps={{ style: { color: C.textSub } }}
                />
              ))}
            </>
          )}

          {/* Facebook Groups selector — between Max Posts and Keywords */}
          {modal.mode === "single" && activeDef?.key === "facebook" && (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.75 }}>
                <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 700, fontSize: "0.65rem", letterSpacing: 0.5 }}>
                  GROUPS{fbSelectedGroups.length > 0 && ` (${fbSelectedGroups.length} selected)`}
                </Typography>
                <Typography variant="caption" onClick={() => setFbMgmtOpen(true)}
                  sx={{ color: "#3b82f6", fontSize: "0.68rem", cursor: "pointer", "&:hover": { textDecoration: "underline" } }}>
                  + Manage Groups
                </Typography>
              </Box>
              {fbGroups.length === 0 ? (
                <Typography variant="caption" sx={{ color: "#ef4444", fontSize: "0.72rem" }}>
                  No groups saved — click Manage Groups to add one first
                </Typography>
              ) : (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.6 }}>
                  {fbGroups.map((grp) => {
                    const isSel = fbSelIds.includes(grp.id);
                    return (
                      <Box key={grp.id} onClick={() => toggleFbGroup(grp.id)} sx={{
                        display: "inline-flex", alignItems: "center", gap: 0.3,
                        px: 1.2, py: "4px",
                        bgcolor: isSel ? "rgba(59,130,246,0.15)" : C.cardInner,
                        color:   isSel ? "#3b82f6" : C.textSub,
                        border:  `1px solid ${isSel ? "#3b82f6" : C.border}`,
                        borderRadius: 10, cursor: "pointer", fontSize: "0.75rem",
                        "&:hover": { borderColor: "#3b82f6" },
                        userSelect: "none",
                      }}>
                        {grp.name}
                        <Tooltip title={grp.url} placement="top" arrow
                          componentsProps={{ tooltip: { sx: { maxWidth: 380, fontSize: "0.7rem", wordBreak: "break-all" } } }}>
                          <Box component="span" onClick={(e) => e.stopPropagation()}
                            sx={{ display: "flex", alignItems: "center", ml: 0.3 }}>
                            <HelpOutlineIcon sx={{ fontSize: 12, color: C.textMuted }} />
                          </Box>
                        </Tooltip>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Box>
          )}

          {/* Keyword chips inside modal — single mode */}
          {modal.mode === "single" && (() => {
            const singlePool = activeDef?.pool === "google_news" ? "google_news" : "shared";
            const pool  = singlePool === "google_news" ? keywords.google_news : keywords.shared;
            const kwIds = selectedKws[activeDef?.key] || [];
            return (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" sx={{
                  color: C.textMuted, fontWeight: 700, fontSize: "0.65rem", letterSpacing: 0.5,
                }}>
                  KEYWORDS {pool.length > 0 && kwIds.length > 0 && `(${kwIds.length} selected)`}
                </Typography>

                {/* Quick-add input */}
                <Stack direction="row" spacing={0.75} sx={{ mt: 0.75, mb: 1 }}>
                  <TextField
                    size="small" fullWidth
                    placeholder="Add keywords (comma-separated)…"
                    value={modalKwInputs[singlePool]}
                    onChange={(e) => setModalKwInputs((prev) => ({ ...prev, [singlePool]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") handleModalAddKeyword(singlePool); }}
                    sx={{
                      "& .MuiOutlinedInput-root": {
                        color: C.text, bgcolor: C.inputBg, fontSize: "0.8rem",
                        "& fieldset": { borderColor: C.border },
                        "&:hover fieldset": { borderColor: "#3b82f6" },
                        "&.Mui-focused fieldset": { borderColor: "#3b82f6" },
                      },
                      "& .MuiInputBase-input": { color: C.text, py: "6px" },
                    }}
                  />
                  <Button
                    variant="outlined" size="small"
                    onClick={() => handleModalAddKeyword(singlePool)}
                    disabled={modalKwSaving[singlePool] || !modalKwInputs[singlePool]?.trim()}
                    sx={{
                      borderColor: C.border, color: C.textSub, textTransform: "none",
                      whiteSpace: "nowrap", minWidth: 56, fontSize: "0.78rem",
                      "&:hover": { borderColor: "#3b82f6", color: "#3b82f6" },
                      "&.Mui-disabled": { borderColor: C.border, color: C.textMuted },
                    }}
                  >
                    {modalKwSaving[singlePool] ? <CircularProgress size={13} sx={{ color: "inherit" }} /> : "Add"}
                  </Button>
                </Stack>

                {pool.length === 0 ? (
                  <Typography variant="caption" sx={{ color: C.textMuted }}>
                    Type above to add keywords, or use{" "}
                    <Typography component="span" variant="caption"
                      sx={{ color: "#a855f7", fontWeight: 700, cursor: "pointer", textDecoration: "underline dotted" }}
                      onClick={() => { closeModal(); setKwModal({ open: true, tab: singlePool }); }}
                    >
                      Manage Keywords
                    </Typography>.
                  </Typography>
                ) : (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                    {[...pool].sort((a, b) => a.keyword.localeCompare(b.keyword)).map((kw) => {
                      const sel = kwIds.includes(kw.id);
                      return (
                        <Chip
                          key={kw.id}
                          label={kw.keyword}
                          size="small"
                          onClick={() => toggleKeyword(activeDef.key, kw.id)}
                          sx={{
                            cursor: "pointer",
                            bgcolor: sel ? "#3b82f620" : "transparent",
                            color:   sel ? "#3b82f6"   : C.textMuted,
                            border:  `1px solid ${sel ? "#3b82f6" : C.border}`,
                            fontWeight: sel ? 700 : 400,
                            fontSize: "0.72rem",
                            "&:hover": { borderColor: "#3b82f6", color: "#3b82f6" },
                          }}
                        />
                      );
                    })}
                  </Box>
                )}
              </Box>
            );
          })()}

          {/* Date filter — hidden for scrapers that don't support since_date */}
          {!(modal.mode === "single" && activeDef?.noDate) && (
            <Box sx={{ mt: 1 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.8, mb: 0.8 }}>
                <CalendarTodayIcon sx={{ fontSize: 13, color: C.textMuted }} />
                <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 700, letterSpacing: 0.4 }}>
                  FILTER BY DATE (REQUIRED)
                </Typography>
              </Box>
              <input
                type="date"
                value={runDate || ""}
                max={TODAY}
                onChange={(e) => setRunDate(e.target.value || null)}
                style={{
                  background:  isDark ? "#1a2236" : "#f1f5f9",
                  color:       C.text,
                  border:      `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding:     "8px 12px",
                  fontSize:    "0.88rem",
                  outline:     "none",
                  cursor:      "pointer",
                  width:       "100%",
                  boxSizing:   "border-box",
                  colorScheme: isDark ? "dark" : "light",
                }}
              />
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={closeModal} sx={{ color: C.textMuted, textTransform: "none" }}>
            Cancel
          </Button>
          <Tooltip title={isRunDisabled && !submitting
            ? !runDate
              ? "Select a date to run"
              : modal.mode === "all"
              ? "Every active source must have at least one keyword selected"
              : "Select at least one keyword to run"
            : ""}>
            <span>
              <Button
                variant="contained" onClick={handleRun} disabled={isRunDisabled}
                startIcon={
                  submitting
                    ? <CircularProgress size={14} sx={{ color: "white" }} />
                    : <PlayArrow />
                }
                sx={{
                  bgcolor: "#3b82f6", textTransform: "none",
                  "&:hover": { bgcolor: "#2563eb" },
                  "&.Mui-disabled": { bgcolor: C.hover, color: C.textSub },
                }}
              >
                {submitting
                  ? "Starting…"
                  : modal.mode === "all"
                  ? `Run ${enabledCount} Scrapers`
                  : "Start Collection"}
              </Button>
            </span>
          </Tooltip>
        </DialogActions>
      </Dialog>

      {/* Manage Keywords Modal */}
      <Dialog
        open={kwModal.open}
        onClose={() => setKwModal({ open: false, tab: "shared" })}
        maxWidth="sm" fullWidth
        PaperProps={{ sx: { bgcolor: C.card, border: `1px solid ${C.border}`, borderRadius: 3 } }}
      >
        <DialogTitle sx={{
          color: C.text, fontWeight: 700,
          display: "flex", justifyContent: "space-between", alignItems: "center", pb: 0,
        }}>
          Manage Keywords
          <IconButton onClick={() => setKwModal({ open: false, tab: "shared" })} size="small" sx={{ color: C.textMuted }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <Tabs
          value={kwModal.tab}
          onChange={(_, v) => setKwModal((prev) => ({ ...prev, tab: v }))}
          sx={{
            px: 2, borderBottom: `1px solid ${C.border}`,
            "& .MuiTab-root":    { color: C.textMuted, textTransform: "none", fontSize: "0.85rem" },
            "& .Mui-selected":   { color: "#3b82f6" },
            "& .MuiTabs-indicator": { bgcolor: "#3b82f6" },
          }}
        >
          <Tab value="shared"     label="All Collectors" />
          <Tab value="google_news" label="Google News" />
        </Tabs>

        <DialogContent>
          <Typography variant="caption" sx={{ color: C.textMuted, display: "block", mb: 1.5 }}>
            {kwModal.tab === "shared"
              ? "Shared across Reddit, EduGeek, StackExchange, Autodesk, Twitter, Spiceworks, Quora."
              : "Used only for Google News collection."}
          </Typography>

          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <TextField
              fullWidth size="small"
              placeholder="Add keywords (comma-separated)"
              value={kwInput}
              onChange={(e) => setKwInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveKeywords(kwModal.tab); }}
              sx={{
                "& .MuiOutlinedInput-root": {
                  color: C.text, bgcolor: C.inputBg,
                  "& fieldset": { borderColor: C.border },
                  "&:hover fieldset": { borderColor: "#3b82f6" },
                  "&.Mui-focused fieldset": { borderColor: "#3b82f6" },
                },
                "& .MuiInputBase-input": { color: C.text },
              }}
            />
            <Button
              variant="contained"
              onClick={() => handleSaveKeywords(kwModal.tab)}
              disabled={kwSaving || !kwInput.trim()}
              sx={{
                bgcolor: "#3b82f6", textTransform: "none", whiteSpace: "nowrap",
                "&:hover": { bgcolor: "#2563eb" },
                "&.Mui-disabled": { bgcolor: C.hover, color: C.textSub },
              }}
            >
              {kwSaving ? <CircularProgress size={16} sx={{ color: "inherit" }} /> : "Save"}
            </Button>
          </Stack>

          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, minHeight: 32 }}>
            {(kwModal.tab === "shared" ? keywords.shared : keywords.google_news).length === 0 ? (
              <Typography variant="caption" sx={{ color: C.textMuted }}>
                No keywords yet — type above and click Save.
              </Typography>
            ) : (
              [...(kwModal.tab === "shared" ? keywords.shared : keywords.google_news)].sort((a, b) => a.keyword.localeCompare(b.keyword)).map((kw) => (
                <Chip
                  key={kw.id}
                  label={kw.keyword}
                  onDelete={() => handleDeleteKeyword(kw.id)}
                  size="small"
                  sx={{
                    bgcolor: C.cardInner, color: C.text,
                    border: `1px solid ${C.border}`,
                    "& .MuiChip-deleteIcon": { color: C.textMuted, "&:hover": { color: "#ef4444" } },
                  }}
                />
              ))
            )}
          </Box>
        </DialogContent>
      </Dialog>

      {/* ── Facebook Groups Management Dialog ─────────────────────────── */}
      <Dialog open={fbMgmtOpen} onClose={() => setFbMgmtOpen(false)} maxWidth="sm" fullWidth
        PaperProps={{ sx: { bgcolor: C.card, border: `1px solid ${C.border}`, borderRadius: 3 } }}>
        <DialogTitle sx={{ color: C.text, fontWeight: 700, pb: 1,
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          Facebook Groups
          <IconButton onClick={() => setFbMgmtOpen(false)} size="small" sx={{ color: C.textMuted }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ pt: 0 }}>
          {/* Add new group */}
          <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 700,
            fontSize: "0.65rem", letterSpacing: 0.5, display: "block", mb: 1 }}>
            ADD GROUP
          </Typography>
          <Stack spacing={1} sx={{ mb: 3 }}>
            <TextField size="small" fullWidth label="Group Name" placeholder="e.g. IT Professionals"
              value={fbNewName} onChange={(e) => setFbNewName(e.target.value)}
              sx={{
                "& .MuiOutlinedInput-root": { color: C.text, bgcolor: C.inputBg,
                  "& fieldset": { borderColor: C.border },
                  "&:hover fieldset": { borderColor: "#3b82f6" },
                  "&.Mui-focused fieldset": { borderColor: "#3b82f6" } },
                "& .MuiInputBase-input": { color: C.text },
              }}
              InputLabelProps={{ style: { color: C.textSub } }} />
            <TextField size="small" fullWidth label="Group URL *" placeholder="https://www.facebook.com/groups/..."
              value={fbNewUrl}
              onChange={(e) => setFbNewUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addFbGroup(); }}
              sx={{
                "& .MuiOutlinedInput-root": { color: C.text, bgcolor: C.inputBg,
                  "& fieldset": { borderColor: C.border },
                  "&:hover fieldset": { borderColor: "#3b82f6" },
                  "&.Mui-focused fieldset": { borderColor: "#3b82f6" } },
                "& .MuiInputBase-input": { color: C.text },
              }}
              InputLabelProps={{ style: { color: C.textSub } }} />
            <Button variant="contained" size="small"
              disabled={fbAddSaving || !fbNewName.trim() || !fbNewUrl.trim()}
              onClick={addFbGroup}
              sx={{ bgcolor: "#3b82f6", textTransform: "none", alignSelf: "flex-start",
                "&:hover": { bgcolor: "#2563eb" },
                "&.Mui-disabled": { bgcolor: C.cardInner, color: C.textMuted } }}>
              {fbAddSaving ? <CircularProgress size={14} sx={{ color: "inherit" }} /> : "Add Group"}
            </Button>
          </Stack>

          {/* Saved groups list */}
          <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 700,
            fontSize: "0.65rem", letterSpacing: 0.5, display: "block", mb: 1 }}>
            SAVED GROUPS ({fbGroups.length})
          </Typography>
          {fbGroups.length === 0 ? (
            <Typography variant="body2" sx={{ color: C.textMuted }}>No groups saved yet.</Typography>
          ) : (
            <Stack spacing={1}>
              {fbGroups.map((grp) => {
                const isSel = fbSelIds.includes(grp.id);
                return (
                  <Box key={grp.id} sx={{
                    display: "flex", alignItems: "center", gap: 1,
                    p: 1.25, bgcolor: C.cardInner, borderRadius: 1.5,
                    border: `1px solid ${isSel ? "#3b82f6" : C.border}`,
                  }}>
                    <Switch size="small" checked={isSel} onChange={() => toggleFbGroup(grp.id)} color="primary" />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ color: C.text, fontWeight: 600, fontSize: "0.83rem" }}>
                        {grp.name}
                      </Typography>
                      <Tooltip title={grp.url} placement="top" arrow
                        componentsProps={{ tooltip: { sx: { maxWidth: 420, fontSize: "0.7rem", wordBreak: "break-all" } } }}>
                        <Typography sx={{ color: C.textMuted, fontSize: "0.7rem",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          cursor: "help", display: "flex", alignItems: "center", gap: 0.3 }}>
                          <HelpOutlineIcon sx={{ fontSize: 11 }} />
                          {grp.url}
                        </Typography>
                      </Tooltip>
                    </Box>
                    <IconButton size="small" onClick={() => deleteFbGroup(grp.id)}
                      sx={{ color: C.textMuted, "&:hover": { color: "#ef4444" } }}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Box>
                );
              })}
            </Stack>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setFbMgmtOpen(false)} size="small"
            sx={{ textTransform: "none", color: C.textSub, borderColor: C.border }}
            variant="outlined">
            Done
          </Button>
        </DialogActions>
      </Dialog>

      {/* Toast */}
      <Snackbar
        open={toast.open} autoHideDuration={4000}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        <Alert
          severity={toast.severity}
          onClose={() => setToast((t) => ({ ...t, open: false }))}
          sx={{ bgcolor: C.hover, color: C.text, "& .MuiAlert-icon": { color: "inherit" } }}>
          {toast.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Scraping;
