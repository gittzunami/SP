import React, { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "../api";
import {
  Box, Card, CardContent, Typography, TextField, Button,
  FormControl, InputLabel, Select, MenuItem, Table, TableBody,
  TableCell, TableHead, TableRow, Checkbox, Chip, InputAdornment,
  IconButton, CircularProgress, Menu, Snackbar, Alert, Tooltip,
  Autocomplete,
} from "@mui/material";
import SearchIcon       from "@mui/icons-material/Search";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import AutoAwesome      from "@mui/icons-material/AutoAwesome";
import FilterListIcon   from "@mui/icons-material/FilterList";
import Delete           from "@mui/icons-material/Delete";
import ArrowDropDown    from "@mui/icons-material/ArrowDropDown";
import VisibilityIcon   from "@mui/icons-material/Visibility";
import PsychologyIcon   from "@mui/icons-material/Psychology";
import LLMFeedModal            from "./LLMFeedModal";
import RecordDetailModal       from "./RecordDetailModal";
import FeedToSmartBrainModal   from "./FeedToSmartBrainModal";
import { useNavigate } from "react-router-dom";
import { useAppTheme } from "../AppThemeContext";

// ─────────────────────────────────────────────────────────────────────────────
const API_BASE  = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const PAGE_SIZE = 15;

const PLATFORMS = [
  { value: "all",           label: "All Platforms"    },
  { value: "reddit",        label: "Reddit"           },
  { value: "edugeek",       label: "EduGeek"          },
  { value: "autodesk",      label: "Autodesk"         },
  { value: "stackexchange", label: "StackExchange"    },
  { value: "google_news",   label: "Google News"      },
  { value: "twitter",       label: "Twitter / X"      },
  { value: "spiceworks",    label: "Spiceworks"       },
  { value: "quora",         label: "Quora"            },
  { value: "facebook",      label: "Facebook Groups"  },
];

const PLATFORM_LABELS = {
  reddit: "Reddit", edugeek: "EduGeek",
  autodesk: "Autodesk", stackexchange: "StackExchange",
  google_news: "Google News", twitter: "Twitter / X",
  spiceworks: "Spiceworks", quora: "Quora",
  facebook: "Facebook",
};

// ── Date cutoff ───────────────────────────────────────────────────────────────
function getDateCutoff(range) {
  const now = Date.now();
  if (range === "24h") return new Date(now - 864e5);
  if (range === "7d")  return new Date(now - 6048e5);
  if (range === "30d") return new Date(now - 2592e6);
  return null;
}

// ── Normalise one backend row → display object ────────────────────────────────
function normalise(raw, fbGroupMap = {}) {
  const date      = raw.created_at || raw.published_at || raw.timestamp || "";
  const scrapedAt = raw.scraped_at || "";
  const content   = raw.title || raw.text || raw.caption || raw.body || raw.description || "(no content)";
  const author    = raw.author || raw.screen_name || raw.owner_username || raw.source_name || "";
  const rawId     = String(raw.id || raw.question_id || raw.tweet_id || raw.instagram_id || raw.google_news_url || raw.url || "");
  const uid       = `${raw.source}::${rawId}`;
  const groupName = raw.source === "facebook" && raw.group_url
    ? (fbGroupMap[raw.group_url] || null)
    : null;
  return {
    _raw:      raw,
    uid,
    id:        rawId,
    platform:  raw.source || "",
    groupName,
    content:   String(content),
    author:    String(author),
    keyword:   raw.keyword || "",
    url:       raw.url || raw.google_news_url || "",
    date,
    scrapedAt,
    dateObj:   date ? new Date(date) : null,
  };
}

// ── CSV helpers ───────────────────────────────────────────────────────────────
function flatten(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v))                         out[key] = JSON.stringify(v);
    else if (v !== null && typeof v === "object")  Object.assign(out, flatten(v, key));
    else                                           out[key] = v ?? "";
  }
  return out;
}

function toCsv(rows) {
  if (!rows?.length) return "";
  const flat    = rows.map((r) => flatten(r));
  const headers = [...new Set(flat.flatMap(Object.keys))];
  const esc     = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    headers.map(esc).join(","),
    ...flat.map((r) => headers.map((h) => esc(r[h] ?? "")).join(",")),
  ].join("\r\n");
}

