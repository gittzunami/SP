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

const API_BASE       = "http://localhost:8000";
const SB_PROMPT_KEY  = "sbPrompt";
const SB_RESULT_KEY  = "sbLastResult";   // set to "1" by FeedToSmartBrainModal as a redirect signal
const SIDEBAR_KEY    = "sbSidebarOpen";
const SIDEBAR_WIDTH  = 272;

const PROVIDER_COLORS = { openai: "#10a37f", anthropic: "#d97757", gemini: "#4285f4" };
const PROVIDER_LABELS = { openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini" };

// ── DB helpers ────────────────────────────────────────────────────────────────
const API_BASE_SB = "http://localhost:8000";

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
                  Type a prompt or upload a .txt / .pdf / .docx file. It will auto-fill when you click
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
                  <input ref={fileRef} type="file" accept=".txt,.pdf,.docx" hidden onChange={handleFileUpload} />
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

              {/* Response card */}
              <Box sx={{ bgcolor: C.card, borderRadius: 2, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                <Box sx={{ px: 3, py: 2, borderBottom: `1px solid ${C.border}`,
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: provColor, flexShrink: 0 }} />
                    <Typography sx={{ fontWeight: 700, color: C.text, fontSize: "0.95rem" }}>
                      AI Response
                    </Typography>
                  </Box>
                  <Tooltip title={copied ? "Copied!" : "Copy to clipboard"}>
                    <IconButton size="small" onClick={handleCopy}
                      sx={{ color: copied ? "#10b981" : C.textMuted,
                        border: `1px solid ${C.border}`,
                        "&:hover": { color: "#10b981", borderColor: "#10b981" } }}>
                      <ContentCopyIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                  </Tooltip>
                </Box>

                <Box sx={{ px: { xs: 2.5, md: 4 }, py: { xs: 2.5, md: 3.5 } }}>
                  <MarkdownRenderer text={result.result} C={C} />
                </Box>

                <Box sx={{ px: 3, py: 1.5, borderTop: `1px solid ${C.border}`,
                  bgcolor: C.cardInner, display: "flex", justifyContent: "space-between",
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
