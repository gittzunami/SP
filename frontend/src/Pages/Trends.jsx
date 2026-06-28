import React, { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "../api";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Box, Typography, Button, Chip, Divider, IconButton,
  Collapse, Tooltip, Stack, Menu, MenuItem, ListItemIcon,
  ListItemText, TextField, InputAdornment, CircularProgress,
  useTheme, useMediaQuery,
} from "@mui/material";
import TrendingUpIcon        from "@mui/icons-material/TrendingUp";
import FileDownloadIcon      from "@mui/icons-material/FileDownload";
import ArrowBackIcon         from "@mui/icons-material/ArrowBack";
import AutoAwesomeIcon       from "@mui/icons-material/AutoAwesome";
import ContentCopyIcon       from "@mui/icons-material/ContentCopy";
import ExpandMoreIcon        from "@mui/icons-material/ExpandMore";
import ExpandLessIcon        from "@mui/icons-material/ExpandLess";
import SearchIcon            from "@mui/icons-material/Search";
import ArticleIcon           from "@mui/icons-material/Article";
import TextSnippetIcon       from "@mui/icons-material/TextSnippet";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import HistoryIcon           from "@mui/icons-material/History";
import ChevronLeftIcon       from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon      from "@mui/icons-material/ChevronRight";
import DeleteOutlineIcon     from "@mui/icons-material/DeleteOutline";
import CalendarTodayIcon     from "@mui/icons-material/CalendarToday";
import CloseIcon             from "@mui/icons-material/Close";
import { useAppTheme }       from "../AppThemeContext";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
} from "docx";

const API_BASE      = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const SIDEBAR_KEY   = "trendsense_sidebar_open";
const SIDEBAR_WIDTH = 272;

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
const PLATFORM_LABELS = {
  reddit:        "Reddit",
  edugeek:       "EduGeek",
  autodesk:      "Autodesk",
  stackexchange: "StackExchange",
  google_news:   "Google News",
  twitter:       "Twitter / X",
};

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function formatDateShort(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
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
    const day   = toDateStr(e.generatedAt);
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
  const a    = Object.assign(document.createElement("a"), {
    href: url, download: filename, style: "display:none",
  });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
}

// ── DOCX helpers ──────────────────────────────────────────────────────────────
function parseInlineDocx(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.filter(Boolean).map(part => {
    if (part.startsWith("**") && part.endsWith("**"))
      return new TextRun({ text: part.slice(2, -2), bold: true });
    return new TextRun({ text: part });
  });
}

async function buildDocxBlob(result, provLabel, dateLabel) {
  const metaStyle  = { size: 20, color: "555555" };
  const paragraphs = [];

  paragraphs.push(
    new Paragraph({ children: [new TextRun({ text: "TrendSense — AI Trend Analysis", bold: true, size: 32 })], spacing: { after: 120 } }),
    new Paragraph({ children: [new TextRun({ text: `Generated : ${dateLabel}`, ...metaStyle })],                spacing: { after: 60 } }),
    new Paragraph({ children: [new TextRun({ text: `Provider  : ${provLabel}${result.model ? ` (${result.model})` : ""}`, ...metaStyle })], spacing: { after: 60 } }),
    new Paragraph({ children: [new TextRun({ text: `Records   : ${result.recordCount || "—"}`, ...metaStyle })], spacing: { after: 60 } }),
    new Paragraph({ children: [new TextRun({ text: `Tokens    : ${(result.tokens_used || 0).toLocaleString()}`, ...metaStyle })], spacing: { after: 60 } }),
  );
  if (result.cost_usd > 0)
    paragraphs.push(new Paragraph({ children: [new TextRun({ text: `Cost      : ~$${result.cost_usd.toFixed(6)}`, ...metaStyle })], spacing: { after: 60 } }));
  paragraphs.push(
    new Paragraph({ children: [new TextRun({ text: `Platforms : ${(result.platforms || []).map(p => PLATFORM_LABELS[p] || p).join(", ") || "—"}`, ...metaStyle })], spacing: { after: 240 } }),
    new Paragraph({ children: [new TextRun({ text: "ANALYSIS REQUEST", bold: true, size: 24, color: "444444" })], spacing: { before: 120, after: 80 } }),
    new Paragraph({ children: [new TextRun({ text: result.enhancedPrompt || result.rawPrompt || "—", size: 20, color: "333333" })], spacing: { after: 240 } }),
    new Paragraph({ children: [new TextRun({ text: "AI RESPONSE", bold: true, size: 24, color: "444444" })], spacing: { before: 120, after: 120 } }),
  );

  const lines = (result.response || "").split("\n");
  let i = 0, numberedIdx = 1;
  while (i < lines.length) {
    const trim = lines[i].trim();
    if (!trim) { i++; continue; }
    if (trim.startsWith("# "))    { numberedIdx = 1; paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: parseInlineDocx(trim.slice(2)),  spacing: { before: 240, after: 80  } })); i++; continue; }
    if (trim.startsWith("## "))   { numberedIdx = 1; paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: parseInlineDocx(trim.slice(3)),  spacing: { before: 200, after: 60  } })); i++; continue; }
    if (trim.startsWith("### "))  { numberedIdx = 1; paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: parseInlineDocx(trim.slice(4)),  spacing: { before: 160, after: 60  } })); i++; continue; }
    if (trim.startsWith("#### ")) { numberedIdx = 1; paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_4, children: parseInlineDocx(trim.slice(5)),  spacing: { before: 120, after: 40  } })); i++; continue; }
    if (trim === "---" || trim === "***" || trim === "___") {
      paragraphs.push(new Paragraph({ children: [new TextRun({ text: "─────────────────────────────────────────", color: "AAAAAA" })], spacing: { before: 120, after: 120 } }));
      i++; continue;
    }
    if (trim.startsWith("- ") || trim.startsWith("* ")) {
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t.startsWith("- ") || t.startsWith("* ")) {
          paragraphs.push(new Paragraph({ children: [new TextRun({ text: "• " }), ...parseInlineDocx(t.slice(2))], indent: { left: 720 }, spacing: { after: 40 } }));
          i++;
        } else if (!t) { i++; break; } else break;
      }
      continue;
    }
    if (/^\d+\.\s/.test(trim)) {
      while (i < lines.length) {
        const t = lines[i].trim();
        if (/^\d+\.\s/.test(t)) {
          paragraphs.push(new Paragraph({ children: [new TextRun({ text: `${numberedIdx}. `, bold: true }), ...parseInlineDocx(t.replace(/^\d+\.\s/, ""))], indent: { left: 720 }, spacing: { after: 40 } }));
          numberedIdx++; i++;
        } else if (!t) { i++; break; } else break;
      }
      continue;
    }
    const paraLines = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t) { i++; break; }
      if (/^#{1,4}\s/.test(t) || t.startsWith("- ") || t.startsWith("* ") || /^\d+\.\s/.test(t) || t === "---") break;
      paraLines.push(t); i++;
    }
    if (paraLines.length)
      paragraphs.push(new Paragraph({ children: parseInlineDocx(paraLines.join(" ")), spacing: { after: 80 } }));
  }

  return await Packer.toBlob(new Document({ sections: [{ children: paragraphs }] }));
}