async function fetchSelectedExport(selections) {
  const res = await apiFetch(`${API_BASE}/export/selected`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ selections }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.by_source || {};
}

async function fetchForExport(source, keyword) {
  const params = new URLSearchParams();
  if (source && source !== "all") params.set("source", source);
  if (keyword && keyword.trim().length >= 2) params.set("keyword", keyword.trim());

  const res = await apiFetch(`${API_BASE}/export?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data.by_source) return data.by_source;
  const src = source && source !== "all" ? source : "unknown";
  return { [src]: data.results || [] };
}

function saveFile(content, suggestedName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), {
    href:     url,
    download: suggestedName,
    style:    "display:none",
  });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  return "saved";
}

// ─────────────────────────────────────────────────────────────────────────────
const Results = () => {
  const { C, isDark } = useAppTheme();

  const [rows,       setRows]       = useState([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [exporting,  setExporting]  = useState(false);
  // url → name map for Facebook groups saved in DB
  const [fbGroupMap, setFbGroupMap] = useState({});

  const [searchInput,    setSearchInput]    = useState("");
  const [search,         setSearch]         = useState("");
  const [platform,       setPlatform]       = useState("all");
  const [dateRange,      setDateRange]      = useState("all");
  const [scrapeKeyword,  setScrapeKeyword]  = useState(null);
  const [fbGroupFilter,  setFbGroupFilter]  = useState(null); // selected group URL or null
  const [usedKeywords,   setUsedKeywords]   = useState([]);

  const [offset, setOffset] = useState(0);
  const [serialStart, setSerialStart] = useState(1);
  const [selectedIds,    setSelectedIds]    = useState(new Set());
  const [selectedRowMap, setSelectedRowMap] = useState(new Map()); // uid → row object, survives pagination
  const [exportAnchor, setExportAnchor] = useState(null);

  const [toast, setToast] = useState({ open: false, msg: "", severity: "success" });
  const showToast = (msg, severity = "success") => setToast({ open: true, msg, severity });

  const [viewRow, setViewRow] = useState(null);

  const navigate = useNavigate();
  const [llmModalOpen,    setLlmModalOpen]    = useState(false);
  const [feedToSBOpen,    setFeedToSBOpen]    = useState(false);

  useEffect(() => {
    apiFetch(`${API_BASE}/api/keywords/used`)
      .then((r) => r.ok ? r.json() : { keywords: [] })
      .then((d) => setUsedKeywords(d.keywords || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    apiFetch(`${API_BASE}/api/facebook/groups`)
      .then((r) => r.ok ? r.json() : { groups: [] })
      .then((d) => {
        const map = {};
        for (const g of (d.groups || [])) map[g.url] = g.name;
        setFbGroupMap(map);
      })
      .catch(() => {});
  }, []);

  const debounceRef = useRef(null);
  const handleSearchInput = (val) => {
    setSearchInput(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(val);
      setOffset(0);
    }, 500);
  };

  const fetchPage = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: PAGE_SIZE, offset });
      if (search.trim().length >= 2) params.set("keyword", search.trim());
      if (platform !== "all")        params.set("source",  platform);
      if (dateRange !== "all")       params.set("date_range", dateRange);
      if (scrapeKeyword)             params.set("scrape_keyword", scrapeKeyword);
      if (fbGroupFilter)             params.set("group_url", fbGroupFilter);

      const res  = await apiFetch(`${API_BASE}/search?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      setRows((data.results || []).map((r) => normalise(r, fbGroupMap)));
      setTotal(data.total ?? 0);
      setSerialStart(offset + 1);
    } catch (e) {
      showToast(`Failed to load: ${e.message}`, "error");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [search, platform, dateRange, offset, scrapeKeyword, fbGroupFilter, fbGroupMap]);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  const isSelected        = (uid) => selectedIds.has(uid);
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.uid));
  const someOnPageSelected = rows.some((r) => selectedIds.has(r.uid));

  const toggleOne = (row) => {
    const uid = row.uid;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
    setSelectedRowMap((prev) => {
      const next = new Map(prev);
      next.has(uid) ? next.delete(uid) : next.set(uid, row);
      return next;
    });
  };

  const togglePageAll = () => {
    const removing = allOnPageSelected;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      rows.forEach((r) => removing ? next.delete(r.uid) : next.add(r.uid));
      return next;
    });
    setSelectedRowMap((prev) => {
      const next = new Map(prev);
      rows.forEach((r) => removing ? next.delete(r.uid) : next.set(r.uid, r));
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectedRowMap(new Map());
  };

  const handleExport = async (format) => {
    setExportAnchor(null);
    if (selectedIds.size === 0) {
      showToast("Select items first to export.", "warning");
      return;
    }
    setExporting(true);
    try {
      const kw        = search.trim();
      const timestamp = new Date().toISOString().slice(0, 10);
      let exportPayload;

      if (selectedIds.size > 0) {
        const selections = {};
        for (const r of selectedRowMap.values()) {
          const src = r.platform;
          if (!selections[src]) selections[src] = [];
          const nativeId = src === "google_news"
            ? (r.url || r._raw.google_news_url || r._raw.url || "")
            : r.id;
          if (nativeId) selections[src].push(nativeId);
        }
        if (Object.keys(selections).length === 0) {
          showToast("No selected rows to export.", "warning");
          setExporting(false);
          return;
        }
        showToast("Fetching full data for selected rows…", "info");
        exportPayload = await fetchSelectedExport(selections);
        if (Object.keys(exportPayload).length === 0) {
          showToast("No data returned for selection.", "warning");
          setExporting(false);
          return;
        }
      }

      const entries    = Object.entries(exportPayload).filter(([, r]) => r?.length);
      let   savedCount = 0;

      for (const [src, srcRows] of entries) {
        let content, filename, mime;
        if (format === "json") {
          content  = JSON.stringify(srcRows, null, 2);
          filename = `scraped_${src}_${timestamp}.json`;
          mime     = "application/json";
        } else {
          content  = toCsv(srcRows);
          filename = `scraped_${src}_${timestamp}.csv`;
          mime     = "text/csv;charset=utf-8;";
        }
        if (!content) continue;
        const result = await saveFile(content, filename, mime);
        if (result === "cancelled") {
          showToast("Export cancelled.", "info");
          setExporting(false);
          return;
        }
        savedCount++;
        if (entries.length > 1) await new Promise((r) => setTimeout(r, 350));
      }

      if (savedCount > 0) {
        clearSelection();
        showToast(`${savedCount} file${savedCount !== 1 ? "s" : ""} saved ✓`);
      } else {
        showToast("Nothing to export.", "warning");
      }
    } catch (e) {
      showToast(`Export failed: ${e.message}`, "error");
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedIds.size) return;

    const rowsToDelete = [...selectedRowMap.values()];
    const deletes = rowsToDelete.map(async (row) => {
      const nativeId = row.id || "";
      if (!nativeId) return null;
      try {
        const res = await apiFetch(`${API_BASE}/api/record/${row.platform}/${encodeURIComponent(nativeId)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          console.error(`Failed to delete ${row.platform}/${nativeId}`);
          return null;
        }
        return { platform: row.platform, id: nativeId };
      } catch (e) {
        console.error(`Error deleting ${row.platform}/${nativeId}:`, e);
        return null;
      }
    });
    
    const results = await Promise.all(deletes);
    const deletedCount = results.filter(r => r !== null).length;

    clearSelection();
    showToast(`${deletedCount} item(s) deleted.`, "info");

    // Adjust offset if we deleted all items on the last page
    const newTotal = Math.max(0, total - deletedCount);
    const maxOffset = Math.max(0, Math.floor((newTotal - 1) / PAGE_SIZE) * PAGE_SIZE);
    if (offset > maxOffset) {
      setOffset(maxOffset); // triggers fetchPage via useEffect
    } else {
      fetchPage(); // same page — refetch to pull in items from next page
    }
  };

  const formatDate = (d) => {
    if (!d) return "—";
    try { return new Date(d).toLocaleString(); } catch { return String(d); }
  };

  const currentPage = Math.floor(offset / PAGE_SIZE);
  const totalPages  = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const startRow    = total === 0 ? 0 : offset + 1;
  const endRow      = offset + rows.length;
  const hasPrev     = offset > 0;
  const hasNext     = endRow < total;

  const goFirst = () => setOffset(0);
  const goPrev  = () => setOffset((o) => Math.max(0, o - PAGE_SIZE));
  const goNext  = () => setOffset((o) => o + PAGE_SIZE);
  const goLast  = () => setOffset((totalPages - 1) * PAGE_SIZE);

  const selectionBg  = isDark ? "#1e3a5f" : "#dbeafe";
  const selectionBdr = isDark ? "#3b82f6" : "#3b82f6";

  return (
    <Box sx={{ color: C.text, pb: 4, width: "100%", boxSizing: "border-box" }}>

      {/* Header */}
      <Box sx={{ mb: 2 }}>
        <Typography sx={{ fontWeight: "bold", mb: 0.5, fontSize: { xs: "1.1rem", md: "1.75rem" }, color: C.text }}>
          Results Viewer
        </Typography>
        <Typography variant="body2" sx={{ color: C.textSub }}>
          Browse, filter, and export extracted intelligence.
        </Typography>
      </Box>

      {/* Action buttons */}
      <Box sx={{ display: "flex", gap: 1, mb: 3, flexWrap: "wrap", alignItems: "center" }}>

        <Button
          variant="outlined"
          startIcon={exporting ? <CircularProgress size={14} sx={{ color: C.textSub }} /> : <FileDownloadIcon />}
          endIcon={<ArrowDropDown />}
          disabled={exporting}
          onClick={(e) => setExportAnchor(e.currentTarget)}
          sx={{ borderColor: C.border, color: C.textSub, "&:hover": { borderColor: "#3b82f6" } }}
        >
          {exporting ? "Exporting…" : "Export"}
        </Button>

        <Menu
          anchorEl={exportAnchor}
          open={Boolean(exportAnchor)}
          onClose={() => setExportAnchor(null)}
        >
          <MenuItem onClick={() => handleExport("csv")} sx={{ fontSize: "0.85rem", gap: 1.5 }}>
            <FileDownloadIcon sx={{ fontSize: 18, color: "#10b981" }} />
            Export as CSV
            <Typography variant="caption" sx={{ color: C.textMuted, ml: "auto", pl: 2 }}>
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select items first"}
            </Typography>
          </MenuItem>
          <MenuItem onClick={() => handleExport("json")} sx={{ fontSize: "0.85rem", gap: 1.5 }}>
            <FileDownloadIcon sx={{ fontSize: 18, color: "#3b82f6" }} />
            Export as JSON
            <Typography variant="caption" sx={{ color: C.textMuted, ml: "auto", pl: 2 }}>
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select items first"}
            </Typography>
          </MenuItem>
        </Menu>

        <Button
          variant="contained"
          startIcon={<AutoAwesome />}
          onClick={() => setLlmModalOpen(true)}
          disabled={selectedIds.size === 0 || selectedIds.size > 15}
          title={
            selectedIds.size === 0
              ? "Select at least one row to feed to LLM"
              : selectedIds.size > 15
              ? `Maximum 15 records allowed (${selectedIds.size} selected)`
              : undefined
          }
          sx={{
            bgcolor: "#3b82f6", color: "white",
            "&:hover": { bgcolor: "#2563eb" },
            "&.Mui-disabled": { bgcolor: "#1e3a5f", color: "#4b6ea8" },
          }}
        >
          Feed to LLM
          {selectedIds.size > 0 && (
            <Box component="span" sx={{
              ml: 1, px: 0.8, py: 0.1,
              bgcolor: selectedIds.size > 15 ? "rgba(239,68,68,0.4)" : "rgba(255,255,255,0.25)",
              borderRadius: 1, fontSize: "0.7rem", fontWeight: 700,
            }}>
              {selectedIds.size}{selectedIds.size > 15 ? " / 15 max" : ""}
            </Box>
          )}
        </Button>

        <Button
          variant="contained"
          startIcon={<PsychologyIcon />}
          onClick={() => setFeedToSBOpen(true)}
          disabled={selectedIds.size === 0}
          title={selectedIds.size === 0 ? "Select records to feed to Smart Brain" : undefined}
          sx={{
            bgcolor: "#7c3aed", color: "white",
            "&:hover":        { bgcolor: "#6d28d9" },
            "&.Mui-disabled": { bgcolor: "#3b2a6b", color: "#7c5cbf" },
          }}
        >
          Feed to Smart Brain
          {selectedIds.size > 0 && (
            <Box component="span" sx={{
              ml: 1, px: 0.8, py: 0.1,
              bgcolor: "rgba(255,255,255,0.2)",
              borderRadius: 1, fontSize: "0.7rem", fontWeight: 700,
            }}>
              {selectedIds.size}
            </Box>
          )}
        </Button>

        {selectedIds.size > 0 && (
          <Box sx={{
            display: "flex", alignItems: "center", gap: 1, ml: 1,
            px: 2, py: 0.5, bgcolor: selectionBg, borderRadius: 2, border: `1px solid ${selectionBdr}`,
          }}>
            <Typography variant="body2" sx={{ color: isDark ? "#93c5fd" : "#1d4ed8", fontWeight: 600 }}>
              {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""} selected
            </Typography>
            <Button size="small" onClick={clearSelection}
              sx={{ color: C.textMuted, minWidth: 0, p: 0, fontSize: "0.7rem",
                textTransform: "none", "&:hover": { color: "#ef4444", bgcolor: "transparent" } }}>
              Clear
            </Button>
          </Box>
        )}
      </Box>

      {/* Filters */}
      <Card sx={{ bgcolor: C.card, border: `1px solid ${C.border}`, mb: 2, boxShadow: C.shadow }}>
        <CardContent sx={{ p: { xs: 1.5, md: 2 } }}>
          <TextField
            placeholder="Search keywords, phrases… (empty = show all recent records)"
            fullWidth size="small"
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
            sx={{
              mb: 1.5,
              "& .MuiOutlinedInput-root": {
                color: C.text, bgcolor: C.inputBg,
                "& fieldset": { borderColor: C.border },
                "&:hover fieldset": { borderColor: "#3b82f6" },
              },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: C.textSub, fontSize: 18 }} />
                </InputAdornment>
              ),
              endAdornment: loading ? (
                <InputAdornment position="end">
                  <CircularProgress size={14} sx={{ color: "#3b82f6" }} />
                </InputAdornment>
              ) : null,
            }}
          />
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
            <FormControl size="small" sx={{ flex: 1, minWidth: 120 }}>
              <InputLabel sx={{ color: C.textSub, fontSize: "0.8rem" }}>Platform</InputLabel>
              <Select value={platform} label="Platform"
                onChange={(e) => {
                  const v = e.target.value;
                  setPlatform(v);
                  if (v !== "all" && v !== "facebook") setFbGroupFilter(null);
                  setOffset(0);
                }}
                sx={{ bgcolor: C.inputBg, color: C.text, fontSize: "0.8rem" }}>
                {PLATFORMS.map((p) => <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ flex: 1, minWidth: 120 }}>
              <InputLabel sx={{ color: C.textSub, fontSize: "0.8rem" }}>Date Range</InputLabel>
              <Select value={dateRange} label="Date Range"
                onChange={(e) => { setDateRange(e.target.value); setOffset(0); }}
                sx={{ bgcolor: C.inputBg, color: C.text, fontSize: "0.8rem" }}>
                <MenuItem value="all">All Time</MenuItem>
                <MenuItem value="24h">Last 24 Hours</MenuItem>
                <MenuItem value="7d">Last 7 Days</MenuItem>
                <MenuItem value="30d">Last 30 Days</MenuItem>
              </Select>
            </FormControl>

            {/* Facebook Group filter — only visible for Facebook / All Platforms */}
            {(platform === "all" || platform === "facebook") && Object.keys(fbGroupMap).length > 0 && (
              <FormControl size="small" sx={{ flex: 1, minWidth: 140 }}>
                <InputLabel sx={{ color: C.textSub, fontSize: "0.8rem" }}>Facebook Group</InputLabel>
                <Select
                  value={fbGroupFilter || ""}
                  label="Facebook Group"
                  onChange={(e) => { setFbGroupFilter(e.target.value || null); setOffset(0); }}
                  sx={{ bgcolor: C.inputBg, color: C.text, fontSize: "0.8rem" }}
                >
                  <MenuItem value="">All Groups</MenuItem>
                  {Object.entries(fbGroupMap).map(([url, name]) => (
                    <MenuItem key={url} value={url} sx={{ fontSize: "0.8rem" }}>{name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            <Autocomplete
              size="small"
              options={usedKeywords}
              value={scrapeKeyword}
              autoHighlight
              onChange={(_, val) => { setScrapeKeyword(val); setOffset(0); }}
              sx={{ flex: 1, minWidth: 150 }}
              ListboxProps={{ sx: { maxHeight: 220, overflowY: "auto" } }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Source Keyword"
                  placeholder="Filter by keyword used…"
                  sx={{
                    "& .MuiOutlinedInput-root": {
                      color: C.text, bgcolor: C.inputBg, fontSize: "0.8rem",
                      "& fieldset": { borderColor: C.border },
                      "&:hover fieldset": { borderColor: "#3b82f6" },
                    },
                    "& .MuiInputLabel-root": { color: C.textSub, fontSize: "0.8rem" },
                    "& .MuiAutocomplete-clearIndicator": { color: C.textSub },
                    "& .MuiAutocomplete-popupIndicator": { color: C.textSub },
                  }}
                />
              )}
              renderOption={(props, option) => (
                <Box component="li" {...props} sx={{ fontSize: "0.8rem", color: C.text, bgcolor: C.card,
                  "&:hover": { bgcolor: C.hover } }}>
                  {option}
                </Box>
              )}
              PaperComponent={({ children }) => (
                <Box sx={{ bgcolor: C.card, border: `1px solid ${C.border}`, borderRadius: 1, boxShadow: C.shadow }}>
                  {children}
                </Box>
              )}
              noOptionsText={
                <Typography sx={{ fontSize: "0.78rem", color: C.textSub, px: 1 }}>
                  No keywords found
                </Typography>
              }
            />
            <IconButton size="small" title="Reset filters"
              onClick={() => { setSearchInput(""); setSearch(""); setPlatform("all"); setDateRange("all"); setScrapeKeyword(null); setFbGroupFilter(null); setOffset(0); }}
              sx={{ color: "#3b82f6", border: `1px solid ${C.border}` }}>
              <FilterListIcon fontSize="small" />
            </IconButton>
          </Box>
        </CardContent>
      </Card>

      {/* Results table */}
      <Card sx={{ bgcolor: C.card, border: `1px solid ${C.border}`, overflow: "hidden", boxShadow: C.shadow }}>

        {/* Select-all bar */}
        <Box sx={{ px: 2, py: 1, borderBottom: `1px solid ${C.border}`, display: "flex",
          alignItems: "center", justifyContent: "space-between" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Checkbox size="small"
              checked={allOnPageSelected}
              indeterminate={someOnPageSelected && !allOnPageSelected}
              onChange={togglePageAll}
              sx={{ color: "#3b82f6", p: 0.5 }} />
            <Typography variant="caption" sx={{ color: C.textSub }}>
              {allOnPageSelected
                ? `All ${rows.length} on this page selected`
                : someOnPageSelected
                ? `${rows.filter((r) => selectedIds.has(r.uid)).length} on this page selected`
                : `Select All on Page (${rows.length})`}
            </Typography>
          </Box>
          <IconButton size="small" onClick={handleDelete} disabled={selectedIds.size === 0}
            sx={{ color: selectedIds.size > 0 ? "#ef4444" : C.border }}>
            <Delete fontSize="small" />
          </IconButton>
        </Box>

        {loading && (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <CircularProgress size={28} sx={{ color: "#3b82f6" }} />
            <Typography variant="body2" sx={{ color: C.textSub, mt: 1 }}>Loading…</Typography>
          </Box>
        )}

        {!loading && rows.length === 0 && (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <Typography variant="body2" sx={{ color: C.textSub }}>
              No records found. Start a collection first or try a different filter.
            </Typography>
          </Box>
        )}

        {/* Mobile cards */}
        {!loading && rows.length > 0 && (
          <Box sx={{ display: { xs: "block", md: "none" } }}>
            {rows.map((row, idx) => (
              <Box key={row.uid} sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${C.border}`, display: "flex", gap: 1 }}>
                <Checkbox size="small" checked={isSelected(row.uid)} onChange={() => toggleOne(row)}
                  sx={{ color: "#3b82f6", p: 0.5, mt: 0.3, flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                    <Typography sx={{ color: C.text, fontWeight: 600, fontSize: "0.75rem" }}>
                      {serialStart + idx}
                    </Typography>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <IconButton size="small" onClick={() => setViewRow(row)}
                        sx={{ p: 0.3, color: C.textMuted, "&:hover": { color: "#3b82f6" } }}>
                        <VisibilityIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </Box>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.5, flexWrap: "wrap" }}>
                    <Chip label={PLATFORM_LABELS[row.platform] || row.platform} size="small"
                      sx={{ bgcolor: C.hover, color: C.textSub, fontSize: "0.6rem", height: 18 }} />
                    {row.groupName && (
                      <Typography sx={{ color: C.textMuted, fontSize: "0.6rem" }}>
                        {row.groupName}
                      </Typography>
                    )}
                  </Box>
                  <Typography sx={{ color: C.text, fontSize: "0.75rem", lineHeight: 1.4 }}>{row.content}</Typography>
                  {row.author && <Typography sx={{ color: C.textMuted, fontSize: "0.65rem" }}>by {row.author}</Typography>}
                  <Typography sx={{ color: C.textMuted, fontSize: "0.65rem" }}>{formatDate(row.date)}</Typography>
                </Box>
              </Box>
            ))}
          </Box>
        )}

        {/* Desktop table */}
        {!loading && rows.length > 0 && (
          <Box sx={{ display: { xs: "none", md: "block" }, overflowX: "auto" }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox size="small"
                      checked={allOnPageSelected}
                      indeterminate={someOnPageSelected && !allOnPageSelected}
                      onChange={togglePageAll}
                      sx={{ color: "#3b82f6" }} />
                  </TableCell>
                  <TableCell>ID</TableCell>
                  <TableCell>Platform</TableCell>
                  <TableCell>Extracted Content</TableCell>
                  <TableCell sx={{ width: 140 }}>Keyword</TableCell>
                  <TableCell sx={{ width: 140 }}>Author</TableCell>
                  <TableCell sx={{ width: 160 }}>Date Collected</TableCell>
                  <TableCell padding="none" sx={{ width: 44 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row, idx) => (
                  <TableRow key={row.uid}
                    sx={{
                      height: 48,
                      bgcolor: isSelected(row.uid)
                        ? selectionBg + "60"
                        : idx % 2 === 0 ? C.card : C.cardInner,
                    }}>
                    <TableCell padding="checkbox">
                      <Checkbox size="small" checked={isSelected(row.uid)}
                        onChange={() => toggleOne(row)} sx={{ color: "#3b82f6" }} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ color: C.text, fontWeight: 500,
                        whiteSpace: "nowrap", fontSize: "0.78rem" }}>
                        {serialStart + idx}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={PLATFORM_LABELS[row.platform] || row.platform} size="small"
                        sx={{ bgcolor: C.hover, color: C.textSub, fontWeight: 600, fontSize: "0.72rem" }} />
                      {row.groupName && (
                        <Tooltip title={row._raw.group_url || ""} placement="top" arrow>
                          <Typography sx={{
                            color: C.textMuted, fontSize: "0.62rem", mt: 0.4,
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                            maxWidth: 110, cursor: "default",
                          }}>
                            {row.groupName}
                          </Typography>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 300 }}>
                      <Tooltip title={row.content} placement="top" arrow
                        componentsProps={{ tooltip: { sx: { maxWidth: 420, fontSize: "0.75rem", lineHeight: 1.5 } } }}>
                        <Typography variant="body2" sx={{ color: C.text, overflow: "hidden",
                          textOverflow: "ellipsis", display: "-webkit-box",
                          WebkitLineClamp: 1, WebkitBoxOrient: "vertical", cursor: "default" }}>
                          {row.content}
                        </Typography>
                      </Tooltip>
                      {row.url && (
                        <Typography component="a" href={row.url} target="_blank" rel="noreferrer"
                          variant="caption" sx={{ color: "#3b82f6", textDecoration: "none",
                            "&:hover": { textDecoration: "underline" } }}>
                          View source ↗
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ width: 140 }}>
                      <Tooltip title={row.keyword && row.keyword.length > 14 ? row.keyword : ""} placement="top" arrow>
                        <Typography variant="body2" sx={{ color: C.textSub,
                          whiteSpace: "nowrap", fontSize: "0.78rem" }}>
                          {row.keyword
                            ? (row.keyword.length > 14 ? row.keyword.slice(0, 14) + "…" : row.keyword)
                            : "—"}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ width: 140 }}>
                      <Tooltip title={row.author && row.author.length > 13 ? row.author : ""} placement="top" arrow>
                        <Typography variant="body2" sx={{ color: C.textSub,
                          whiteSpace: "nowrap", fontSize: "0.78rem" }}>
                          {row.author ? (row.author.length > 13 ? row.author.slice(0, 13) + "…" : row.author) : "—"}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ color: C.textSub,
                        whiteSpace: "nowrap", fontSize: "0.78rem" }}>
                        {formatDate(row.scrapedAt || row.date)}
                      </Typography>
                    </TableCell>
                    <TableCell padding="none" sx={{ pr: 1 }}>
                      <IconButton
                        size="small"
                        title="View full record"
                        onClick={() => setViewRow(row)}
                        sx={{
                          color: C.textMuted,
                          "&:hover": { color: "#3b82f6", bgcolor: "transparent" },
                        }}
                      >
                        <VisibilityIcon sx={{ fontSize: 17 }} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* Pagination */}
        <Box sx={{ px: 2, py: 1.5, display: "flex", justifyContent: "space-between",
          alignItems: "center", borderTop: `1px solid ${C.border}`, flexWrap: "wrap", gap: 1 }}>
          <Typography variant="body2" sx={{ color: C.textSub, fontSize: { xs: "0.7rem", md: "0.875rem" } }}>
            {total === 0 ? "No results" : `Showing ${startRow}–${endRow} of ${total.toLocaleString()} results`}
          </Typography>
          <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
            <Button size="small" disabled={!hasPrev} onClick={goFirst}
              sx={{ color: hasPrev ? C.textSub : C.border, minWidth: 0, px: 1, fontSize: "0.8rem" }}>«</Button>
            <Button size="small" disabled={!hasPrev} onClick={goPrev}
              sx={{ color: hasPrev ? C.textSub : C.border, minWidth: 0, px: 1 }}>Prev</Button>
            <Typography variant="body2" sx={{ color: C.textMuted, px: 1, lineHeight: "30px", fontSize: "0.8rem" }}>
              Page {currentPage + 1} of {totalPages}
            </Typography>
            <Button size="small" disabled={!hasNext} onClick={goNext}
              sx={{ color: hasNext ? "#3b82f6" : C.border, fontWeight: 600, minWidth: 0, px: 1 }}>Next</Button>
            <Button size="small" disabled={!hasNext} onClick={goLast}
              sx={{ color: hasNext ? C.textSub : C.border, minWidth: 0, px: 1, fontSize: "0.8rem" }}>»</Button>
          </Box>
        </Box>
      </Card>

      <LLMFeedModal
        open={llmModalOpen}
        onClose={() => setLlmModalOpen(false)}
        selectedRows={[...selectedRowMap.values()]}
        onNavigateToConfig={() => navigate("/llm-config")}
      />

      <FeedToSmartBrainModal
        open={feedToSBOpen}
        onClose={() => setFeedToSBOpen(false)}
        selectedRows={[...selectedRowMap.values()]}
      />

      <RecordDetailModal
        open={Boolean(viewRow)}
        onClose={() => setViewRow(null)}
        row={viewRow}
      />

      <Snackbar open={toast.open} autoHideDuration={4000}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        <Alert severity={toast.severity} onClose={() => setToast((t) => ({ ...t, open: false }))}
          sx={{ bgcolor: C.hover, color: C.text, "& .MuiAlert-icon": { color: "inherit" } }}>
          {toast.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Results;
