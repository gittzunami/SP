import React, { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "../api";
import { useNavigate } from "react-router-dom";
import {
  Box, Typography, Button, Chip, Divider, IconButton,
  Collapse, Tooltip, Stack, Menu, MenuItem, ListItemIcon,
  ListItemText, TextField, InputAdornment, CircularProgress,
  Alert, useTheme, useMediaQuery,
} from "@mui/material";
import PsychologyIcon        from "@mui/icons-material/Psychology";
import FileDownloadIcon      from "@mui/icons-material/FileDownload";
import AutoAwesomeIcon       from "@mui/icons-material/AutoAwesome";
import ContentCopyIcon       from "@mui/icons-material/ContentCopy";
import ExpandMoreIcon        from "@mui/icons-material/ExpandMore";
import ExpandLessIcon        from "@mui/icons-material/ExpandLess";
import ArticleIcon           from "@mui/icons-material/Article";
import TextSnippetIcon       from "@mui/icons-material/TextSnippet";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import HistoryIcon           from "@mui/icons-material/History";
import ChevronLeftIcon       from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon      from "@mui/icons-material/ChevronRight";
import DeleteOutlineIcon     from "@mui/icons-material/DeleteOutline";
import CalendarTodayIcon     from "@mui/icons-material/CalendarToday";
import CloseIcon             from "@mui/icons-material/Close";
import CheckIcon             from "@mui/icons-material/Check";
import FolderOpenIcon        from "@mui/icons-material/FolderOpen";
import SaveIcon              from "@mui/icons-material/Save";
import CheckCircleIcon       from "@mui/icons-material/CheckCircle";
import SearchIcon            from "@mui/icons-material/Search";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { useAppTheme }       from "../AppThemeContext";

const API_BASE       = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const SB_PROMPT_KEY  = "sbPrompt";
const SB_RESULT_KEY  = "sbLastResult";   // set to "1" by FeedToSmartBrainModal as a redirect signal
const SIDEBAR_KEY    = "sbSidebarOpen";
const SIDEBAR_WIDTH  = 272;

const PROVIDER_COLORS = { openai: "#10a37f", anthropic: "#d97757", gemini: "#4285f4" };
const PROVIDER_LABELS = { openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini" };

// ── DB helpers ────────────────────────────────────────────────────────────────
const API_BASE_SB = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

async function fetchHistoryFromDB() {
  try {
    const { apiFetch } = await import("../api");
    const res = await apiFetch(`${API_BASE_SB}/api/smart-brain/history`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.analyses || []).map(a => ({ ...a, id: String(a.id) }));
  } catch { return []; }
}

async function deleteFromDB(id) {
  try {
    const { apiFetch } = await import("../api");
    await apiFetch(`${API_BASE_SB}/api/smart-brain/history/${id}`, { method: "DELETE" });
  } catch {}
}

function hasPending() {
  return localStorage.getItem(SB_RESULT_KEY) === "1";
}
function clearPending() {
  localStorage.removeItem(SB_RESULT_KEY);
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function formatDateTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
}
function formatDateShort(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
}
function toDateStr(iso) {
  if (!iso) return "";
  try { return new Date(iso).toISOString().slice(0, 10); } catch { return ""; }
}
function groupByDay(entries) {
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const groups    = {};
  for (const e of entries) {
    const day   = toDateStr(e.timestamp);
    const label = day === today ? "Today" : day === yesterday ? "Yesterday" : day || "Unknown";
    if (!groups[label]) groups[label] = [];
    groups[label].push(e);
  }
  return groups;
}

// ── TXT download ──────────────────────────────────────────────────────────────
function downloadText(content, filename) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: filename, style: "display:none" });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
}

// ── DOCX helpers ──────────────────────────────────────────────────────────────
function parseInlineDocx(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(part => {
    if (part.startsWith("**") && part.endsWith("**"))
      return new TextRun({ text: part.slice(2, -2), bold: true });
    return new TextRun({ text: part });
  });
}

async function buildDocxBlob(result, provLabel, dateLabel) {
  const metaStyle  = { size: 20, color: "555555" };
  const paragraphs = [
    new Paragraph({ children: [new TextRun({ text: "Smart Brain — AI Analysis", bold: true, size: 32 })], spacing: { after: 120 } }),
    new Paragraph({ children: [new TextRun({ text: `Generated : ${dateLabel}`, ...metaStyle })], spacing: { after: 60 } }),
    new Paragraph({ children: [new TextRun({ text: `Provider  : ${provLabel}${result.model ? ` (${result.model})` : ""}`, ...metaStyle })], spacing: { after: 60 } }),
    new Paragraph({ children: [new TextRun({ text: `Records   : ${result.record_count || "—"}`, ...metaStyle })], spacing: { after: 60 } }),
    new Paragraph({ children: [new TextRun({ text: `Tokens    : ${(result.tokens_used || 0).toLocaleString()}`, ...metaStyle })], spacing: { after: 240 } }),
    new Paragraph({ children: [new TextRun({ text: "ANALYSIS REQUEST", bold: true, size: 24, color: "444444" })], spacing: { before: 120, after: 80 } }),
    new Paragraph({ children: [new TextRun({ text: result.prompt_used || "—", size: 20, color: "333333" })], spacing: { after: 240 } }),
    new Paragraph({ children: [new TextRun({ text: "AI RESPONSE", bold: true, size: 24, color: "444444" })], spacing: { before: 120, after: 120 } }),
  ];

  const lines = (result.result || "").split("\n");
  let i = 0, ni = 1;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }
    if (t.startsWith("# "))    { ni=1; paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: parseInlineDocx(t.slice(2)),  spacing: { before: 240, after: 80  } })); i++; continue; }
    if (t.startsWith("## "))   { ni=1; paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: parseInlineDocx(t.slice(3)),  spacing: { before: 200, after: 60  } })); i++; continue; }
    if (t.startsWith("### "))  { ni=1; paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: parseInlineDocx(t.slice(4)),  spacing: { before: 160, after: 60  } })); i++; continue; }
    if (t.startsWith("#### ")) { ni=1; paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_4, children: parseInlineDocx(t.slice(5)),  spacing: { before: 120, after: 40  } })); i++; continue; }
    if (t === "---" || t === "***") {
      paragraphs.push(new Paragraph({ children: [new TextRun({ text: "─────────────────────────────────────", color: "AAAAAA" })], spacing: { before: 120, after: 120 } }));
      i++; continue;
    }
    if (t.startsWith("- ") || t.startsWith("* ")) {
      while (i < lines.length) {
        const s = lines[i].trim();
        if (s.startsWith("- ") || s.startsWith("* ")) {
          paragraphs.push(new Paragraph({ children: [new TextRun({ text: "• " }), ...parseInlineDocx(s.slice(2))], indent: { left: 720 }, spacing: { after: 40 } }));
          i++;
        } else if (!s) { i++; break; } else break;
      }
      continue;
    }
    if (/^\d+\.\s/.test(t)) {
      while (i < lines.length) {
        const s = lines[i].trim();
        if (/^\d+\.\s/.test(s)) {
          paragraphs.push(new Paragraph({ children: [new TextRun({ text: `${ni}. `, bold: true }), ...parseInlineDocx(s.replace(/^\d+\.\s/, ""))], indent: { left: 720 }, spacing: { after: 40 } }));
          ni++; i++;
        } else if (!s) { i++; break; } else break;
      }
      continue;
    }
    const paraLines = [];
    while (i < lines.length) {
      const s = lines[i].trim();
      if (!s) { i++; break; }
      if (/^#{1,4}\s/.test(s) || s.startsWith("- ") || s.startsWith("* ") || /^\d+\.\s/.test(s) || s === "---") break;
      paraLines.push(s); i++;
    }
    if (paraLines.length)
      paragraphs.push(new Paragraph({ children: parseInlineDocx(paraLines.join(" ")), spacing: { after: 80 } }));
  }

  return await Packer.toBlob(new Document({ sections: [{ children: paragraphs }] }));
}

// ── Inline markdown ───────────────────────────────────────────────────────────
function parseInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link)
      return <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer"
        style={{ color: "#a78bfa", textDecoration: "underline", wordBreak: "break-all" }}>{link[1]}</a>;
    return part || null;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  Stat summary cards — shared helpers
// ══════════════════════════════════════════════════════════════════════════════