// ── Inline markdown parser ────────────────────────────────────────────────────
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

// ── Summary stat helpers ──────────────────────────────────────────────────────

// Parse the AI's ## Key Metrics section for stat card values
function parseSummaryStats(text, recordCount) {
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
    keyFindings: parseInt(kv["key findings"] || kv["findings"] || kv["insights"]) || (((text || "").match(/^[\s]*[-*]\s+\S/gm) || []).length) || null,
    keyTopics: parseInt(kv["key topics"] || kv["topics"] || kv["themes"]) || null,
    risks: parseInt(kv["risks"] || kv["risks identified"]) || null,
    opportunities: parseInt(kv["opportunities"] || kv["opportunities found"]) || null,
  };
}

// Dual-tone sentiment bar (green = positive, red = negative)
function SentimentBar({ pos, neg, isDark, showLabels = true }) {
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

// Generic compact KPI card with colored left bar
function StatCard({ title, accent, C, isDark, children }) {
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

// Trend Analysis: 3-card row (Sources / Sentiment / Key Points)
function TrendStatCardsRow({ text, recordCount, C, isDark }) {
  const s = parseSummaryStats(text, recordCount);
  return (
    <Box sx={{ display: "flex", gap: 1.25, overflowX: "auto", pb: 0.5, mb: 2.25,
      "&::-webkit-scrollbar": { height: 4 },
      "&::-webkit-scrollbar-thumb": { bgcolor: isDark ? "#374151" : "#d1d5db", borderRadius: 4 },
    }}>
      <StatCard title="Sources Analyzed" accent="#3b82f6" C={C} isDark={isDark}>
        <Typography sx={{ fontSize: "1.85rem", fontWeight: 900, color: "#3b82f6", lineHeight: 1, mb: 0.25 }}>{s.recordCount}</Typography>
        <Typography sx={{ fontSize: "0.62rem", color: C.textMuted, lineHeight: 1.3 }}>Posts & articles</Typography>
      </StatCard>

      <StatCard title="Sentiment" accent="#f59e0b" C={C} isDark={isDark}>
        <SentimentBar pos={s.pos} neg={s.neg} isDark={isDark} showLabels={s.hasSentiment} />
        {!s.hasSentiment && <Typography sx={{ fontSize: "0.62rem", color: C.textMuted, mt: 0.5, lineHeight: 1.3 }}>No data yet</Typography>}
      </StatCard>

      {s.keyFindings !== null && (
        <StatCard title="Key Points" accent="#7c3aed" C={C} isDark={isDark}>
          <Typography sx={{ fontSize: "1.85rem", fontWeight: 900, color: "#7c3aed", lineHeight: 1, mb: 0.25 }}>{s.keyFindings}</Typography>
          <Typography sx={{ fontSize: "0.62rem", color: C.textMuted, lineHeight: 1.3 }}>Important findings</Typography>
        </StatCard>
      )}

      {s.risks !== null && (
        <StatCard title="Risks" accent="#ef4444" C={C} isDark={isDark}>
          <Typography sx={{ fontSize: "1.85rem", fontWeight: 900, color: "#ef4444", lineHeight: 1, mb: 0.25 }}>{s.risks}</Typography>
          <Typography sx={{ fontSize: "0.62rem", color: C.textMuted, lineHeight: 1.3 }}>Flagged</Typography>
        </StatCard>
      )}

      {s.opportunities !== null && (
        <StatCard title="Opportunities" accent="#10b981" C={C} isDark={isDark}>
          <Typography sx={{ fontSize: "1.85rem", fontWeight: 900, color: "#10b981", lineHeight: 1, mb: 0.25 }}>{s.opportunities}</Typography>
          <Typography sx={{ fontSize: "0.62rem", color: C.textMuted, lineHeight: 1.3 }}>Identified</Typography>
        </StatCard>
      )}
    </Box>
  );
}

const TOPIC_CHIP_COLORS = ["#3b82f6","#7c3aed","#10b981","#f59e0b","#06b6d4","#ec4899","#a78bfa","#059669","#c2410c","#4338ca"];

// ── Section card color palette ────────────────────────────────────────────────
const CARD_PALETTE = [
  { accent: "#3b82f6" },  // blue
  { accent: "#8b5cf6" },  // violet
  { accent: "#10b981" },  // emerald
  { accent: "#f59e0b" },  // amber
  { accent: "#ef4444" },  // rose
  { accent: "#06b6d4" },  // cyan
  { accent: "#ec4899" },  // pink
  { accent: "#a78bfa" },  // lavender
];

// ── Markdown section parser ───────────────────────────────────────────────────
function parseMdSections(text) {
  const lines = text.split("\n");
  const sections = [];
  let pageTitle = null;
  let cur = null;

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("# ") && !t.startsWith("## ")) {
      pageTitle = t.slice(2).trim();
    } else if (t.startsWith("## ")) {
      if (cur) sections.push(cur);
      cur = { title: t.slice(3).trim(), lines: [] };
    } else {
      if (!cur) cur = { title: null, lines: [] };
      cur.lines.push(line);
    }
  }
  if (cur && (cur.title || cur.lines.some(l => l.trim()))) sections.push(cur);
  return { pageTitle, sections };
}

