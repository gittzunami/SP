import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api";
import {
  Box, Card, CardContent, Typography, Chip,
  Stack, CircularProgress, IconButton, Tooltip,
  TextField, InputAdornment, useTheme, useMediaQuery,
} from "@mui/material";
import ArticleIcon        from "@mui/icons-material/Article";
import AutoAwesomeIcon    from "@mui/icons-material/AutoAwesome";
import CalendarTodayIcon  from "@mui/icons-material/CalendarToday";
import ContentCopyIcon    from "@mui/icons-material/ContentCopy";
import CheckIcon          from "@mui/icons-material/Check";
import ChevronLeftIcon    from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon   from "@mui/icons-material/ChevronRight";
import ExpandLessIcon     from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon     from "@mui/icons-material/ExpandMore";
import DeleteOutlineIcon  from "@mui/icons-material/DeleteOutline";
import CloseIcon          from "@mui/icons-material/Close";
import { useAppTheme }    from "../AppThemeContext";

const API_BASE    = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const SIDEBAR_KEY = "TrendSense_newsletter_sidebar_open";

// ── Static newsletter copy — update these as needed ───────────────────────────
const NEWSLETTER_QUOTE_LINE1 = "By relying solely on their cloud providers for data security, many companies unknowingly compromise their operations.";
const NEWSLETTER_QUOTE_LINE2 = "From data loss to costly downtime, misunderstandings about who is responsible for data protection can have severe consequences.";
const CTA_URL = "https://cloudsfer.com"; // TODO: replace with real URL

const SOCIAL_ICONS = [
  { label: "f",  bg: "#1877F2", href: "https://www.facebook.com/cloudsfer?locale=he_IL", title: "Facebook",  fontSize: "1rem",   fontWeight: "bold" },
  { label: "𝕏",  bg: "#000000", href: "https://x.com/Cloudsfer",                         title: "X",         fontSize: "0.95rem", fontWeight: "bold" },
  { label: "🔗", bg: "#2DBDAD", href: "https://cloudsfer.com/",                           title: "Website",   fontSize: "0.85rem", fontWeight: "normal" },
  { label: "in", bg: "#0077B5", href: "https://www.linkedin.com/company/cloudsfer/",      title: "LinkedIn",  fontSize: "0.8rem",  fontWeight: "bold" },
];

const PROVIDER_COLORS = {
  openai:    "#10a37f",
  anthropic: "#d97757",
  gemini:    "#4285f4",
};