function parseSbSummaryStats(text, recordCount) {
  const lines = (text || "").split("\n");
  const kv = {};
  let inKM = false;
  for (const line of lines) {
    const t = line.trim();
    if (/^##\s+key\s+metrics?$/i.test(t)) { inKM = true; continue; }
    if (t.startsWith("## ") && inKM) break;
    if (inKM) {
      const m = t.match(/^\*\*([^*]+)\*\*:\s*(.+)$/);
      if (m) kv[m[1].trim().toLowerCase()] = m[2].trim();
    }
  }
  let pos = parseInt(kv["positive sentiment"] || kv["positive"] || "") || null;
  let neg = parseInt(kv["negative sentiment"] || kv["negative"] || "") || null;
  if (!pos && !neg) {
    const sm = (text || "").match(/\*\*sentiment\*\*:\s*(\w+)/i);
    if (sm) {
      const sv = sm[1].toLowerCase();
      if (/positive|bullish|good|great|strong/.test(sv)) { pos = 65; neg = 35; }
      else if (/negative|bearish|bad|poor|weak/.test(sv)) { pos = 30; neg = 70; }
      else { pos = 50; neg = 50; }
    }
  }
  return {
    recordCount: recordCount || 0,
    pos, neg, hasSentiment: pos !== null || neg !== null,
    keyFindings: parseInt(kv["key findings"] || kv["findings"] || kv["insights"]) || null,
    keyTopics: parseInt(kv["key topics"] || kv["topics"] || kv["themes"]) || null,
    risks: parseInt(kv["risks"] || kv["risks identified"]) || null,
    opportunities: parseInt(kv["opportunities"] || kv["opportunities found"]) || null,
  };
}

function SbSentimentBar({ pos, neg, isDark, showLabels = true }) {
  const posP = pos !== null ? Math.min(100, Math.max(0, pos)) : 50;
  const negP = neg !== null ? Math.min(100, Math.max(0, neg)) : 50;
  const hasData = pos !== null;
  const overallLabel = !hasData ? "No data" : posP > negP ? "Positive overall" : posP < negP ? "Negative overall" : "Balanced";
  const overallColor = !hasData ? "#9ca3af" : posP > negP ? "#10b981" : posP < negP ? "#ef4444" : "#f59e0b";
  return (
    <Box>
      <Box sx={{ position: "relative", height: 7, borderRadius: 4, overflow: "hidden", bgcolor: isDark ? "#1f2937" : "#e5e7eb", mb: showLabels ? 0.75 : 0 }}>
        <Box sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${posP}%`, bgcolor: "#10b981", borderRadius: "4px 0 0 4px", transition: "width 0.8s cubic-bezier(0.34,1.56,0.64,1)" }} />
        <Box sx={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${negP}%`, bgcolor: "#ef4444", borderRadius: "0 4px 4px 0", transition: "width 0.8s cubic-bezier(0.34,1.56,0.64,1)" }} />
      </Box>
      {showLabels && (
        <>
          <Typography sx={{ fontSize: "0.7rem", fontWeight: 700, color: overallColor, mb: 0.3, lineHeight: 1 }}>{overallLabel}</Typography>
          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
            <Typography sx={{ fontSize: "0.61rem", color: "#10b981", fontWeight: 600, lineHeight: 1 }}>+{posP}%</Typography>
            <Typography sx={{ fontSize: "0.61rem", color: "#ef4444", fontWeight: 600, lineHeight: 1 }}>-{negP}%</Typography>
          </Box>
        </>
      )}
    </Box>
  );
}

function SbKpiCard({ title, accent, C, isDark, children }) {
  return (
    <Box sx={{
      flex: 1, minWidth: 0,
      borderRadius: "11px", border: `1px solid ${accent}28`,
      bgcolor: isDark ? `${accent}0c` : `${accent}06`,
      overflow: "hidden", position: "relative",
      transition: "transform 0.15s ease, box-shadow 0.18s ease",
      "&:hover": { transform: "translateY(-2px)", boxShadow: `0 8px 24px ${accent}22, 0 0 0 1px ${accent}40`, borderColor: `${accent}44` },
    }}>
      <Box sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, bgcolor: accent, boxShadow: `2px 0 8px ${accent}55` }} />
      <Box sx={{ pl: 1.75, pr: 1.5, pt: 1.25, pb: 1.25 }}>
        <Typography sx={{ fontSize: "0.54rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.9, color: accent, mb: 0.75, lineHeight: 1, display: "block" }}>
          {title}
        </Typography>
        {children}
      </Box>
    </Box>
  );
}

// Smart Brain: up to 6 KPI cards
function SbStatCardsRow({ text, recordCount, C, isDark }) {
  const s = parseSbSummaryStats(text, recordCount);
  return (
    <Box sx={{ display: "flex", gap: 1.25, overflowX: "auto", pb: 0.5, mb: 2.25,
      "&::-webkit-scrollbar": { height: 4 },
      "&::-webkit-scrollbar-thumb": { bgcolor: isDark ? "#374151" : "#d1d5db", borderRadius: 4 },
    }}>
      <SbKpiCard title="Records Analyzed" accent="#3b82f6" C={C} isDark={isDark}>
        <Typography sx={{ fontSize: "1.85rem", fontWeight: 900, color: "#3b82f6", lineHeight: 1, mb: 0.25 }}>{s.recordCount}</Typography>
        <Typography sx={{ fontSize: "0.62rem", color: C.textMuted, lineHeight: 1.3 }}>Input data</Typography>
      </SbKpiCard>

      <SbKpiCard title="Sentiment" accent="#f59e0b" C={C} isDark={isDark}>
        <SbSentimentBar pos={s.pos} neg={s.neg} isDark={isDark} showLabels={s.hasSentiment} />
        {!s.hasSentiment && <Typography sx={{ fontSize: "0.62rem", color: "#f59e0b", fontWeight: 600, mt: 0.5, lineHeight: 1 }}>Needs attention</Typography>}
      </SbKpiCard>

      {s.keyFindings !== null && (
        <SbKpiCard title="Key Findings" accent="#7c3aed" C={C} isDark={isDark}>
          <Typography sx={{ fontSize: "1.85rem", fontWeight: 900, color: "#7c3aed", lineHeight: 1, mb: 0.25 }}>{s.keyFindings}</Typography>
          <Typography sx={{ fontSize: "0.62rem", color: C.textMuted, lineHeight: 1.3 }}>Insights</Typography>
        </SbKpiCard>
      )}

      {s.keyTopics !== null && (
        <SbKpiCard title="Key Topics" accent="#06b6d4" C={C} isDark={isDark}>
          <Typography sx={{ fontSize: "1.85rem", fontWeight: 900, color: "#06b6d4", lineHeight: 1, mb: 0.25 }}>{s.keyTopics}</Typography>
          <Typography sx={{ fontSize: "0.62rem", color: C.textMuted, lineHeight: 1.3 }}>Identified</Typography>
        </SbKpiCard>
      )}

      {s.opportunities !== null && (
        <SbKpiCard title="Opportunities" accent="#10b981" C={C} isDark={isDark}>
          <Typography sx={{ fontSize: "1.85rem", fontWeight: 900, color: "#10b981", lineHeight: 1, mb: 0.25 }}>{s.opportunities}</Typography>
          <Typography sx={{ fontSize: "0.62rem", color: C.textMuted, lineHeight: 1.3 }}>Identified</Typography>
        </SbKpiCard>
      )}

      {s.risks !== null && (
        <SbKpiCard title="Risks" accent="#ef4444" C={C} isDark={isDark}>
          <Typography sx={{ fontSize: "1.85rem", fontWeight: 900, color: "#ef4444", lineHeight: 1, mb: 0.25 }}>{s.risks}</Typography>
          <Typography sx={{ fontSize: "0.62rem", color: C.textMuted, lineHeight: 1.3 }}>Flagged</Typography>
        </SbKpiCard>
      )}
    </Box>
  );
}

const SB_TOPIC_CHIP_COLORS = ["#3b82f6","#7c3aed","#10b981","#f59e0b","#06b6d4","#ec4899","#a78bfa","#059669","#c2410c","#4338ca"];

// ══════════════════════════════════════════════════════════════════════════════
//  Smart Brain Grid Renderer — vivid cards, varied layout, strategy indicators
// ══════════════════════════════════════════════════════════════════════════════

const SB_PALETTE = [
  "#7c3aed", "#2563eb", "#059669", "#dc2626",
  "#b45309", "#0e7490", "#9d174d", "#4338ca",
  "#0f766e", "#c2410c",
];

// Span pattern (out of 12 grid columns). Rows sum to 12:
//   7+5, 5+7, 4+4+4, 8+4, 6+6, 12, then repeat
const SB_SPAN_PATTERN = [7, 5, 5, 7, 4, 4, 4, 8, 4, 6, 6, 12];
function getSbSpan(idx) {
  if (idx === 0) return 12;
  return SB_SPAN_PATTERN[(idx - 1) % SB_SPAN_PATTERN.length];
}

function sbMetricColor(value) {
  const v = (value || "").toLowerCase().trim();
  if (/^(positive|true|yes|high|strong|growing|bullish|rising|confirmed|good|excellent|great|favorable|upward|increasing|above average)/.test(v)) return "#10b981";
  if (/^(negative|false|no|low|weak|declining|bearish|falling|unconfirmed|bad|poor|unfavorable|downward|decreasing|below average)/.test(v)) return "#ef4444";
  if (/^(neutral|mixed|moderate|medium|average|stable|balanced|inconclusive|unclear|uncertain)/.test(v)) return "#f59e0b";
  if (/\d+%/.test(v)) return "#8b5cf6";
  if (/^\d+[\/.]\d+/.test(v)) return "#3b82f6";
  return null;
}