// Returns an accent color for a metric value based on its semantic meaning
function metricColor(value, fallback) {
  const v = value.toLowerCase().trim();
  if (/^(positive|true|yes|high|strong|growing|bullish|excellent|great|favorable|upward|increasing|good|verified|very high|very positive|confirmed|rising|above average)/.test(v)) return "#10b981";
  if (/^(negative|false|no|low|weak|declining|bearish|poor|unfavorable|downward|decreasing|bad|unverified|very low|very negative|falling|below average)/.test(v)) return "#ef4444";
  if (/^(neutral|mixed|moderate|medium|average|stable|balanced|inconclusive|unclear|uncertain)/.test(v)) return "#f59e0b";
  if (/\d+%/.test(v)) return "#8b5cf6";
  if (/^\d+[\/.]\d+/.test(v)) return "#3b82f6";
  return fallback;
}

// ── Block content renderer (within a section card) ────────────────────────────
function SectionContent({ lines, C, isDark, accent }) {
  const blocks = [];
  let key = 0, i = 0;

  while (i < lines.length) {
    const trim = lines[i].trim();
    if (!trim) { i++; continue; }

    // ### sub-heading
    if (trim.startsWith("### ")) {
      blocks.push(
        <Box key={key++} sx={{ display: "flex", alignItems: "center", gap: 1.25,
          mt: blocks.length ? 2 : 0, mb: 0.75 }}>
          <Box sx={{ width: 3, height: 15, borderRadius: 4, bgcolor: accent, flexShrink: 0, opacity: 0.85 }} />
          <Typography sx={{ fontWeight: 700, fontSize: "0.88rem", color: C.text, letterSpacing: 0.15 }}>
            {parseInline(trim.slice(4))}
          </Typography>
        </Box>
      );
      i++; continue;
    }

    // #### label
    if (trim.startsWith("#### ")) {
      blocks.push(
        <Typography key={key++} sx={{
          fontWeight: 600, fontSize: "0.72rem", color: accent,
          textTransform: "uppercase", letterSpacing: 1.1, mt: 1.5, mb: 0.4,
        }}>
          {parseInline(trim.slice(5))}
        </Typography>
      );
      i++; continue;
    }

    // Bullet list — glowing LED markers (the aesthetic risk: data-dashboard indicators)
    if (trim.startsWith("- ") || trim.startsWith("* ")) {
      const items = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t.startsWith("- ") || t.startsWith("* ")) { items.push(t.slice(2)); i++; }
        else if (!t) { i++; break; } else break;
      }
      blocks.push(
        <Box key={key++} sx={{ mt: 0.5, mb: 1 }}>
          {items.map((item, j) => (
            <Box key={j} sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, mb: 0.65 }}>
              <Box sx={{
                width: 7, height: 7, borderRadius: "50%",
                bgcolor: accent, mt: "8px", flexShrink: 0,
                boxShadow: `0 0 0 2px ${accent}28, 0 0 8px ${accent}50`,
              }} />
              <Typography variant="body2" sx={{ color: C.textSub, lineHeight: 1.8, fontSize: "0.875rem" }}>
                {parseInline(item)}
              </Typography>
            </Box>
          ))}
        </Box>
      );
      continue;
    }

    // Numbered list — ranked badge counters
    if (/^\d+\.\s/.test(trim)) {
      const items = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (/^\d+\.\s/.test(t)) { items.push(t.replace(/^\d+\.\s/, "")); i++; }
        else if (!t) { i++; break; } else break;
      }
      blocks.push(
        <Box key={key++} sx={{ mt: 0.5, mb: 1 }}>
          {items.map((item, j) => (
            <Box key={j} sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, mb: 0.85 }}>
              <Box sx={{
                minWidth: 24, height: 24, borderRadius: "50%",
                bgcolor: `${accent}20`, border: `1.5px solid ${accent}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, mt: "1px",
              }}>
                <Typography sx={{ fontSize: "0.6rem", fontWeight: 800, color: accent, lineHeight: 1 }}>
                  {j + 1}
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ color: C.textSub, lineHeight: 1.8, fontSize: "0.875rem" }}>
                {parseInline(item)}
              </Typography>
            </Box>
          ))}
        </Box>
      );
      continue;
    }

    // Divider — accent gradient fade
    if (trim === "---" || trim === "***" || trim === "___") {
      blocks.push(
        <Box key={key++} sx={{
          my: 1.75, height: "1px",
          background: `linear-gradient(90deg, ${accent}55 0%, ${accent}22 50%, transparent 100%)`,
        }} />
      );
      i++; continue;
    }

    // Table — accent-tinted header
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
          <Box key={key++} sx={{ overflowX: "auto", mb: 1.5, mt: 0.75,
            borderRadius: "8px", border: `1px solid ${accent}25`, overflow: "hidden" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ background: `${accent}1a` }}>
                  {headers.map((h, j) => (
                    <th key={j} style={{
                      padding: "9px 14px", textAlign: "left",
                      color: isDark ? "#e5e7eb" : "#111827",
                      fontWeight: 700, borderBottom: `2px solid ${accent}40`,
                      whiteSpace: "nowrap",
                    }}>
                      {parseInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 0 ? "transparent" : `${accent}08` }}>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{
                        padding: "7px 14px",
                        color: isDark ? "#9ca3af" : "#374151",
                        borderBottom: `1px solid ${accent}18`,
                        verticalAlign: "top",
                      }}>
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

    // Metric cards: **Label**: Value on their own line — renders as colored indicator chips
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
          <Box key={key++} sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 0.75, mb: 1.5 }}>
            {metrics.map((m, j) => {
              const mColor = metricColor(m.value, accent);
              return (
                <Box key={j} sx={{
                  display: "inline-flex", flexDirection: "column", alignItems: "flex-start",
                  px: 1.25, py: 0.75, borderRadius: "8px", minWidth: 76,
                  border: `1px solid ${mColor}35`,
                  bgcolor: isDark ? `${mColor}15` : `${mColor}0d`,
                  transition: "transform 0.15s ease, box-shadow 0.15s ease",
                  "&:hover": { transform: "translateY(-2px)", boxShadow: `0 4px 14px ${mColor}30` },
                }}>
                  <Typography sx={{
                    fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: 0.9, mb: 0.3, lineHeight: 1,
                    color: isDark ? `${mColor}bb` : `${mColor}99`,
                  }}>
                    {m.label}
                  </Typography>
                  <Typography sx={{ fontSize: "0.85rem", fontWeight: 800, lineHeight: 1.2, color: mColor }}>
                    {m.value}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        );
      }
      continue;
    }

    // Paragraph
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
        <Typography key={key++} variant="body2"
          sx={{ color: C.textSub, lineHeight: 1.85, mb: 0.5, fontSize: "0.9rem" }}>
          {parseInline(paraLines.join(" "))}
        </Typography>
      );
  }

  return <>{blocks}</>;
}

// ── Individual collapsible section card ───────────────────────────────────────
function SectionCard({ sec, idx, C, isDark }) {
  const [expanded, setExpanded] = useState(true);
  const { accent } = CARD_PALETTE[idx % CARD_PALETTE.length];

  return (
    <Box sx={{
      borderRadius: "12px",
      border: `1px solid ${accent}28`,
      bgcolor: isDark ? `${accent}09` : `${accent}05`,
      overflow: "hidden",
      transition: "box-shadow 0.22s ease, border-color 0.22s ease",
      "&:hover": {
        boxShadow: `0 0 0 1px ${accent}45, 0 8px 28px ${accent}1c`,
        borderColor: `${accent}55`,
      },
    }}>
      {/* Header — click to collapse/expand */}
      {sec.title && (
        <Box
          onClick={() => setExpanded(v => !v)}
          sx={{
            px: 2.25, py: 1.2, cursor: "pointer", userSelect: "none",
            background: isDark
              ? `linear-gradient(115deg, ${accent}1e 0%, ${accent}0b 100%)`
              : `linear-gradient(115deg, ${accent}12 0%, ${accent}06 100%)`,
            borderBottom: expanded ? `1px solid ${accent}22` : "none",
            display: "flex", alignItems: "center", gap: 1.5,
          }}
        >
          <Box sx={{ width: 4, height: 22, borderRadius: 4, flexShrink: 0, bgcolor: accent, boxShadow: `0 0 10px ${accent}70` }} />
          <Typography sx={{
            fontWeight: 700, fontSize: "0.9rem", flex: 1,
            color: isDark ? `${accent}f2` : accent,
            letterSpacing: 0.15, lineHeight: 1.3,
          }}>
            {parseInline(sec.title)}
          </Typography>
          <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: accent, flexShrink: 0, boxShadow: `0 0 6px ${accent}90`, opacity: isDark ? 0.75 : 0.6 }} />
          <Box sx={{
            color: `${accent}99`, display: "flex", alignItems: "center",
            transition: "transform 0.2s ease",
            transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
          }}>
            <ExpandMoreIcon sx={{ fontSize: 16 }} />
          </Box>
        </Box>
      )}

      {/* Body — topics section gets chip rendering; others get standard markdown */}
      <Collapse in={expanded}>
        {(() => {
          const isTopics = /key\s*topics?|main\s*topics?|topics?\s+identified|themes?/i.test(sec.title || "");
          const topicNames = isTopics
            ? sec.lines.map(l => { const m = l.trim().match(/^[-*]\s+(.+)$/) || l.trim().match(/^\d+\.\s+(.+)$/); return m ? m[1].replace(/\*\*/g, "").trim() : null; }).filter(Boolean)
            : [];
          return (
            <Box sx={{ px: 2.25, py: sec.title ? 1.75 : 2.25 }}>
              {isTopics && topicNames.length > 0 ? (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.85 }}>
                  {topicNames.map((topic, j) => {
                    const tc = TOPIC_CHIP_COLORS[j % TOPIC_CHIP_COLORS.length];
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
                <SectionContent lines={sec.lines} C={C} isDark={isDark} accent={accent} />
              )}
            </Box>
          );
        })()}
      </Collapse>
    </Box>
  );
}

// ── Card-based markdown renderer ──────────────────────────────────────────────
function MarkdownRenderer({ text, C, isDark }) {
  if (!text) return null;
  const { pageTitle, sections } = parseMdSections(text);
  // Strip the Key Metrics section — it feeds the stat cards row instead
  const display = sections
    .map((sec, i) => ({ sec, i }))
    .filter(({ sec }) => !/^key\s+metrics?$/i.test(sec.title || ""));
  if (!display.length) return null;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.75 }}>
      {pageTitle && (
        <Typography sx={{
          fontWeight: 800, fontSize: { xs: "1.1rem", md: "1.25rem" },
          color: C.text, mb: 0.25, lineHeight: 1.3,
        }}>
          {parseInline(pageTitle)}
        </Typography>
      )}
      {display.map(({ sec, i }) => (
        <SectionCard key={i} sec={sec} idx={i} C={C} isDark={isDark} />
      ))}
    </Box>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
const EmptyState = ({ C, navigate }) => (
  <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", minHeight: "55vh", gap: 2, textAlign: "center", px: 3 }}>
    <Box sx={{ width: 72, height: 72, borderRadius: "50%",
      bgcolor: C.card, border: `2px solid ${C.border}`,
      display: "flex", alignItems: "center", justifyContent: "center", mb: 1 }}>
      <TrendingUpIcon sx={{ color: C.textMuted, fontSize: 36 }} />
    </Box>
    <Typography sx={{ fontWeight: 700, fontSize: "1.25rem", color: C.text }}>
      No analysis yet
    </Typography>
    <Typography variant="body2" sx={{ color: C.textSub, maxWidth: 420, lineHeight: 1.7 }}>
      Select records on the Results page, click{" "}
      <strong style={{ color: "#a855f7" }}>Feed to LLM</strong>, write your question,
      and the AI response will appear here.
    </Typography>
    <Button variant="contained" startIcon={<SearchIcon />}
      onClick={() => navigate("/results")}
      sx={{ mt: 1, bgcolor: "#3b82f6", textTransform: "none",
        fontWeight: 600, "&:hover": { bgcolor: "#2563eb" } }}>
      Go to Results
    </Button>
  </Box>
);

// ── Download menu ─────────────────────────────────────────────────────────────
const DownloadMenu = ({ anchorEl, onClose, onTxt, onDocx, C }) => (
  <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={onClose}
    PaperProps={{ sx: { bgcolor: C.card, border: `1px solid ${C.border}`, borderRadius: 2, boxShadow: C.shadow, minWidth: 180 } }}
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

// ── Sidebar history entry ─────────────────────────────────────────────────────
const SidebarEntry = ({ entry, isSelected, onSelect, onDelete, C }) => {
  const [hovered, setHovered] = useState(false);
  const provColor = PROVIDER_COLORS[entry.provider] || "#3b82f6";
  const snippet   = (entry.rawPrompt || entry.enhancedPrompt || "").slice(0, 80) || "Analysis";

  return (
    <Box
      onClick={() => onSelect(entry.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      sx={{
        px: 1.5, py: 1.2, borderRadius: 1.5, cursor: "pointer", position: "relative",
        bgcolor: isSelected ? `${provColor}18` : "transparent",
        border: `1px solid ${isSelected ? provColor + "40" : "transparent"}`,
        "&:hover": { bgcolor: isSelected ? `${provColor}18` : C.hover },
        transition: "all 0.15s",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.4 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.6 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: provColor, flexShrink: 0 }} />
          <Typography sx={{ color: provColor, fontSize: "0.68rem", fontWeight: 700, lineHeight: 1 }}>
            {PROVIDER_LABELS[entry.provider] || entry.provider}
          </Typography>
        </Box>
        {hovered ? (
          <Tooltip title="Delete">
            <IconButton size="small"
              onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
              sx={{ p: 0.2, color: C.textMuted, "&:hover": { color: "#ef4444" } }}>
              <DeleteOutlineIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        ) : (
          <Typography sx={{ color: C.textMuted, fontSize: "0.65rem" }}>
            {formatDateShort(entry.generatedAt)}
          </Typography>
        )}
      </Box>

      <Typography sx={{
        color: isSelected ? C.text : C.textSub,
        fontSize: "0.78rem", lineHeight: 1.45, fontWeight: isSelected ? 600 : 400,
        display: "-webkit-box", WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>
        {snippet}
      </Typography>

      <Typography sx={{ color: C.textMuted, fontSize: "0.65rem", mt: 0.5 }}>
        {entry.recordCount ? `${entry.recordCount} records` : ""}
        {entry.recordCount && entry.model ? " · " : ""}
        {entry.model || ""}
      </Typography>
    </Box>
  );
};

// ── Sidebar panel ─────────────────────────────────────────────────────────────
const Sidebar = ({ history, selectedId, onSelect, onDelete, open, onToggle, dateFilter, onDateChange, loading, C, isDark }) => {
  const theme    = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const filtered = dateFilter
    ? history.filter(e => toDateStr(e.generatedAt) === dateFilter)
    : history;
  const groups = groupByDay(filtered);

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
      {/* Date filter */}
      <Box sx={{ px: 1.5, pt: 1.2, pb: 0.8, flexShrink: 0 }}>
        <TextField
          type="date" size="small" value={dateFilter}
          onChange={(e) => onDateChange(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <CalendarTodayIcon sx={{ fontSize: 13, color: C.textMuted }} />
              </InputAdornment>
            ),
            endAdornment: dateFilter ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => onDateChange("")}
                  sx={{ p: 0.2, color: C.textMuted }}>
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
              "&.Mui-focused fieldset": { borderColor: "#3b82f6" },
            },
            "& input[type='date']::-webkit-calendar-picker-indicator": {
              filter: isDark ? "invert(1)" : "none", opacity: 0.5, cursor: "pointer",
            },
          }}
        />
      </Box>

      {/* History list */}
      <Box sx={{
        flex: 1, overflowY: "auto",
        maxHeight: isMobile ? 280 : "none",
        px: 1, pb: 1,
        "&::-webkit-scrollbar": { width: 4 },
        "&::-webkit-scrollbar-track": { bgcolor: "transparent" },
        "&::-webkit-scrollbar-thumb": { bgcolor: C.border, borderRadius: 4 },
      }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", pt: 3 }}>
            <CircularProgress size={20} sx={{ color: C.textMuted }} />
          </Box>
        ) : filtered.length === 0 ? (
          <Box sx={{ px: 1, pt: 2, textAlign: "center" }}>
            <Typography sx={{ color: C.textMuted, fontSize: "0.75rem" }}>
              {dateFilter ? "No results for this date" : "No history yet"}
            </Typography>
          </Box>
        ) : (
          Object.entries(groups).map(([label, entries]) => (
            <Box key={label}>
              <Typography sx={{
                color: C.textMuted, fontSize: "0.65rem", fontWeight: 700,
                letterSpacing: 0.8, px: 0.5, pt: 1.2, pb: 0.5,
                textTransform: "uppercase",
              }}>{label}</Typography>
              <Stack spacing={0.5}>
                {entries.map((entry) => (
                  <SidebarEntry
                    key={entry.id}
                    entry={entry}
                    isSelected={selectedId === entry.id}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    C={C}
                  />
                ))}
              </Stack>
            </Box>
          ))
        )}
      </Box>
    </>
  );

  /* ── Mobile: top panel, expands downward ── */
  if (isMobile) {
    return (
      <Box sx={{
        width: "100%", flexShrink: 0,
        overflow: "hidden",
        borderBottom: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column",
        bgcolor: C.card,
        borderRadius: "12px 12px 0 0",
      }}>
        <Box
          onClick={onToggle}
          sx={{
            px: 1.5, py: 1.2, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            minHeight: 48, flexShrink: 0,
          }}
        >
          <HistoryLabel />
          <IconButton size="small" sx={{ color: C.textMuted, p: 0.5, "&:hover": { color: C.text } }}>
            {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </Box>
        {open && <HistoryContent />}
      </Box>
    );
  }

  /* ── Desktop: left side panel ── */
  return (
    <Box sx={{
      width: open ? SIDEBAR_WIDTH : 48,
      minWidth: open ? SIDEBAR_WIDTH : 48,
      flexShrink: 0,
      transition: "width 0.22s ease, min-width 0.22s ease",
      overflow: "hidden",
      borderRight: `1px solid ${C.border}`,
      display: "flex",
      flexDirection: "column",
      bgcolor: C.card,
      borderRadius: "12px 0 0 12px",
      height: "100%",
    }}>
      {/* Toggle header */}
      <Box sx={{
        px: open ? 1.5 : 0, py: 1.2,
        display: "flex", alignItems: "center",
        justifyContent: open ? "space-between" : "center",
        borderBottom: `1px solid ${C.border}`,
        minHeight: 48, flexShrink: 0,
      }}>
        {open && <HistoryLabel />}
        <Tooltip title={open ? "Collapse" : "Expand history"} placement="right">
          <IconButton size="small" onClick={onToggle}
            sx={{ color: C.textMuted, p: 0.5, "&:hover": { color: C.text } }}>
            {open ? <ChevronLeftIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>

      {open && <HistoryContent />}
    </Box>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
const Trends = () => {
  const { C, isDark } = useAppTheme();
  const location      = useLocation();
  const navigate      = useNavigate();

  const [history,     setHistory]     = useState([]);
  const [selectedId,  setSelectedId]  = useState(null);
  const [histLoading, setHistLoading] = useState(true);
  const [dateFilter,  setDateFilter]  = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== "undefined" && window.innerWidth < 600) return false;
    try { return localStorage.getItem(SIDEBAR_KEY) !== "false"; } catch { return true; }
  });

  const [copied,           setCopied]           = useState(false);
  const [promptExpanded,   setPromptExpanded]   = useState(false);
  const [headerMenuAnchor, setHeaderMenuAnchor] = useState(null);
  const [footerMenuAnchor, setFooterMenuAnchor] = useState(null);

  const savedRef = useRef(false);

  // ── Fetch history from DB ──────────────────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    try {
      const res  = await apiFetch(`${API_BASE}/api/llm/analyses`);
      if (!res.ok) return;
      const data = await res.json();
      setHistory(data.analyses || []);
      return data.analyses || [];
    } catch {
      return [];
    } finally {
      setHistLoading(false);
    }
  }, []);

  // ── On mount: save incoming result (if any), then load history ─────────────
  useEffect(() => {
    const init = async () => {
      if (!savedRef.current && location.state?.response) {
        savedRef.current = true;
        try {
          const res = await apiFetch(`${API_BASE}/api/llm/analyses`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(location.state),
          });
          if (res.ok) {
            const saved = await res.json();
            const list  = await fetchHistory();
            // Select the newly saved entry
            setSelectedId(saved.id ?? (list.length > 0 ? list[0].id : null));
          } else {
            await fetchHistory();
          }
        } catch {
          await fetchHistory();
        }
        // Clear nav state
        window.history.replaceState({}, "");
      } else {
        const list = await fetchHistory();
        if (list && list.length > 0) setSelectedId(list[0].id);
      }
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleDelete = async (id) => {
    try {
      await apiFetch(`${API_BASE}/api/llm/analyses/${id}`, { method: "DELETE" });
    } catch {}
    setHistory(prev => prev.filter(h => h.id !== id));
    if (selectedId === id) {
      const remaining = history.filter(h => h.id !== id);
      setSelectedId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const result = history.find(h => h.id === selectedId) || null;

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!histLoading && history.length === 0) {
    return (
      <Box sx={{ width: "100%", color: C.text, pb: 4, overflowX: "hidden" }}>
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontWeight: "bold", color: C.text, fontSize: { xs: "1.2rem", md: "1.75rem" } }}>
            Trend Analysis
          </Typography>
          <Typography variant="body2" sx={{ color: C.textSub }}>
            AI-generated insights from your selected data.
          </Typography>
        </Box>
        <EmptyState C={C} navigate={navigate} />
      </Box>
    );
  }

  const provColor = PROVIDER_COLORS[result?.provider] || "#3b82f6";
  const provLabel = PROVIDER_LABELS[result?.provider] || result?.provider || "";
  const dateLabel = formatDateTime(result?.generatedAt);
  const timestamp = result?.generatedAt
    ? new Date(result.generatedAt).toISOString().slice(0, 10)
    : "analysis";

  const handleCopy = () => {
    navigator.clipboard.writeText(result?.response || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const buildTxtContent = () => [
    "TrendSense — AI Trend Analysis",
    `Generated : ${dateLabel}`,
    `Provider  : ${provLabel}${result?.model ? ` (${result.model})` : ""}`,
    `Records   : ${result?.recordCount || "—"}`,
    `Tokens    : ${(result?.tokens_used || 0).toLocaleString()}`,
    result?.cost_usd > 0 ? `Cost      : ~$${result.cost_usd.toFixed(6)}` : null,
    `Platforms : ${(result?.platforms || []).map(p => PLATFORM_LABELS[p] || p).join(", ") || "—"}`,
    "",
    "═══ ANALYSIS REQUEST ═══",
    result?.enhancedPrompt || result?.rawPrompt || "",
    "",
    "═══ AI RESPONSE ═══",
    result?.response,
  ].filter(l => l !== null).join("\n");

  const handleDownloadTxt = () => {
    downloadText(buildTxtContent(), `llm_analysis_${timestamp}.txt`);
    setHeaderMenuAnchor(null);
    setFooterMenuAnchor(null);
  };

  const handleDownloadDocx = async () => {
    setHeaderMenuAnchor(null);
    setFooterMenuAnchor(null);
    try {
      const blob = await buildDocxBlob(result, provLabel, dateLabel);
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement("a"), {
        href: url, download: `llm_analysis_${timestamp}.docx`, style: "display:none",
      });
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
    } catch (err) {
      console.error("DOCX generation failed:", err);
    }
  };

  return (
    <Box sx={{ width: "100%", color: C.text, pb: 4, overflowX: "hidden" }}>

      {/* Page header */}
      <Box sx={{ mb: 3, display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", flexWrap: "wrap", gap: 2 }}>
        <Box>
          <Typography sx={{ fontWeight: "bold", color: C.text, fontSize: { xs: "1.2rem", md: "1.75rem" } }}>
            Trend Analysis
          </Typography>
          <Typography variant="body2" sx={{ color: C.textSub }}>
            AI-generated insights from your selected data.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button variant="outlined" startIcon={<ArrowBackIcon />}
            onClick={() => navigate("/results")}
            sx={{ borderColor: C.border, color: C.textSub, textTransform: "none",
              fontWeight: 600, "&:hover": { borderColor: "#a855f7", color: "#a855f7" } }}>
            New Analysis
          </Button>
          {result && (
            <>
              <Button variant="outlined"
                startIcon={<FileDownloadIcon />}
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
        <Sidebar
          history={history}
          selectedId={selectedId}
          onSelect={handleSelect}
          onDelete={handleDelete}
          open={sidebarOpen}
          onToggle={handleToggleSidebar}
          dateFilter={dateFilter}
          onDateChange={setDateFilter}
          loading={histLoading}
          C={C}
          isDark={isDark}
        />

        {/* Main content */}
        <Box sx={{ flex: 1, minWidth: 0, overflowX: "hidden", bgcolor: C.bg, p: { xs: 2, md: 3 } }}>
          {histLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", pt: 6 }}>
              <CircularProgress size={32} sx={{ color: C.textMuted }} />
            </Box>
          ) : !result ? (
            <EmptyState C={C} navigate={navigate} />
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
                {result.recordCount > 0 && (
                  <Chip label={`${result.recordCount} record${result.recordCount !== 1 ? "s" : ""} analyzed`}
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
                {(result.platforms || []).map((p) => (
                  <Chip key={p} label={PLATFORM_LABELS[p] || p} size="small"
                    sx={{ bgcolor: isDark ? "#1e3a5f" : "#dbeafe",
                      color: isDark ? "#93c5fd" : "#1d4ed8", fontSize: "0.7rem" }} />
                ))}
                <Typography variant="caption" sx={{ color: C.textMuted, ml: "auto" }}>
                  {dateLabel}
                </Typography>
              </Box>

              {/* Collapsible prompt */}
              <Box sx={{ mb: 2, bgcolor: C.card, borderRadius: 2,
                border: `1px solid ${C.border}`, overflow: "hidden" }}>
                <Box onClick={() => setPromptExpanded(v => !v)}
                  sx={{ px: 2.5, py: 1.5, display: "flex", alignItems: "center",
                    justifyContent: "space-between", cursor: "pointer",
                    "&:hover": { bgcolor: C.hover }, transition: "background 0.15s" }}>
                  <Typography variant="caption"
                    sx={{ color: C.textMuted, fontWeight: 700, letterSpacing: 0.8, userSelect: "none" }}>
                    ANALYSIS REQUEST (ENHANCED PROMPT)
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
                      {result.enhancedPrompt || result.rawPrompt || "—"}
                    </Typography>
                  </Box>
                </Collapse>
              </Box>

              {/* Response area — section cards with action strip */}
              <Box>
                {/* Action row: copy + section count */}
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                  mb: 1.5, px: 0.25 }}>
                  <Typography variant="caption" sx={{ color: C.textMuted, fontWeight: 600, letterSpacing: 0.5 }}>
                    AI ANALYSIS
                  </Typography>
                  <Tooltip title={copied ? "Copied!" : "Copy full response"}>
                    <IconButton size="small" onClick={handleCopy}
                      sx={{ color: copied ? "#10b981" : C.textMuted,
                        border: `1px solid ${copied ? "#10b98140" : C.border}`,
                        transition: "color 0.2s, border-color 0.2s",
                        "&:hover": { color: "#10b981", borderColor: "#10b98140" } }}>
                      <ContentCopyIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                </Box>

                {/* Stat summary row */}
                <TrendStatCardsRow text={result.response} recordCount={result.recordCount} C={C} isDark={isDark} />

                {/* Section cards */}
                <MarkdownRenderer text={result.response} C={C} isDark={isDark} />

                {/* Footer action bar */}
                <Box sx={{ mt: 2, pt: 1.5, borderTop: `1px solid ${C.border}`,
                  display: "flex", justifyContent: "space-between",
                  alignItems: "center", flexWrap: "wrap", gap: 1 }}>
                  <Typography variant="caption" sx={{ color: C.textMuted }}>
                    {provLabel} · {dateLabel}
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Button size="small"
                      startIcon={<FileDownloadIcon sx={{ fontSize: 14 }} />}
                      endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 14 }} />}
                      onClick={(e) => setFooterMenuAnchor(e.currentTarget)}
                      sx={{ color: C.textMuted, textTransform: "none", fontSize: "0.75rem",
                        "&:hover": { color: "#10b981" } }}>
                      Download
                    </Button>
                    <DownloadMenu anchorEl={footerMenuAnchor} onClose={() => setFooterMenuAnchor(null)}
                      onTxt={handleDownloadTxt} onDocx={handleDownloadDocx} C={C} />
                    <Button size="small" startIcon={<ArrowBackIcon sx={{ fontSize: 14 }} />}
                      onClick={() => navigate("/results")}
                      sx={{ color: C.textMuted, textTransform: "none", fontSize: "0.75rem",
                        "&:hover": { color: "#a855f7" } }}>
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
};

export default Trends;