// ── Build inline-styled HTML for Gmail paste ──────────────────────────────────
function buildGmailHtml(newsletter) {
  const c        = newsletter?.content || {};
  const question = String(c.question || c.headline || "What is really happening?");
  const answer   = String(c.answer   || c.analyst_note || "");
  const rawTerm  = String(c.cta_term || c.keyword || "");
  const ctaTerm  = rawTerm.replace(/\s+support\s*$/i, "").trim();
  const ctaLabel = ctaTerm
    ? `→ Get Reliable ${ctaTerm.charAt(0).toUpperCase() + ctaTerm.slice(1)} Support with Cloudsfer`
    : "→ Discover Cloudsfer";

  const esc = (s) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return `
<div style="background:#ffffff;max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;padding:32px 40px;color:#222222;">

  <hr style="border:none;border-top:2px solid #dddddd;margin:0 0 28px 0;" />

  <p style="color:#888888;font-size:13px;margin:0 0 10px 0;">We've all seen the posts in Google News:</p>

  <h2 style="color:#c0392b;font-size:22px;font-weight:bold;line-height:1.35;margin:0 0 18px 0;">
    ${esc(question)}
  </h2>

  <p style="color:#555555;font-size:16px;margin:0 0 8px 0;">But what if it's not?</p>

  <p style="color:#222222;font-size:16px;margin:0 0 20px 0;">
    Cloudsfer provides a definitive
    <span style="color:#c0392b;font-weight:bold;">yes</span>
  </p>

  <p style="color:#333333;font-size:15px;line-height:1.7;margin:0 0 36px 0;">
    ${esc(answer)}
  </p>

  <div style="text-align:center;margin:0 0 28px 0;">
    <a href="${CTA_URL}" target="_blank" rel="noopener noreferrer"
       style="background:#2DBDAD;color:#ffffff;padding:14px 40px;text-decoration:none;border-radius:50px;font-size:15px;font-weight:bold;display:inline-block;">
      ${ctaLabel}
    </a>
  </div>

  <div style="background:#E8923A;padding:14px 20px;margin:0 0 24px 0;text-align:center;border-radius:2px;">
    <table role="presentation" style="margin:0 auto;border-collapse:collapse;">
      <tr>
        <td style="padding:0 6px;">
          <a href="https://www.facebook.com/cloudsfer?locale=he_IL" target="_blank" rel="noopener noreferrer" style="display:inline-block;width:36px;height:36px;border-radius:50%;background:#1877F2;text-align:center;line-height:36px;color:#ffffff;font-weight:bold;font-size:16px;text-decoration:none;">f</a>
        </td>
        <td style="padding:0 6px;">
          <a href="https://x.com/Cloudsfer" target="_blank" rel="noopener noreferrer" style="display:inline-block;width:36px;height:36px;border-radius:50%;background:#000000;text-align:center;line-height:36px;color:#ffffff;font-weight:bold;font-size:14px;text-decoration:none;">&#120143;</a>
        </td>
        <td style="padding:0 6px;">
          <a href="https://cloudsfer.com/" target="_blank" rel="noopener noreferrer" style="display:inline-block;width:36px;height:36px;border-radius:50%;background:#2DBDAD;text-align:center;line-height:36px;color:#ffffff;font-size:16px;text-decoration:none;">&#128279;</a>
        </td>
        <td style="padding:0 6px;">
          <a href="https://www.linkedin.com/company/cloudsfer/" target="_blank" rel="noopener noreferrer" style="display:inline-block;width:36px;height:36px;border-radius:50%;background:#0077B5;text-align:center;line-height:36px;color:#ffffff;font-weight:bold;font-size:12px;text-decoration:none;">in</a>
        </td>
      </tr>
    </table>
  </div>

  <div style="background:#f0f0f0;padding:20px 28px;border-radius:4px;text-align:center;">
    <p style="font-style:italic;color:#555555;font-size:14px;line-height:1.7;margin:0 0 8px 0;">
      ${esc(NEWSLETTER_QUOTE_LINE1)}
    </p>
    <p style="font-style:italic;color:#555555;font-size:14px;line-height:1.7;margin:0;">
      ${esc(NEWSLETTER_QUOTE_LINE2)}
    </p>
  </div>

  <hr style="border:none;border-top:1px solid #dddddd;margin:28px 0 0 0;" />

</div>`.trim();
}

// ── Copy button — icon only, copies rich HTML for Gmail ──────────────────────
const CopyButton = ({ newsletter }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const html = buildGmailHtml(newsletter);
      if (window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }) }),
        ]);
      } else {
        await navigator.clipboard.writeText(html);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  return (
    <Tooltip title={copied ? "Copied!" : "Copy to clipboard"} placement="top">
      <IconButton
        onClick={handleCopy}
        size="small"
        sx={{
          color: copied ? "#10b981" : "#94a3b8",
          border: "1px solid",
          borderColor: copied ? "#10b981" : "#334155",
          borderRadius: 1,
          p: 0.6,
          "&:hover": { borderColor: "#3b82f6", color: "#3b82f6" },
        }}
      >
        {copied
          ? <CheckIcon sx={{ fontSize: 16 }} />
          : <ContentCopyIcon sx={{ fontSize: 16 }} />
        }
      </IconButton>
    </Tooltip>
  );
};