function getBinaryInfo(value) {
  const PAIRS = {
    positive:  [["Positive", "Negative"], true],
    negative:  [["Positive", "Negative"], false],
    true:      [["True",     "False"   ], true],
    false:     [["True",     "False"   ], false],
    yes:       [["Yes",      "No"      ], true],
    no:        [["Yes",      "No"      ], false],
    high:      [["High",     "Low"     ], true],
    low:       [["High",     "Low"     ], false],
    bullish:   [["Bullish",  "Bearish" ], true],
    bearish:   [["Bullish",  "Bearish" ], false],
    rising:    [["Rising",   "Falling" ], true],
    falling:   [["Rising",   "Falling" ], false],
    strong:    [["Strong",   "Weak"    ], true],
    weak:      [["Strong",   "Weak"    ], false],
    growing:   [["Growing",  "Declining"], true],
    declining: [["Growing",  "Declining"], false],
    confirmed: [["Confirmed","Unconfirmed"], true],
    unconfirmed:[["Confirmed","Unconfirmed"], false],
  };
  const first = (value || "").toLowerCase().trim().split(/\s+/)[0];
  if (!PAIRS[first]) return null;
  const [pair, isPositive] = PAIRS[first];
  return { pair, isPositive };
}

// Single metric indicator — split toggle pill for binary values, color chip otherwise
function SbMetricChip({ label, value, isDark }) {
  const binary  = getBinaryInfo(value);
  const mColor  = sbMetricColor(value) || "#a78bfa";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 86 }}>
      <Typography sx={{
        fontSize: "0.56rem", fontWeight: 700, textTransform: "uppercase",
        letterSpacing: 1, lineHeight: 1,
        color: isDark ? "#9ca3af" : "#6b7280",
      }}>
        {label}
      </Typography>

      {binary ? (
        <Box sx={{
          display: "flex", borderRadius: "16px", overflow: "hidden", height: 28,
          border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
        }}>
          {/* Left side */}
          <Box sx={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "0.68rem", fontWeight: 700,
            bgcolor: binary.isPositive ? "#10b981cc" : isDark ? "#10b98118" : "#10b98110",
            color: binary.isPositive ? "#fff" : isDark ? "#10b98155" : "#10b98144",
            transition: "background 0.2s",
            borderRight: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
          }}>
            {binary.pair[0]}
          </Box>
          {/* Right side */}
          <Box sx={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "0.68rem", fontWeight: 700,
            bgcolor: !binary.isPositive ? "#ef4444cc" : isDark ? "#ef444418" : "#ef444410",
            color: !binary.isPositive ? "#fff" : isDark ? "#ef444455" : "#ef444444",
            transition: "background 0.2s",
          }}>
            {binary.pair[1]}
          </Box>
        </Box>
      ) : (
        <Box sx={{
          px: 1.25, height: 28, display: "flex", alignItems: "center",
          borderRadius: "16px", fontSize: "0.75rem", fontWeight: 800, whiteSpace: "nowrap",
          bgcolor: isDark ? `${mColor}20` : `${mColor}12`,
          border: `1px solid ${mColor}50`,
          color: mColor,
        }}>
          {value}
        </Box>
      )}
    </Box>
  );
}

// Scan all sections for **Label**: Value lines — return top 8 unique metrics
function extractSbMetrics(sections) {
  const seen = new Set();
  const out  = [];
  for (const sec of sections) {
    for (const line of sec.lines) {
      const m = line.trim().match(/^\*\*([^*]+)\*\*:\s*(.+)$/);
      if (m && !seen.has(m[1].trim().toLowerCase())) {
        seen.add(m[1].trim().toLowerCase());
        out.push({ label: m[1].trim(), value: m[2].trim() });
        if (out.length >= 8) return out;
      }
    }
  }
  return out;
}

// Same section-splitting logic as Trends
function parseSbSections(text) {
  if (!text) return { pageTitle: null, sections: [] };
  const lines = text.split("\n");
  let pageTitle = null;
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const trim = line.trim();
    if (trim.startsWith("# ")) { if (!pageTitle) pageTitle = trim.slice(2); continue; }
    if (trim.startsWith("## ")) {
      if (cur && (cur.title || cur.lines.some(l => l.trim()))) sections.push(cur);
      cur = { title: trim.slice(3), lines: [], sub: [] };
      continue;
    }
    if (trim.startsWith("### ")) {
      if (cur) {
        cur.sub.push({ title: trim.slice(4), lines: [] });
      }
      continue;
    }
    if (!cur) cur = { title: null, lines: [], sub: [] };
    if (cur.sub.length > 0) {
      cur.sub[cur.sub.length - 1].lines.push(line);
    } else {
      cur.lines.push(line);
    }
  }
  if (cur && (cur.title || cur.lines.some(l => l.trim()))) sections.push(cur);
  return { pageTitle, sections };
}

// Section body renderer with SbMetricChip support
function SbSectionContent({ lines, C, isDark, accent }) {
  const blocks = [];
  let key = 0, i = 0;

  while (i < lines.length) {
    const trim = lines[i].trim();
    if (!trim) { i++; continue; }

    if (trim.startsWith("### ")) {
      blocks.push(
        <Box key={key++} sx={{ display: "flex", alignItems: "center", gap: 1, mt: blocks.length ? 1.75 : 0, mb: 0.6 }}>
          <Box sx={{ width: 3, height: 13, borderRadius: 4, bgcolor: accent, flexShrink: 0, opacity: 0.7 }} />
          <Typography sx={{ fontWeight: 700, fontSize: "0.84rem", color: C.text, letterSpacing: 0.1 }}>
            {parseInline(trim.slice(4))}
          </Typography>
        </Box>
      );
      i++; continue;
    }

    if (trim.startsWith("#### ")) {
      blocks.push(
        <Typography key={key++} sx={{
          fontWeight: 600, fontSize: "0.69rem", color: accent,
          textTransform: "uppercase", letterSpacing: 1, mt: 1.2, mb: 0.4,
        }}>
          {parseInline(trim.slice(5))}
        </Typography>
      );
      i++; continue;
    }

    if (trim.startsWith("- ") || trim.startsWith("* ")) {
      const items = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t.startsWith("- ") || t.startsWith("* ")) { items.push(t.slice(2)); i++; }
        else if (!t) { i++; break; } else break;
      }
      blocks.push(
        <Box key={key++} sx={{ mt: 0.5, mb: 0.75 }}>
          {items.map((item, j) => (
            <Box key={j} sx={{ display: "flex", alignItems: "flex-start", gap: 1.25, mb: 0.55 }}>
              <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: accent, mt: "7px", flexShrink: 0, boxShadow: `0 0 0 2px ${accent}22, 0 0 5px ${accent}40` }} />
              <Typography variant="body2" sx={{ color: C.textSub, lineHeight: 1.75, fontSize: "0.85rem" }}>
                {parseInline(item)}
              </Typography>
            </Box>
          ))}
        </Box>
      );
      continue;
    }

    if (/^\d+\.\s/.test(trim)) {
      const items = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (/^\d+\.\s/.test(t)) { items.push(t.replace(/^\d+\.\s/, "")); i++; }
        else if (!t) { i++; break; } else break;
      }
      blocks.push(
        <Box key={key++} sx={{ mt: 0.5, mb: 0.75 }}>
          {items.map((item, j) => (
            <Box key={j} sx={{ display: "flex", alignItems: "flex-start", gap: 1.25, mb: 0.7 }}>
              <Box sx={{
                minWidth: 22, height: 22, borderRadius: "50%",
                bgcolor: `${accent}1e`, border: `1.5px solid ${accent}`,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, mt: "1px",
              }}>
                <Typography sx={{ fontSize: "0.57rem", fontWeight: 800, color: accent, lineHeight: 1 }}>{j + 1}</Typography>
              </Box>
              <Typography variant="body2" sx={{ color: C.textSub, lineHeight: 1.75, fontSize: "0.85rem" }}>
                {parseInline(item)}
              </Typography>
            </Box>
          ))}
        </Box>
      );
      continue;
    }

    if (trim === "---" || trim === "***" || trim === "___") {
      blocks.push(
        <Box key={key++} sx={{ my: 1.5, height: "1px", background: `linear-gradient(90deg, ${accent}44 0%, ${accent}18 60%, transparent 100%)` }} />
      );
      i++; continue;
    }

    // Metric chips: **Label**: Value — binary split pill or color chip
    if (/^\*\*[^*]+\*\*:\s*\S/.test(trim)) {
      const metrics = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (/^\*\*[^*]+\*\*:\s*\S/.test(t)) {
          const m = t.match(/^\*\*([^*]+)\*\*:\s*(.+)$/);
          if (m) metrics.push({ label: m[1].trim(), value: m[2].trim() });
          i++;
        } else if (!t) { i++; break; } else break;
      }
      if (metrics.length) {
        blocks.push(
          <Box key={key++} sx={{ display: "flex", flexWrap: "wrap", gap: 1.25, mt: 0.75, mb: 1.25 }}>
            {metrics.map((m, j) => (
              <SbMetricChip key={j} label={m.label} value={m.value} isDark={isDark} />
            ))}
          </Box>
        );
      }
      continue;
    }

    // Paragraph (break on metric lines)
    const paraLines = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t) { i++; break; }
      if (/^#{1,4}\s/.test(t) || t.startsWith("- ") || t.startsWith("* ") ||
          /^\d+\.\s/.test(t) || t === "---" || t.startsWith("|") ||
          /^\*\*[^*]+\*\*:\s*\S/.test(t)) break;
      paraLines.push(t); i++;
    }
    if (paraLines.length)
      blocks.push(
        <Typography key={key++} variant="body2" sx={{ color: C.textSub, lineHeight: 1.8, mb: 0.5, fontSize: "0.875rem" }}>
          {parseInline(paraLines.join(" "))}
        </Typography>
      );
  }

  return <>{blocks}</>;
}