// ── Newsletter preview — white email-style template ───────────────────────────
const RenderedNewsletter = ({ newsletter }) => {
  const c = newsletter.content || {};

  // Support both new format (question/answer) and old format (headline/analyst_note)
  const question = c.question || c.headline || null;
  const answer   = c.answer   || c.analyst_note || null;
  const isLegacy = !c.question && (c.headline || c.sections?.length);

  return (
    <Box sx={{ bgcolor: "white", p: { xs: 1.5, md: 2.5 }, borderRadius: 1, color: "black",
      maxWidth: 560, mx: "auto" }}>

      {/* Top rule */}
      <Box sx={{ borderTop: "2px solid #dddddd", mb: 2 }} />

      {isLegacy ? (
        /* ── Legacy format fallback ── */
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: "1.1rem", color: "#1e293b", mb: 0.5 }}>
            {c.headline}
          </Typography>
          {c.analyst_note && (
            <Typography variant="body2" sx={{ color: "#374151", lineHeight: 1.6, mt: 1.5, fontSize: "0.82rem" }}>
              {c.analyst_note}
            </Typography>
          )}
          {(c.sections || []).map((s, si) => (
            <Box key={si} sx={{ mt: 2 }}>
              <Typography sx={{ fontWeight: 700, color: "#1e293b", mb: 0.5, fontSize: "0.85rem" }}>{s.title}</Typography>
              {(s.stories || []).map((st, i) => (
                <Box key={i} sx={{ mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: "0.78rem" }}>{st.title}</Typography>
                  <Typography variant="body2" sx={{ color: "#374151", fontSize: "0.75rem" }}>{st.summary}</Typography>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      ) : (
        /* ── New format ── */
        <>
          {/* Intro line */}
          <Typography sx={{ color: "#888888", fontSize: "0.72rem", mb: 0.8 }}>
            We've all seen the posts in Google News:
          </Typography>

          {/* LLM question — reddish */}
          {question && (
            <Typography sx={{
              color: "#c0392b", fontWeight: "bold",
              fontSize: { xs: "0.95rem", md: "1.05rem" },
              lineHeight: 1.35, mb: 1.5,
            }}>
              {question}
            </Typography>
          )}

          {/* Constant challenge line */}
          <Typography sx={{ color: "#555555", fontSize: "0.82rem", mb: 0.6 }}>
            But what if it's not?
          </Typography>

          {/* TrendSense yes line */}
          <Typography sx={{ color: "#222222", fontSize: "0.82rem", mb: 1.5 }}>
            Cloudsfer provides a definitive{" "}
            <Box component="span" sx={{ color: "#c0392b", fontWeight: "bold" }}>yes</Box>
          </Typography>

          {/* LLM answer */}
          {answer && (
            <Typography sx={{ color: "#333333", fontSize: "0.82rem",
              lineHeight: 1.65, mb: 2.5 }}>
              {answer}
            </Typography>
          )}

          {/* CTA button — pill shape */}
          {(() => {
            const rawTerm = c.cta_term || c.keyword || "";
            const term    = rawTerm.replace(/\s+support\s*$/i, "").trim();
            const label = term
              ? `→ Get Reliable ${term.charAt(0).toUpperCase() + term.slice(1)} Support with Cloudsfer`
              : "→ Discover Cloudsfer";
            return (
              <Box sx={{ textAlign: "center", mb: 2 }}>
                <Box
                  component="a"
                  href={CTA_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{
                    display: "inline-block",
                    bgcolor: "#2DBDAD",
                    color: "#ffffff",
                    px: 3, py: 1,
                    borderRadius: "50px",
                    fontWeight: "bold",
                    fontSize: "0.78rem",
                    textDecoration: "none",
                    "&:hover": { bgcolor: "#1a9d8e" },
                  }}
                >
                  {label}
                </Box>
              </Box>
            );
          })()}

          {/* Social share bar — orange with circular brand icons */}
          <Box sx={{
            bgcolor: "#E8923A",
            py: 1.25, mb: 2,
            borderRadius: "2px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 1,
          }}>
            {SOCIAL_ICONS.map(({ label, bg, href, title, fontSize, fontWeight }) => (
              <Box
                key={title}
                component="a"
                href={href}
                title={title}
                target="_blank"
                rel="noopener noreferrer"
                sx={{
                  width: 26, height: 26,
                  borderRadius: "50%",
                  bgcolor: bg,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#ffffff",
                  fontSize: `calc(${fontSize} * 0.75)`, fontWeight,
                  textDecoration: "none",
                  flexShrink: 0,
                  "&:hover": { opacity: 0.85 },
                }}
              >
                {label}
              </Box>
            ))}
          </Box>

          {/* Italic quote box — gray background, centered */}
          <Box sx={{
            bgcolor: "#f0f0f0",
            px: 2, py: 1.5,
            borderRadius: "4px",
            textAlign: "center",
          }}>
            <Typography sx={{
              fontStyle: "italic", color: "#555555",
              fontSize: "0.72rem", lineHeight: 1.6, mb: 0.5,
            }}>
              {NEWSLETTER_QUOTE_LINE1}
            </Typography>
            <Typography sx={{
              fontStyle: "italic", color: "#555555",
              fontSize: "0.72rem", lineHeight: 1.6,
            }}>
              {NEWSLETTER_QUOTE_LINE2}
            </Typography>
          </Box>
        </>
      )}

      {/* Bottom rule */}
      <Box sx={{ borderTop: "1px solid #dddddd", mt: 2 }} />
    </Box>
  );
};


// ── Sidebar newsletter entry with hover-reveal delete ────────────────────────
const SidebarNewsletterEntry = ({ nl, isSelected, onSelect, onDelete, formatDate,
  selectedItemBg, selectedItemBdr, C }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <Box
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      sx={{
        p: 2,
        bgcolor: isSelected ? selectedItemBg : C.cardInner,
        border: "1px solid",
        borderColor: isSelected ? selectedItemBdr : C.border,
        borderRadius: 1.5, cursor: "pointer",
        transition: "all 0.2s",
        "&:hover": { borderColor: "#3b82f6", bgcolor: C.hover },
      }}
    >
      <Box sx={{ display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ color: C.text, fontWeight: 600,
            fontSize: "0.8rem", overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap" }}>
            {nl.title}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5 }}>
            <CalendarTodayIcon sx={{ fontSize: 11, color: C.textMuted }} />
            <Typography variant="caption" sx={{ color: C.textMuted, fontSize: "0.68rem" }}>
              {formatDate(nl.article_date)}
            </Typography>
          </Box>
        </Box>
        {hovered ? (
          <Tooltip title="Delete">
            <IconButton size="small"
              onClick={(e) => { e.stopPropagation(); onDelete(nl.id); }}
              sx={{ p: 0.2, color: C.textMuted, "&:hover": { color: "#ef4444" } }}>
              <DeleteOutlineIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        ) : (
          <Chip
            label={`${nl.article_count} art.`}
            size="small"
            sx={{ bgcolor: C.hover, color: C.textSub,
              fontSize: "0.6rem", height: 18, flexShrink: 0 }}
          />
        )}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 1, minWidth: 0, overflow: "hidden" }}>
        <AutoAwesomeIcon sx={{ fontSize: 11, flexShrink: 0,
          color: PROVIDER_COLORS[nl.provider] || C.textMuted }} />
        <Typography variant="caption" sx={{
          color: PROVIDER_COLORS[nl.provider] || C.textMuted,
          fontSize: "0.65rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {nl.provider} · {nl.model}
        </Typography>
      </Box>
    </Box>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
const Newsletter = () => {
  const { C, isDark } = useAppTheme();
  const theme    = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [newsletters,  setNewsletters]  = useState([]);
  const [selected,     setSelected]     = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [dateFilter,   setDateFilter]   = useState("");
  const [sidebarOpen,  setSidebarOpen]  = useState(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_KEY);
      if (stored !== null) return stored !== "false";
    } catch {}
    return typeof window === "undefined" || window.innerWidth >= 960;
  });

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch {}
      return next;
    });
  };

  const fetchNewsletters = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/newsletters`);
      if (res.ok) {
        const data = await res.json();
        const list = data.newsletters || [];
        setNewsletters(list);
        setSelected(prev => {
          if (prev === null) return list.length > 0 ? list[0] : null;
          const updated = list.find(n => n.id === prev.id);
          return updated ?? prev;
        });
      }
    } catch (e) {
      console.error("Failed to fetch newsletters:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNewsletters();
    const id = setInterval(() => fetchNewsletters(true), 30_000);
    return () => clearInterval(id);
  }, []);

  const handleDelete = async (id) => {
    try {
      await apiFetch(`${API_BASE}/api/newsletters/${id}`, { method: "DELETE" });
    } catch {}
    setNewsletters(prev => prev.filter(n => n.id !== id));
    if (selected?.id === id) {
      const remaining = newsletters.filter(n => n.id !== id);
      setSelected(remaining.length > 0 ? remaining[0] : null);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    try {
      return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "short", year: "numeric", month: "short", day: "numeric",
      });
    } catch { return dateStr; }
  };

  const selectedItemBg  = isDark ? "#1e3a5f" : "#dbeafe";
  const selectedItemBdr = "#3b82f6";

  return (
    <Box sx={{ width: "100%", overflowX: "hidden" }}>
      {/* Header */}
      <Box sx={{ mb: { xs: 3, md: 4 } }}>
        <Typography sx={{ fontWeight: "bold", color: C.text,
          fontSize: { xs: "1.2rem", sm: "1.4rem", md: "1.5rem" } }}>
          Newsletter
        </Typography>
      </Box>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", py: 12 }}>
          <CircularProgress sx={{ color: "#3b82f6" }} />
        </Box>
      ) : newsletters.length === 0 ? (
        <Card sx={{ bgcolor: C.card, border: `1px solid ${C.border}`, borderRadius: 2, boxShadow: C.shadow }}>
          <CardContent sx={{ py: 8, textAlign: "center" }}>
            <AutoAwesomeIcon sx={{ color: C.border, fontSize: 56, mb: 2 }} />
            <Typography sx={{ color: C.text, fontWeight: 700, mb: 1 }}>
              No Newsletters Yet
            </Typography>
            <Typography variant="body2" sx={{ color: C.textMuted, maxWidth: 420, mx: "auto" }}>
              Run a Google News collection → approve the data via webhook →
              the AI will automatically generate a newsletter here.
            </Typography>
            <Box sx={{ mt: 3, p: 2, bgcolor: C.cardInner, borderRadius: 2,
              border: `1px solid ${C.border}`, maxWidth: 500, mx: "auto", textAlign: "left" }}>
              <Typography variant="caption" sx={{ color: "#3b82f6", fontWeight: 700,
                display: "block", mb: 1 }}>
                HOW IT WORKS
              </Typography>
              {[
                "1. Go to Monitoring → run Google News",
                "2. Results are sent to your webhook URL for review",
                "3. External system approves via POST /webhook/google-news/response",
                "4. Articles saved → AI generates one newsletter → appears here",
              ].map((s, i) => (
                <Typography key={i} variant="caption" sx={{ color: C.textMuted,
                  display: "block", mb: 0.5 }}>
                  {s}
                </Typography>
              ))}
            </Box>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" },
          gap: 3, width: "100%", alignItems: "flex-start", minWidth: 0 }}>

          {/* Left sidebar — collapsible, sticky */}
          <Box sx={{
            width: sidebarOpen ? { xs: "100%", md: "280px" } : { xs: "100%", md: "44px" },
            flexShrink: 0,
            transition: "width 0.2s ease",
            position: { md: "sticky" }, top: 0,
            maxHeight: { md: "calc(100vh - 56px - 64px)" },
            display: "flex", flexDirection: "column",
            overflowX: "hidden",
            minWidth: 0,
          }}>
            <Card sx={{ bgcolor: C.card, border: `1px solid ${C.border}`, borderRadius: 2, boxShadow: C.shadow,
              display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

              {/* Sidebar header — always visible */}
              <Box sx={{
                display: "flex", alignItems: "center",
                justifyContent: sidebarOpen ? "space-between" : "center",
                px: sidebarOpen ? 1.5 : 0.5, py: 1,
                borderBottom: `1px solid ${C.border}`, flexShrink: 0,
              }}>
                {sidebarOpen && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ color: C.text, fontWeight: 600, fontSize: "0.82rem" }}>
                      Generated Newsletters
                    </Typography>
                    <Typography variant="caption" sx={{ color: C.textMuted, fontSize: "0.68rem" }}>
                      {newsletters.length} newsletter{newsletters.length !== 1 ? "s" : ""}
                    </Typography>
                  </Box>
                )}
                <Tooltip title={sidebarOpen ? "Collapse" : "Expand"} placement={isMobile ? "bottom" : "right"}>
                  <IconButton size="small" onClick={toggleSidebar}
                    sx={{ color: C.textMuted, p: 0.5, "&:hover": { color: C.text } }}>
                    {isMobile
                      ? (sidebarOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />)
                      : (sidebarOpen ? <ChevronLeftIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />)
                    }
                  </IconButton>
                </Tooltip>
              </Box>

              {/* Newsletter list — only when open */}
              {sidebarOpen && (
              <>
                {/* Date filter */}
                <Box sx={{ px: 1.5, pt: 1.2, pb: 0.8, flexShrink: 0 }}>
                  <TextField
                    type="date"
                    size="small"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <CalendarTodayIcon sx={{ fontSize: 13, color: C.textMuted }} />
                        </InputAdornment>
                      ),
                      endAdornment: dateFilter ? (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={() => setDateFilter("")}
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

                <CardContent sx={{ p: { xs: 2, md: 1.5 }, flex: 1, overflowY: "auto" }}>
                  <Stack spacing={1}>
                    {(dateFilter
                      ? newsletters.filter(nl => (nl.article_date || "").startsWith(dateFilter))
                      : newsletters
                    ).map((nl) => (
                      <SidebarNewsletterEntry
                        key={nl.id}
                        nl={nl}
                        isSelected={selected?.id === nl.id}
                        onSelect={() => {
                          setSelected(nl);
                          if (typeof window !== "undefined" && window.innerWidth < 960) setSidebarOpen(false);
                        }}
                        onDelete={handleDelete}
                        formatDate={formatDate}
                        selectedItemBg={selectedItemBg}
                        selectedItemBdr={selectedItemBdr}
                        C={C}
                      />
                    ))}
                  </Stack>
                </CardContent>
              </>
              )}
            </Card>
          </Box>

          {/* Right — preview */}
          <Box sx={{ flex: 1, minWidth: 0, overflowX: "hidden" }}>
            {selected ? (
              <Card sx={{ bgcolor: C.card, border: `1px solid ${C.border}`,
                borderRadius: 2, boxShadow: C.shadow }}>

                {/* Preview header with copy button */}
                <Box sx={{
                  display: "flex", alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: `1px solid ${C.border}`,
                  px: 2, py: 1.25,
                  flexWrap: "wrap", gap: 1,
                }}>
                  <Typography variant="subtitle1" sx={{ color: C.text, fontWeight: 600,
                    fontSize: { xs: "0.85rem", md: "0.95rem" } }}>
                    {selected.title}
                  </Typography>
                  <CopyButton newsletter={selected} />
                </Box>

                <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: C.cardInner }}>
                  <RenderedNewsletter newsletter={selected} />
                </Box>
              </Card>
            ) : (
              <Card sx={{ bgcolor: C.card, border: `1px solid ${C.border}`,
                borderRadius: 2, height: "100%", display: "flex",
                alignItems: "center", justifyContent: "center", boxShadow: C.shadow }}>
                <Box sx={{ textAlign: "center", py: 8 }}>
                  <ArticleIcon sx={{ color: C.border, fontSize: 48, mb: 2 }} />
                  <Typography variant="body2" sx={{ color: C.textSub }}>
                    Select a newsletter from the left to preview it
                  </Typography>
                </Box>
              </Card>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default Newsletter;