// Individual grid card — collapsible, hover lift + glow
function SbSectionCard({ sec, idx, C, isDark }) {
  const [expanded, setExpanded] = useState(true);
  const accent   = SB_PALETTE[idx % SB_PALETTE.length];
  const isTopics = /key\s*topics?|main\s*topics?|topics?\s+identified|themes?|categories?/i.test(sec.title || "");
  const mdSpan   = isTopics ? 12 : getSbSpan(idx);
  const smFull   = mdSpan > 6;
  const isHero   = idx === 0;

  const topicNames = isTopics
    ? sec.lines.map(l => { const m = l.trim().match(/^[-*]\s+(.+)$/) || l.trim().match(/^\d+\.\s+(.+)$/); return m ? m[1].replace(/\*\*/g, "").trim() : null; }).filter(Boolean)
    : [];

  return (
    <Box sx={{
      gridColumn: { xs: "1 / -1", sm: smFull ? "1 / -1" : "auto", md: `span ${mdSpan}` },
      borderRadius: "14px",
      border: `1.5px solid ${accent}30`,
      bgcolor: isDark ? `${accent}0b` : `${accent}05`,
      overflow: "hidden",
      transition: "transform 0.18s ease, box-shadow 0.22s ease, border-color 0.22s ease",
      "&:hover": {
        transform: "translateY(-2px)",
        boxShadow: `0 8px 30px ${accent}22, 0 0 0 1px ${accent}50`,
        borderColor: `${accent}55`,
      },
    }}>
      {/* Card header — click to collapse */}
      {sec.title && (
        <Box
          onClick={() => setExpanded(v => !v)}
          sx={{
            px: isHero ? 2.5 : 2, py: isHero ? 1.5 : 1.1,
            cursor: "pointer", userSelect: "none",
            background: isDark
              ? `linear-gradient(125deg, ${accent}28 0%, ${accent}10 100%)`
              : `linear-gradient(125deg, ${accent}18 0%, ${accent}08 100%)`,
            borderBottom: expanded ? `1px solid ${accent}25` : "none",
            display: "flex", alignItems: "center", gap: 1.5,
          }}
        >
          {/* Left accent bar */}
          <Box sx={{
            width: isHero ? 5 : 4, height: isHero ? 26 : 20,
            borderRadius: 4, flexShrink: 0, bgcolor: accent,
            boxShadow: `0 0 12px ${accent}75`,
          }} />
          <Typography sx={{
            fontWeight: 800, fontSize: isHero ? "0.98rem" : "0.87rem",
            color: isDark ? `${accent}f0` : accent,
            letterSpacing: 0.15, lineHeight: 1.3, flex: 1,
          }}>
            {parseInline(sec.title)}
          </Typography>
          {/* Status dots */}
          <Box sx={{ display: "flex", gap: 0.5, alignItems: "center", flexShrink: 0 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: accent, opacity: 0.85, boxShadow: `0 0 5px ${accent}` }} />
            <Box sx={{ width: 4, height: 4, borderRadius: "50%", bgcolor: accent, opacity: 0.4 }} />
          </Box>
          {/* Collapse chevron */}
          <Box sx={{
            color: `${accent}90`, display: "flex", alignItems: "center", flexShrink: 0,
            transition: "transform 0.2s ease",
            transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
          }}>
            <ExpandMoreIcon sx={{ fontSize: 15 }} />
          </Box>
        </Box>
      )}

      {/* Card body — topics section gets chip rendering */}
      <Collapse in={expanded}>
        <Box sx={{ px: isHero ? 2.5 : 2, py: isHero ? 2 : 1.5 }}>
          {isTopics && topicNames.length > 0 ? (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.85 }}>
              {topicNames.map((topic, j) => {
                const tc = SB_TOPIC_CHIP_COLORS[j % SB_TOPIC_CHIP_COLORS.length];
                return (
                  <Box key={j} sx={{
                    px: 1.5, py: 0.65, borderRadius: "20px",
                    border: `1.5px solid ${tc}42`,
                    bgcolor: isDark ? `${tc}1a` : `${tc}0f`,
                    color: tc, fontSize: "0.8rem", fontWeight: 600,
                    cursor: "default",
                    transition: "transform 0.12s ease, box-shadow 0.12s ease, background-color 0.12s ease",
                    "&:hover": { transform: "scale(1.05)", boxShadow: `0 0 12px ${tc}32`, bgcolor: isDark ? `${tc}28` : `${tc}18` },
                  }}>
                    {topic}
                  </Box>
                );
              })}
            </Box>
          ) : (
            <SbSectionContent lines={sec.lines} C={C} isDark={isDark} accent={accent} />
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

// Horizontal bar showing the top extracted metrics at a glance
function SbInsightsBar({ sections, isDark }) {
  const metrics = extractSbMetrics(sections);
  if (!metrics.length) return null;
  return (
    <Box sx={{
      display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5,
      px: 2, py: 1.5, mb: 2,
      borderRadius: "12px",
      bgcolor: isDark ? "#1a1730" : "#f5f3ff",
      border: `1px solid ${isDark ? "#4c1d9540" : "#ddd6fe66"}`,
    }}>
      <Typography sx={{
        fontSize: "0.57rem", fontWeight: 800, textTransform: "uppercase",
        letterSpacing: 1.2, color: isDark ? "#a78bfa88" : "#7c3aed77",
        pr: 1.5, mr: 0.5, alignSelf: "center", lineHeight: 1,
        borderRight: `1px solid ${isDark ? "#4c1d9555" : "#ddd6fe"}`,
        whiteSpace: "nowrap",
      }}>
        Key Insights
      </Typography>
      {metrics.map((m, j) => (
        <SbMetricChip key={j} label={m.label} value={m.value} isDark={isDark} />
      ))}
    </Box>
  );
}

// ── SWOT 2×2 grid ────────────────────────────────────────────────────────────
const SWOT_CONFIG = [
  { key: "strengths",    color: "#10b981", icon: "S", pattern: /^strengths?$/i },
  { key: "weaknesses",   color: "#ef4444", icon: "W", pattern: /^weaknesses?$/i },
  { key: "opportunities", color: "#3b82f6", icon: "O", pattern: /^opportunities?$/i },
  { key: "threats",      color: "#f59e0b", icon: "T", pattern: /^threats?$/i },
];

function matchSwotSection(title) {
  if (!title) return null;
  for (const cfg of SWOT_CONFIG) {
    if (cfg.pattern.test(title.trim())) return cfg;
  }
  return null;
}

function isSwotAnalysis(sections) {
  // Case 1: ## Strengths, ## Weaknesses, etc. (top-level sections)
  if (sections.filter(s => matchSwotSection(s.title)).length >= 3) return true;
  // Case 2: ## SWOT Analysis with ### Strengths, ### Weaknesses, etc. inside
  for (const sec of sections) {
    if (sec.sub && sec.sub.length >= 3) {
      const swotCount = sec.sub.filter(s => matchSwotSection(s.title)).length;
      if (swotCount >= 3) return true;
    }
  }
  return false;
}

function normalizeBullets(lines) {
  return lines.map(l => l.replace(/^(\s*)\d+\.\s/, "$1- "));
}

function extractSwotSections(sections) {
  // Case 1: top-level SWOT sections
  const topLevel = sections.map(sec => ({
    sec: { ...sec, lines: normalizeBullets(sec.lines) },
    cfg: matchSwotSection(sec.title),
  })).filter(m => m.cfg);
  if (topLevel.length >= 3) return topLevel;

  // Case 2: subsections inside a parent (e.g. ## SWOT Analysis → ### Strengths)
  for (const sec of sections) {
    if (!sec.sub || sec.sub.length < 2) continue;
    const matched = sec.sub
      .map(sub => ({
        sec: { title: sub.title, lines: normalizeBullets(sub.lines), sub: [] },
        cfg: matchSwotSection(sub.title),
      }))
      .filter(m => m.cfg);
    if (matched.length >= 2) return matched;
  }
  return [];
}

function SbSwotGrid({ sections, C, isDark }) {
  const matched = extractSwotSections(sections);
  if (matched.length < 2) return null;

  return (
    <Box sx={{
      display: "grid",
      gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" },
      gap: 1.75,
    }}>
      {matched.map(({ sec, cfg }) => {
        const accent = cfg.color;
        return (
          <Box key={cfg.key} sx={{
            borderRadius: "14px",
            border: `1.5px solid ${accent}30`,
            bgcolor: isDark ? `${accent}0b` : `${accent}05`,
            overflow: "hidden",
            transition: "transform 0.18s ease, box-shadow 0.22s ease",
            "&:hover": {
              transform: "translateY(-2px)",
              boxShadow: `0 8px 30px ${accent}22, 0 0 0 1px ${accent}50`,
            },
          }}>
            <Box sx={{
              px: 2, py: 1.25,
              background: isDark
                ? `linear-gradient(125deg, ${accent}28 0%, ${accent}10 100%)`
                : `linear-gradient(125deg, ${accent}18 0%, ${accent}08 100%)`,
              borderBottom: `1px solid ${accent}25`,
              display: "flex", alignItems: "center", gap: 1.5,
            }}>
              <Box sx={{
                width: 4, height: 20, borderRadius: 4, flexShrink: 0, bgcolor: accent,
                boxShadow: `0 0 12px ${accent}75`,
              }} />
              <Typography sx={{
                fontWeight: 800, fontSize: "0.95rem",
                color: isDark ? `${accent}f0` : accent,
                letterSpacing: 0.15, lineHeight: 1.3, flex: 1,
              }}>
                {cfg.icon} — {sec.title}
              </Typography>
              <Box sx={{ display: "flex", gap: 0.5, alignItems: "center", flexShrink: 0 }}>
                <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: accent, opacity: 0.85, boxShadow: `0 0 5px ${accent}` }} />
              </Box>
            </Box>
            <Box sx={{ px: 2, py: 1.5 }}>
              <SbSectionContent lines={sec.lines} C={C} isDark={isDark} accent={accent} />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

// Grid-based AI response renderer
function SbMarkdownRenderer({ text, C, isDark }) {
  if (!text) return null;
  const { pageTitle, sections } = parseSbSections(text);
  // Strip Key Metrics — it powers the stat cards row above
  const display = sections
    .map((sec, i) => ({ sec, i }))
    .filter(({ sec }) => !/^key\s+metrics?$/i.test(sec.title || ""));
  if (!display.length) return null;

  const swotMode = isSwotAnalysis(sections);
  const swotParentTitles = swotMode
    ? sections.filter(s => s.sub?.some(sub => matchSwotSection(sub.title))).map(s => (s.title || "").toLowerCase())
    : [];
  const remaining = display.filter(({ sec }) => {
    const t = (sec.title || "").toLowerCase();
    if (matchSwotSection(sec.title)) return false;
    if (swotParentTitles.includes(t)) return false;
    return true;
  });
  const isKeyTopics = (s) => /^key\s*topics?$/i.test(s?.title || "");
  const beforeSwot = remaining.filter(({ sec }) => isKeyTopics(sec));
  const afterSwot  = remaining.filter(({ sec }) => !isKeyTopics(sec));

  return (
    <Box>
      {pageTitle && (
        <Typography sx={{ fontWeight: 800, fontSize: { xs: "1.1rem", md: "1.3rem" }, color: C.text, mb: 1.5, lineHeight: 1.3 }}>
          {parseInline(pageTitle)}
        </Typography>
      )}
      {!swotMode && (
        <>
          <SbInsightsBar sections={sections} isDark={isDark} />
          <Box sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(12, 1fr)" },
            gap: 1.75,
          }}>
            {display.map(({ sec, i }) => (
              <SbSectionCard key={i} sec={sec} idx={i} C={C} isDark={isDark} />
            ))}
          </Box>
        </>
      )}
      {swotMode && beforeSwot.length > 0 && (
        <Box sx={{ mb: 1.75 }}>
          {beforeSwot.map(({ sec, i }) => (
            <SbSectionCard key={i} sec={sec} idx={i} C={C} isDark={isDark} />
          ))}
        </Box>
      )}
      {swotMode && <SbSwotGrid sections={sections} C={C} isDark={isDark} />}
      {swotMode && afterSwot.length > 0 && (
        <Box sx={{ mt: 1.75 }}>
          {afterSwot.map(({ sec, i }) => (
            <SbSectionCard key={i} sec={sec} idx={i} C={C} isDark={isDark} />
          ))}
        </Box>
      )}
    </Box>
  );
}

// ── Block markdown renderer ───────────────────────────────────────────────────
function MarkdownRenderer({ text, C }) {
  if (!text) return null;
  const lines = text.split("\n");
  const blocks = [];
  let key = 0, i = 0, numberedListStart = 1;

  while (i < lines.length) {
    const trim = lines[i].trim();
    if (!trim) { i++; continue; }

    if (trim.startsWith("# "))    { numberedListStart = 1; blocks.push(<Typography key={key++} sx={{ fontWeight: 800, fontSize: { xs: "1.15rem", md: "1.35rem" }, color: C.text, mt: blocks.length ? 3 : 0, mb: 0.8, lineHeight: 1.3  }}>{parseInline(trim.slice(2))}</Typography>); i++; continue; }
    if (trim.startsWith("## "))   { numberedListStart = 1; blocks.push(<Typography key={key++} sx={{ fontWeight: 700, fontSize: { xs: "1rem",    md: "1.15rem" }, color: C.text, mt: 2.5, mb: 0.6, lineHeight: 1.35 }}>{parseInline(trim.slice(3))}</Typography>); i++; continue; }
    if (trim.startsWith("### "))  { numberedListStart = 1; blocks.push(<Typography key={key++} sx={{ fontWeight: 700, fontSize: { xs: "0.95rem", md: "1.05rem" }, color: C.text, mt: 2,   mb: 0.5, lineHeight: 1.4  }}>{parseInline(trim.slice(4))}</Typography>); i++; continue; }
    if (trim.startsWith("#### ")) { numberedListStart = 1; blocks.push(<Typography key={key++} sx={{ fontWeight: 600, fontSize: "0.92rem", color: C.text, mt: 1.5, mb: 0.4 }}>{parseInline(trim.slice(5))}</Typography>); i++; continue; }

    if (trim.startsWith("- ") || trim.startsWith("* ")) {
      const items = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t.startsWith("- ") || t.startsWith("* ")) { items.push(t.slice(2)); i++; }
        else if (!t) { i++; break; } else break;
      }
      blocks.push(<Box key={key++} component="ul" sx={{ mt: 0.5, mb: 1, pl: 3, listStyleType: "disc" }}>{items.map((item, j) => (<Box key={j} component="li" sx={{ mb: 0.4 }}><Typography variant="body2" sx={{ color: C.textSub, lineHeight: 1.75, display: "inline" }}>{parseInline(item)}</Typography></Box>))}</Box>);
      continue;
    }

    if (/^\d+\.\s/.test(trim)) {
      const items = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (/^\d+\.\s/.test(t)) { items.push(t.replace(/^\d+\.\s/, "")); i++; }
        else if (!t) { i++; break; } else break;
      }
      const startAt = numberedListStart;
      numberedListStart += items.length;
      blocks.push(<Box key={key++} component="ol" start={startAt} sx={{ mt: 0.5, mb: 1, pl: 3 }}>{items.map((item, j) => (<Box key={j} component="li" sx={{ mb: 0.4 }}><Typography variant="body2" sx={{ color: C.textSub, lineHeight: 1.75, display: "inline" }}>{parseInline(item)}</Typography></Box>))}</Box>);
      continue;
    }

    if (trim === "---" || trim === "***" || trim === "___") {
      blocks.push(<Divider key={key++} sx={{ my: 2, borderColor: C.border }} />);
      i++; continue;
    }

    if (trim.startsWith("|")) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { tableLines.push(lines[i].trim()); i++; }
      const isSep    = (l) => /^[\|\s\-:]+$/.test(l);
      const parseRow = (l) => l.split("|").slice(1, -1).map(c => c.trim());
      const rows     = tableLines.filter(l => !isSep(l));
      if (rows.length >= 1) {
        const headers  = parseRow(rows[0]);
        const dataRows = rows.slice(1).map(parseRow);
        blocks.push(
          <Box key={key++} sx={{ overflowX: "auto", mb: 2, mt: 1 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  {headers.map((h, j) => (
                    <th key={j} style={{ borderBottom: `2px solid ${C.border}`, padding: "8px 14px",
                      textAlign: "left", color: C.text, fontWeight: 700, whiteSpace: "nowrap",
                      backgroundColor: C.cardInner }}>
                      {parseInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, ri) => (
                  <tr key={ri} style={{ borderBottom: `1px solid ${C.border}`,
                    backgroundColor: ri % 2 === 0 ? "transparent" : C.cardInner + "88" }}>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{ padding: "7px 14px", color: C.textSub, verticalAlign: "top" }}>
                        {parseInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        );
      }
      continue;
    }

    const paraLines = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t) { i++; break; }
      if (/^#{1,4}\s/.test(t) || t.startsWith("- ") || t.startsWith("* ") || /^\d+\.\s/.test(t) || t === "---" || t.startsWith("|")) break;
      paraLines.push(t); i++;
    }
    if (paraLines.length)
      blocks.push(<Typography key={key++} variant="body2" sx={{ color: C.textSub, lineHeight: 1.85, mb: 0.5, fontSize: "0.92rem" }}>{parseInline(paraLines.join(" "))}</Typography>);
  }

  return <>{blocks}</>;
}

// ── Download menu ─────────────────────────────────────────────────────────────
const DownloadMenu = ({ anchorEl, onClose, onTxt, onDocx, C }) => (
  <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={onClose}
    PaperProps={{ sx: { bgcolor: C.card, border: `1px solid ${C.border}`, borderRadius: 2, boxShadow: C.shadow, minWidth: 200 } }}
    transformOrigin={{ horizontal: "right", vertical: "top" }}
    anchorOrigin={{ horizontal: "right", vertical: "bottom" }}>
    <MenuItem onClick={onTxt} sx={{ gap: 1, py: 1.2, "&:hover": { bgcolor: C.hover } }}>
      <ListItemIcon sx={{ minWidth: 32 }}><TextSnippetIcon sx={{ color: "#10b981", fontSize: 18 }} /></ListItemIcon>
      <ListItemText
        primary={<Typography variant="body2" sx={{ color: C.text, fontWeight: 600 }}>Plain Text (.txt)</Typography>}
        secondary={<Typography variant="caption" sx={{ color: C.textMuted }}>Simple, universally readable</Typography>}
      />
    </MenuItem>
    <Divider sx={{ borderColor: C.border, my: 0.5 }} />
    <MenuItem onClick={onDocx} sx={{ gap: 1, py: 1.2, "&:hover": { bgcolor: C.hover } }}>
      <ListItemIcon sx={{ minWidth: 32 }}><ArticleIcon sx={{ color: "#3b82f6", fontSize: 18 }} /></ListItemIcon>
      <ListItemText
        primary={<Typography variant="body2" sx={{ color: C.text, fontWeight: 600 }}>Word Document (.docx)</Typography>}
        secondary={<Typography variant="caption" sx={{ color: C.textMuted }}>Formatted, editable in Word</Typography>}
      />
    </MenuItem>
  </Menu>
);

// ── Sidebar entry ─────────────────────────────────────────────────────────────
const SidebarEntry = ({ entry, isSelected, onSelect, onDelete, C }) => {
  const [hovered, setHovered] = useState(false);
  const provColor = PROVIDER_COLORS[entry.provider] || "#a78bfa";
  const snippet   = (entry.prompt_used || entry.enhanced_prompt || "").slice(0, 80) || "Analysis";

  return (
    <Box onClick={() => onSelect(entry.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      sx={{
        px: 1.5, py: 1.2, borderRadius: 1.5, cursor: "pointer", position: "relative",
        bgcolor: isSelected ? `${provColor}18` : "transparent",
        border: `1px solid ${isSelected ? provColor + "40" : "transparent"}`,
        "&:hover": { bgcolor: isSelected ? `${provColor}18` : C.hover },
        transition: "all 0.15s",
      }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.4 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.6 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: provColor, flexShrink: 0 }} />
          <Typography sx={{ color: provColor, fontSize: "0.68rem", fontWeight: 700, lineHeight: 1 }}>
            {PROVIDER_LABELS[entry.provider] || entry.provider || "AI"}
          </Typography>
        </Box>
        {hovered ? (
          <Tooltip title="Delete">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
              sx={{ p: 0.2, color: C.textMuted, "&:hover": { color: "#ef4444" } }}>
              <DeleteOutlineIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        ) : (
          <Typography sx={{ color: C.textMuted, fontSize: "0.65rem" }}>
            {formatDateShort(entry.timestamp)}
          </Typography>
        )}
      </Box>
      <Typography sx={{
        color: isSelected ? C.text : C.textSub,
        fontSize: "0.78rem", lineHeight: 1.45, fontWeight: isSelected ? 600 : 400,
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>
        {snippet}
      </Typography>
      <Typography sx={{ color: C.textMuted, fontSize: "0.65rem", mt: 0.5 }}>
        {entry.record_count ? `${entry.record_count} records` : ""}
        {entry.record_count && entry.model ? " · " : ""}
        {entry.model || ""}
      </Typography>
    </Box>
  );
};

// ── Sidebar panel ─────────────────────────────────────────────────────────────
const Sidebar = ({ history, selectedId, onSelect, onDelete, open, onToggle, dateFilter, onDateChange, C, isDark }) => {
  const theme    = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const filtered = dateFilter ? history.filter(e => toDateStr(e.timestamp) === dateFilter) : history;
  const groups   = groupByDay(filtered);

  const HistoryLabel = () => (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.8 }}>
      <HistoryIcon sx={{ color: C.textMuted, fontSize: 16 }} />
      <Typography sx={{ color: C.text, fontSize: "0.8rem", fontWeight: 700 }}>History</Typography>
      {history.length > 0 && (
        <Box sx={{ bgcolor: isDark ? "#374151" : "#e5e7eb", color: C.textSub,
          borderRadius: 10, px: 0.8, fontSize: "0.65rem", fontWeight: 700, lineHeight: "18px" }}>
          {history.length}
        </Box>
      )}
    </Box>
  );

  const HistoryContent = () => (
    <>
      <Box sx={{ px: 1.5, pt: 1.2, pb: 0.8, flexShrink: 0 }}>
        <TextField type="date" size="small" value={dateFilter}
          onChange={(e) => onDateChange(e.target.value)}
          InputProps={{
            startAdornment: <InputAdornment position="start"><CalendarTodayIcon sx={{ fontSize: 13, color: C.textMuted }} /></InputAdornment>,
            endAdornment: dateFilter ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => onDateChange("")} sx={{ p: 0.2, color: C.textMuted }}>
                  <CloseIcon sx={{ fontSize: 13 }} />
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
          sx={{
            width: "100%",
            "& .MuiInputBase-root": {
              bgcolor: C.cardInner, fontSize: "0.75rem", color: C.text,
              "& fieldset": { borderColor: C.border },
              "&:hover fieldset": { borderColor: C.textMuted },
              "&.Mui-focused fieldset": { borderColor: "#a78bfa" },
            },
            "& input[type='date']::-webkit-calendar-picker-indicator": {
              filter: isDark ? "invert(1)" : "none", opacity: 0.5, cursor: "pointer",
            },
          }}
        />
      </Box>
      <Box sx={{
        flex: 1, overflowY: "auto", maxHeight: isMobile ? 280 : "none", px: 1, pb: 1,
        "&::-webkit-scrollbar": { width: 4 },
        "&::-webkit-scrollbar-track": { bgcolor: "transparent" },
        "&::-webkit-scrollbar-thumb": { bgcolor: C.border, borderRadius: 4 },
      }}>
        {filtered.length === 0 ? (
          <Box sx={{ px: 1, pt: 2, textAlign: "center" }}>
            <Typography sx={{ color: C.textMuted, fontSize: "0.75rem" }}>
              {dateFilter ? "No results for this date" : "No history yet"}
            </Typography>
          </Box>
        ) : (
          Object.entries(groups).map(([label, entries]) => (
            <Box key={label}>
              <Typography sx={{ color: C.textMuted, fontSize: "0.65rem", fontWeight: 700,
                letterSpacing: 0.8, px: 0.5, pt: 1.2, pb: 0.5, textTransform: "uppercase" }}>
                {label}
              </Typography>
              <Stack spacing={0.5}>
                {entries.map((entry) => (
                  <SidebarEntry key={entry.id} entry={entry} isSelected={selectedId === entry.id}
                    onSelect={onSelect} onDelete={onDelete} C={C} />
                ))}
              </Stack>
            </Box>
          ))
        )}
      </Box>
    </>
  );

  if (isMobile) {
    return (
      <Box sx={{ width: "100%", flexShrink: 0, overflow: "hidden",
        borderBottom: `1px solid ${C.border}`, display: "flex", flexDirection: "column",
        bgcolor: C.card, borderRadius: "12px 12px 0 0" }}>
        <Box onClick={onToggle} sx={{ px: 1.5, py: 1.2, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 48 }}>
          <HistoryLabel />
          <IconButton size="small" sx={{ color: C.textMuted, p: 0.5 }}>
            {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </Box>
        {open && <HistoryContent />}
      </Box>
    );
  }

  return (
    <Box sx={{
      width: open ? SIDEBAR_WIDTH : 48, minWidth: open ? SIDEBAR_WIDTH : 48,
      flexShrink: 0, transition: "width 0.22s ease, min-width 0.22s ease",
      overflow: "hidden", borderRight: `1px solid ${C.border}`,
      display: "flex", flexDirection: "column", bgcolor: C.card, borderRadius: "12px 0 0 12px", height: "100%",
    }}>
      <Box sx={{ px: open ? 1.5 : 0, py: 1.2, display: "flex", alignItems: "center",
        justifyContent: open ? "space-between" : "center",
        borderBottom: `1px solid ${C.border}`, minHeight: 48, flexShrink: 0 }}>
        {open && <HistoryLabel />}
        <Tooltip title={open ? "Collapse" : "Expand history"} placement="right">
          <IconButton size="small" onClick={onToggle} sx={{ color: C.textMuted, p: 0.5, "&:hover": { color: C.text } }}>
            {open ? <ChevronLeftIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
      {open && <HistoryContent />}
    </Box>
  );
};

// ── Empty state ───────────────────────────────────────────────────────────────
const EmptyState = ({ C, navigate }) => (
  <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", minHeight: "45vh", gap: 2, textAlign: "center", px: 3 }}>
    <Box sx={{ width: 72, height: 72, borderRadius: "50%", bgcolor: C.card,
      border: `2px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", mb: 1 }}>
      <PsychologyIcon sx={{ color: C.textMuted, fontSize: 36 }} />
    </Box>
    <Typography sx={{ fontWeight: 700, fontSize: "1.25rem", color: C.text }}>No analysis yet</Typography>
    <Typography variant="body2" sx={{ color: C.textSub, maxWidth: 380, lineHeight: 1.7 }}>
      Go to the Results page, select records, and click{" "}
      <strong style={{ color: "#a78bfa" }}>Feed to Smart Brain</strong> to run an analysis.
    </Typography>
    <Button variant="contained" startIcon={<SearchIcon />} onClick={() => navigate("/results")}
      sx={{ mt: 1, bgcolor: "#7c3aed", textTransform: "none", fontWeight: 600,
        "&:hover": { bgcolor: "#6d28d9" } }}>
      Go to Results
    </Button>
  </Box>
);

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SmartBrain() {
  const { C, isDark } = useAppTheme();
  const navigate       = useNavigate();

  const [history,     setHistory]     = useState([]);
  const [selectedId,  setSelectedId]  = useState(null);
  const [dateFilter,  setDateFilter]  = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== "undefined" && window.innerWidth < 600) return false;
    try { return localStorage.getItem(SIDEBAR_KEY) !== "false"; } catch { return true; }
  });

  // Prompt section state
  const [promptSectionOpen, setPromptSectionOpen] = useState(false);
  const [promptText,  setPromptText]  = useState(() => localStorage.getItem(SB_PROMPT_KEY) || "");
  const [promptSaved, setPromptSaved] = useState(!!localStorage.getItem(SB_PROMPT_KEY));
  const [parsing,     setParsing]     = useState(false);
  const [parseError,  setParseError]  = useState("");
  const fileRef = useRef(null);

  // View state
  const [copied,           setCopied]           = useState(false);
  const [promptExpanded,   setPromptExpanded]   = useState(false);
  const [headerMenuAnchor, setHeaderMenuAnchor] = useState(null);
  const [footerMenuAnchor, setFooterMenuAnchor] = useState(null);

  // On mount: load history from DB
  useEffect(() => {
    const pending = hasPending();
    clearPending();
    fetchHistoryFromDB().then(hist => {
      setHistory(hist);
      if (hist.length > 0) {
        // If redirected from a fresh analysis, select the newest entry
        setSelectedId(pending ? hist[0].id : hist[0].id);
        if (pending) setPromptSectionOpen(false);
      }
    });
  }, []);

  const handleToggleSidebar = () => {
    setSidebarOpen(prev => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch {}
      return next;
    });
  };

  const handleSelect = (id) => {
    setSelectedId(id);
    setPromptExpanded(false);
    setCopied(false);
    if (typeof window !== "undefined" && window.innerWidth < 960) setSidebarOpen(false);
  };

  const handleDelete = (id) => {
    const next = history.filter(h => h.id !== id);
    setHistory(next);
    deleteFromDB(id);
    if (selectedId === id) setSelectedId(next.length > 0 ? next[0].id : null);
  };

  // Prompt handlers
  const handleSavePrompt = () => {
    localStorage.setItem(SB_PROMPT_KEY, promptText);
    setPromptSaved(true);
  };
  const handleClearPrompt = () => {
    localStorage.removeItem(SB_PROMPT_KEY);
    setPromptText(""); setPromptSaved(false);
  };
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true); setParseError("");
    const form = new FormData();
    form.append("file", file);
    try {
      const res  = await apiFetch(`${API_BASE}/api/smart-brain/parse-file`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPromptText(data.text || ""); setPromptSaved(false);
    } catch (err) { setParseError(`Failed to parse file: ${err.message}`); }
    finally { setParsing(false); e.target.value = ""; }
  };

  const result     = history.find(h => h.id === selectedId) || null;
  const provColor  = PROVIDER_COLORS[result?.provider] || "#a78bfa";
  const provLabel  = PROVIDER_LABELS[result?.provider] || result?.provider || "";
  const dateLabel  = formatDateTime(result?.timestamp);
  const timestamp  = result?.timestamp ? new Date(result.timestamp).toISOString().slice(0, 10) : "analysis";

  const handleCopy = () => {
    navigator.clipboard.writeText(result?.result || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const buildTxtContent = () => [
    "Smart Brain — AI Analysis",
    `Generated : ${dateLabel}`,
    `Provider  : ${provLabel}${result?.model ? ` (${result.model})` : ""}`,
    `Records   : ${result?.record_count || "—"}`,
    `Tokens    : ${(result?.tokens_used || 0).toLocaleString()}`,
    "",
    "═══ ANALYSIS REQUEST ═══",
    result?.prompt_used || "",
    "",
    "═══ AI RESPONSE ═══",
    result?.result,
  ].filter(l => l !== null).join("\n");

  const handleDownloadTxt = () => {
    downloadText(buildTxtContent(), `smart_brain_${timestamp}.txt`);
    setHeaderMenuAnchor(null); setFooterMenuAnchor(null);
  };
  const handleDownloadDocx = async () => {
    setHeaderMenuAnchor(null); setFooterMenuAnchor(null);
    try {
      const blob = await buildDocxBlob(result, provLabel, dateLabel);
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement("a"), { href: url, download: `smart_brain_${timestamp}.docx`, style: "display:none" });
      document.body.appendChild(a); a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
    } catch (err) { console.error("DOCX failed:", err); }
  };

  return (
    <Box sx={{ width: "100%", color: C.text, pb: 4, overflowX: "hidden" }}>

      {/* Page header */}
      <Box sx={{ mb: 3, display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", flexWrap: "wrap", gap: 2 }}>
        <Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <PsychologyIcon sx={{ color: "#a78bfa", fontSize: { xs: 22, md: 28 } }} />
            <Typography sx={{ fontWeight: "bold", color: C.text, fontSize: { xs: "1.2rem", md: "1.75rem" } }}>
              Smart Brain
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: C.textSub, mt: 0.3 }}>
            AI-powered analysis of your collected data.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button variant="outlined" startIcon={<SearchIcon />}
            onClick={() => navigate("/results")}
            sx={{ borderColor: C.border, color: C.textSub, textTransform: "none",
              fontWeight: 600, "&:hover": { borderColor: "#a78bfa", color: "#a78bfa" } }}>
            Go to Results
          </Button>
          {result && (
            <>
              <Button variant="outlined" startIcon={<FileDownloadIcon />}
                endIcon={<KeyboardArrowDownIcon />}
                onClick={(e) => setHeaderMenuAnchor(e.currentTarget)}
                sx={{ borderColor: C.border, color: C.textSub, textTransform: "none",
                  fontWeight: 600, "&:hover": { borderColor: "#10b981", color: "#10b981" } }}>
                Download
              </Button>
              <DownloadMenu anchorEl={headerMenuAnchor} onClose={() => setHeaderMenuAnchor(null)}
                onTxt={handleDownloadTxt} onDocx={handleDownloadDocx} C={C} />
            </>
          )}
        </Stack>
      </Box>

      {/* Body: sidebar + main */}
      <Box sx={{
        display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 0,
        border: `1px solid ${C.border}`, borderRadius: 2,
        overflow: "hidden", minHeight: { xs: "auto", md: 600 }, boxShadow: C.shadow,
      }}>
        <Sidebar history={history} selectedId={selectedId} onSelect={handleSelect}
          onDelete={handleDelete} open={sidebarOpen} onToggle={handleToggleSidebar}
          dateFilter={dateFilter} onDateChange={setDateFilter} C={C} isDark={isDark} />

        {/* Main content */}
        <Box sx={{ flex: 1, minWidth: 0, overflowX: "hidden", bgcolor: C.bg, p: { xs: 2, md: 3 } }}>

          {/* ── Analysis Prompt section (collapsible, always at top) ── */}
          <Box sx={{ mb: 2.5, bgcolor: C.card, borderRadius: 2, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            <Box onClick={() => setPromptSectionOpen(v => !v)}
              sx={{ px: 2.5, py: 1.5, display: "flex", alignItems: "center",
                justifyContent: "space-between", cursor: "pointer",
                "&:hover": { bgcolor: C.hover }, transition: "background 0.15s" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="caption"
                  sx={{ color: C.textMuted, fontWeight: 700, letterSpacing: 0.8, userSelect: "none" }}>
                  ANALYSIS PROMPT
                </Typography>
                {promptSaved && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.4,
                    bgcolor: "#14532d44", borderRadius: 1, px: 0.8, py: 0.2 }}>
                    <CheckCircleIcon sx={{ fontSize: 11, color: "#4ade80" }} />
                    <Typography sx={{ fontSize: "0.65rem", color: "#4ade80", fontWeight: 700 }}>Saved</Typography>
                  </Box>
                )}
              </Box>
              <IconButton size="small" sx={{ color: C.textMuted, p: 0 }}>
                {promptSectionOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              </IconButton>
            </Box>

            <Collapse in={promptSectionOpen}>
              <Divider sx={{ bgcolor: C.border }} />
              <Box sx={{ px: 2.5, py: 2, bgcolor: C.cardInner }}>
                <Typography variant="body2" sx={{ color: C.textSub, mb: 1.5, fontSize: "0.8rem" }}>
                  Type a prompt or upload a .txt / .pdf / .docx / .mx file. It will auto-fill when you click
                  "Feed to Smart Brain" on the Results page.
                </Typography>

                <Box sx={{ display: "flex", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
                  <Button size="small" variant="outlined"
                    startIcon={parsing
                      ? <CircularProgress size={12} sx={{ color: C.textSub }} />
                      : <FolderOpenIcon sx={{ fontSize: 15 }} />}
                    onClick={() => fileRef.current?.click()} disabled={parsing}
                    sx={{ fontSize: "0.75rem", borderColor: C.border, color: C.textSub,
                      "&:hover": { borderColor: "#a78bfa", color: "#a78bfa" } }}>
                    {parsing ? "Parsing…" : "Upload File"}
                  </Button>
                  <input ref={fileRef} type="file" accept=".txt,.pdf,.docx,.mx" hidden onChange={handleFileUpload} />
                </Box>

                {parseError && <Alert severity="error" sx={{ mb: 1.5, py: 0.5, fontSize: "0.78rem" }}>{parseError}</Alert>}

                <textarea
                  rows={6}
                  placeholder="Type your prompt here, or upload a file above…"
                  value={promptText}
                  onChange={(e) => { setPromptText(e.target.value); setPromptSaved(false); }}
                  style={{
                    width: "100%", boxSizing: "border-box", resize: "vertical",
                    padding: "10px 12px", borderRadius: 6, fontSize: "0.85rem",
                    lineHeight: 1.6, fontFamily: "inherit",
                    background: isDark ? "#0f172a" : "#f8fafc",
                    color: isDark ? "#e2e8f0" : "#1e293b",
                    border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                    outline: "none",
                    marginBottom: 12,
                  }}
                  onFocus={e => e.target.style.borderColor = "#a78bfa"}
                  onBlur={e => e.target.style.borderColor = isDark ? "#334155" : "#cbd5e1"}
                />

                <Box sx={{ display: "flex", gap: 1 }}>
                  <Button variant="contained" size="small"
                    startIcon={<SaveIcon sx={{ fontSize: 15 }} />}
                    onClick={handleSavePrompt} disabled={!promptText.trim()}
                    sx={{ bgcolor: "#7c3aed", color: "white", fontSize: "0.78rem",
                      textTransform: "none", "&:hover": { bgcolor: "#6d28d9" },
                      "&.Mui-disabled": { bgcolor: "#3b2a6b", color: "#7c5cbf" } }}>
                    Save Prompt
                  </Button>
                  {promptText && (
                    <Button size="small" onClick={handleClearPrompt}
                      sx={{ color: C.textMuted, fontSize: "0.75rem", textTransform: "none",
                        "&:hover": { color: "#ef4444", bgcolor: "transparent" } }}>
                      Clear
                    </Button>
                  )}
                </Box>
              </Box>
            </Collapse>
          </Box>

          {/* ── Result area ── */}
          {history.length === 0 ? (
            <EmptyState C={C} navigate={navigate} />
          ) : !result ? (
            <Box sx={{ py: 4, textAlign: "center" }}>
              <Typography sx={{ color: C.textSub }}>Select an entry from the history panel.</Typography>
            </Box>
          ) : (
            <>
              {/* Meta bar */}
              <Box sx={{ mb: 2.5, p: 2, bgcolor: C.card, borderRadius: 2,
                border: `1px solid ${C.border}`,
                display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
                <Chip
                  icon={<AutoAwesomeIcon sx={{ fontSize: "14px !important", color: `${provColor} !important` }} />}
                  label={`${provLabel}${result.model ? ` · ${result.model}` : ""}`}
                  size="small"
                  sx={{ bgcolor: `${provColor}18`, color: provColor,
                    border: `1px solid ${provColor}40`, fontWeight: 700, fontSize: "0.75rem" }}
                />
                {result.record_count > 0 && (
                  <Chip label={`${result.record_count} record${result.record_count !== 1 ? "s" : ""} analyzed`}
                    size="small" sx={{ bgcolor: C.hover, color: C.textSub, fontSize: "0.72rem" }} />
                )}
                {result.tokens_used > 0 && (
                  <Chip label={`${result.tokens_used.toLocaleString()} tokens`}
                    size="small" sx={{ bgcolor: C.hover, color: C.textSub, fontSize: "0.72rem" }} />
                )}
                {result.cost_usd > 0 && (
                  <Chip label={`~$${result.cost_usd.toFixed(6)}`}
                    size="small" sx={{ bgcolor: C.hover, color: C.textSub, fontSize: "0.72rem" }} />
                )}
                <Typography variant="caption" sx={{ color: C.textMuted, ml: "auto" }}>
                  {dateLabel}
                </Typography>
              </Box>

              {/* Collapsible prompt used */}
              <Box sx={{ mb: 2, bgcolor: C.card, borderRadius: 2,
                border: `1px solid ${C.border}`, overflow: "hidden" }}>
                <Box onClick={() => setPromptExpanded(v => !v)}
                  sx={{ px: 2.5, py: 1.5, display: "flex", alignItems: "center",
                    justifyContent: "space-between", cursor: "pointer",
                    "&:hover": { bgcolor: C.hover }, transition: "background 0.15s" }}>
                  <Typography variant="caption"
                    sx={{ color: C.textMuted, fontWeight: 700, letterSpacing: 0.8, userSelect: "none" }}>
                    ANALYSIS REQUEST 
                  </Typography>
                  <IconButton size="small" sx={{ color: C.textMuted, p: 0 }}>
                    {promptExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                  </IconButton>
                </Box>
                <Collapse in={promptExpanded}>
                  <Divider sx={{ bgcolor: C.border }} />
                  <Box sx={{ px: 2.5, py: 2, bgcolor: C.cardInner }}>
                    <Typography variant="body2"
                      sx={{ color: C.textSub, whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: "0.85rem" }}>
                      {result.enhanced_prompt || result.prompt_used || "—"}
                    </Typography>
                  </Box>
                </Collapse>
              </Box>

              {/* AI response — grid card layout */}
              <Box>
                {/* Action row */}
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5, px: 0.25 }}>
                  <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 700, letterSpacing: 0.8 }}>
                    AI ANALYSIS
                  </Typography>
                  <Tooltip title={copied ? "Copied!" : "Copy to clipboard"}>
                    <IconButton size="small" onClick={handleCopy}
                      sx={{ color: copied ? "#10b981" : C.textMuted, border: `1px solid ${C.border}`,
                        "&:hover": { color: "#10b981", borderColor: "#10b981" } }}>
                      <ContentCopyIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                </Box>

                {/* KPI stat cards row */}
                <SbStatCardsRow text={result.result} recordCount={result.record_count} C={C} isDark={isDark} />

                <SbMarkdownRenderer text={result.result} C={C} isDark={isDark} />

                {/* Footer */}
                <Box sx={{ mt: 2.5, display: "flex", justifyContent: "space-between",
                  alignItems: "center", flexWrap: "wrap", gap: 1 }}>
                  <Typography variant="caption" sx={{ color: C.textMuted }}>
                    Generated by {provLabel || "AI"} · {dateLabel}
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Button size="small" startIcon={<FileDownloadIcon sx={{ fontSize: 14 }} />}
                      endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 14 }} />}
                      onClick={(e) => setFooterMenuAnchor(e.currentTarget)}
                      sx={{ color: C.textMuted, textTransform: "none", fontSize: "0.75rem",
                        "&:hover": { color: "#10b981" } }}>
                      Download
                    </Button>
                    <DownloadMenu anchorEl={footerMenuAnchor} onClose={() => setFooterMenuAnchor(null)}
                      onTxt={handleDownloadTxt} onDocx={handleDownloadDocx} C={C} />
                    <Button size="small" startIcon={<SearchIcon sx={{ fontSize: 14 }} />}
                      onClick={() => navigate("/results")}
                      sx={{ color: C.textMuted, textTransform: "none", fontSize: "0.75rem",
                        "&:hover": { color: "#a78bfa" } }}>
                      New Analysis
                    </Button>
                  </Stack>
                </Box>
              </Box>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
