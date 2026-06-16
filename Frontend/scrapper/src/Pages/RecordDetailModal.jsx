import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api";
import {
  Dialog, DialogTitle, DialogContent,
  Box, Typography, Chip, IconButton, Divider,
  CircularProgress, Button, Avatar,
} from "@mui/material";
import CloseIcon       from "@mui/icons-material/Close";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { useAppTheme } from "../AppThemeContext";

const API_BASE = "http://localhost:8000";

const PLATFORM_META = {
  reddit:        { label: "Reddit",          color: "#ff4500" },
  tiktok:        { label: "TikTok",          color: "#fe2c55" },
  edugeek:       { label: "EduGeek",         color: "#0066cc" },
  autodesk:      { label: "Autodesk",        color: "#0696D7" },
  stackexchange: { label: "StackExchange",   color: "#f48024" },
  google_news:   { label: "Google News",     color: "#4285f4" },
  instagram:     { label: "Instagram",       color: "#e1306c" },
  twitter:       { label: "Twitter / X",     color: "#1da1f2" },
  spiceworks:    { label: "Spiceworks",      color: "#e26c11" },
  quora:         { label: "Quora",           color: "#b92b27" },
  facebook:      { label: "Facebook Groups", color: "#1877f2" },
};

const AVATAR_PALETTE = [
  "#ff4500","#3b82f6","#10b981","#f59e0b",
  "#a855f7","#0696D7","#e1306c","#fe2c55","#06b6d4",
];
function authorColor(str = "") {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

function fmtNum(n) {
  if (n === null || n === undefined || n === "") return "—";
  if (typeof n === "string") return n;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1)     + "K";
  return String(n);
}
function fmtDate(d) {
  if (!d || d === "None" || d === "null") return "—";
  try { return new Date(d).toLocaleString(); } catch { return String(d); }
}

// ─── HtmlContent ─────────────────────────────────────────────────────────────
// Renders scraped HTML with theme-aware styling
function HtmlContent({ html, C }) {
  if (!html) return (
    <Typography sx={{ color: C.textMuted, fontStyle: "italic", fontSize: "0.85rem" }}>
      No content
    </Typography>
  );
  return (
    <Box
      dangerouslySetInnerHTML={{ __html: html }}
      sx={{
        color: C.text, fontSize: "0.875rem", lineHeight: 1.75, wordBreak: "break-word",
        "& p":           { mb: "10px", mt: 0, "&:last-child": { mb: 0 } },
        "& strong, & b": { fontWeight: 700 },
        "& em, & i":     { fontStyle: "italic" },
        "& ul, & ol":    { pl: "22px", mb: "10px", mt: 0 },
        "& li":          { mb: "3px" },
        "& a":           { color: "#3b82f6", textDecoration: "none", "&:hover": { textDecoration: "underline" } },
        "& table":       { width: "100%", borderCollapse: "collapse", mb: "14px", fontSize: "0.82rem" },
        "& th":          { bgcolor: C.cardInner, fontWeight: 700, color: C.text, p: "8px 12px", border: `1px solid ${C.border}`, textAlign: "left" },
        "& td":          { p: "8px 12px", border: `1px solid ${C.border}`, color: C.text, verticalAlign: "top" },
        "& tr:nth-of-type(even) td": { bgcolor: `${C.hover}60` },
        "& hr":          { border: "none", borderTop: `1px solid ${C.border}`, my: "14px" },
        "& h1":          { fontSize: "1.15rem", fontWeight: 700, mb: "8px", mt: "14px", color: C.text },
        "& h2":          { fontSize: "1.05rem", fontWeight: 700, mb: "8px", mt: "14px", color: C.text },
        "& h3":          { fontSize: "0.95rem", fontWeight: 700, mb: "6px", mt: "10px", color: C.text },
        "& blockquote":  { borderLeft: `3px solid ${C.border}`, ml: 0, pl: "14px", color: C.textSub, fontStyle: "italic" },
        "& code":        { fontFamily: "monospace", fontSize: "0.8rem", bgcolor: C.cardInner, px: "4px", borderRadius: "3px" },
        "& pre":         { fontFamily: "monospace", fontSize: "0.8rem", bgcolor: C.cardInner, p: "10px", borderRadius: "6px", overflow: "auto", my: "8px" },
        "& iframe":      { maxWidth: "100%", borderRadius: "6px", display: "block", mb: "10px" },
        "& img":         { maxWidth: "100%", borderRadius: "6px" },
        "& span":        { color: "inherit" },
        "& div":         { mb: "2px" },
      }}
    />
  );
}

// ─── PlainText ────────────────────────────────────────────────────────────────
function PlainText({ text, C }) {
  if (!text) return (
    <Typography sx={{ color: C.textMuted, fontStyle: "italic", fontSize: "0.85rem" }}>No content</Typography>
  );
  return (
    <Typography sx={{ color: C.text, fontSize: "0.875rem", lineHeight: 1.75, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {text}
    </Typography>
  );
}

// ─── AuthorRow ────────────────────────────────────────────────────────────────
function AuthorRow({ username, rank, date, platformColor, badge, C }) {
  const color = platformColor || authorColor(username || "");
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <Avatar sx={{ bgcolor: color, width: 30, height: 30, fontSize: "0.72rem", fontWeight: 700, flexShrink: 0 }}>
        {(username || "?")[0].toUpperCase()}
      </Avatar>
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
          <Typography sx={{ color, fontWeight: 700, fontSize: "0.85rem" }}>{username || "Unknown"}</Typography>
          {rank && (
            <Chip label={rank} size="small"
              sx={{ bgcolor: `${color}18`, color, fontSize: "0.63rem", height: 17, fontWeight: 600 }} />
          )}
          {badge}
        </Box>
        {date && (
          <Typography sx={{ color: C.textMuted, fontSize: "0.7rem" }}>{fmtDate(date)}</Typography>
        )}
      </Box>
    </Box>
  );
}

// ─── StatPills ────────────────────────────────────────────────────────────────
function StatPills({ items, C }) {
  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      {items.filter((s) => s.value != null && s.value !== "").map((s, i) => (
        <Box key={i} sx={{
          display: "flex", alignItems: "center", gap: 0.5,
          px: 1.5, py: 0.6, bgcolor: C.cardInner,
          borderRadius: 1, border: `1px solid ${C.border}`,
        }}>
          <Typography sx={{ color: s.color || "#3b82f6", fontWeight: 700, fontSize: "0.85rem" }}>
            {fmtNum(s.value)}
          </Typography>
          <Typography sx={{ color: C.textMuted, fontSize: "0.7rem" }}>{s.label}</Typography>
        </Box>
      ))}
    </Box>
  );
}

// ─── ThreadDivider ────────────────────────────────────────────────────────────
function ThreadDivider({ label, C }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, my: 2.5 }}>
      <Divider sx={{ flex: 1, bgcolor: C.border }} />
      <Typography sx={{ color: C.textSub, fontSize: "0.78rem", fontWeight: 600, px: 1, whiteSpace: "nowrap" }}>
        {label}
      </Typography>
      <Divider sx={{ flex: 1, bgcolor: C.border }} />
    </Box>
  );
}

// ─── ReplyCard ────────────────────────────────────────────────────────────────
// Reusable left-border reply card used by Autodesk, EduGeek, Reddit, SE
function ReplyCard({ accentColor, isSolved, children, C }) {
  return (
    <Box sx={{ display: "flex" }}>
      <Box sx={{
        width: 3, flexShrink: 0, borderRadius: "2px",
        bgcolor: isSolved ? "#10b981" : (accentColor || C.border),
        mr: 2,
      }} />
      <Box sx={{
        flex: 1, bgcolor: C.cardInner,
        border: `1px solid ${isSolved ? "#10b98130" : C.border}`,
        borderRadius: 1.5, p: 2,
      }}>
        {children}
      </Box>
    </Box>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  PLATFORM VIEWS
// ════════════════════════════════════════════════════════════════════════════

// ─── Autodesk ─────────────────────────────────────────────────────────────────
function AutodeskView({ data, C }) {
  const pc = "#0696D7";
  const a  = data.author || {};
  const b  = data.board  || {};

  return (
    <>
      {/* Post meta card */}
      <Box sx={{ bgcolor: C.cardInner, border: `1px solid ${C.border}`, borderRadius: 1.5, p: 2, mb: 2.5 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 1 }}>
          <AuthorRow
            username={a.username} rank={a.rank} date={data.created_at}
            platformColor={pc} C={C}
            badge={a.solutions > 0 ? (
              <Chip label={`${a.solutions} solutions`} size="small"
                sx={{ bgcolor: "#10b98118", color: "#10b981", fontSize: "0.63rem", height: 17 }} />
            ) : null}
          />
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            {data.is_solved && (
              <Chip icon={<CheckCircleIcon sx={{ fontSize: "13px !important" }} />}
                label="Solved" size="small"
                sx={{ bgcolor: "#10b981", color: "white", fontWeight: 700, fontSize: "0.72rem" }} />
            )}
          </Box>
        </Box>

        {b.title && (
          <Typography sx={{ color: C.textMuted, fontSize: "0.74rem", mt: 0.75 }}>📋 {b.title}</Typography>
        )}

        {/* Author stats */}
        <Box sx={{ display: "flex", gap: 0, mt: 1.5, flexWrap: "wrap" }}>
          {[
            { val: data.kudos,    label: "Post kudos", color: "#f59e0b" },
            { val: data.reply_count, label: "Replies" },
            { val: a.kudos,      label: "Author kudos", color: pc },
            { val: a.messages,   label: "Posts" },
          ].filter(s => s.val > 0).map((s, i) => (
            <Box key={i} sx={{ textAlign: "center", px: 1.5, borderRight: `1px solid ${C.border}`, "&:last-child": { borderRight: "none" } }}>
              <Typography sx={{ color: s.color || C.text, fontWeight: 700, fontSize: "0.95rem" }}>{fmtNum(s.val)}</Typography>
              <Typography sx={{ color: C.textMuted, fontSize: "0.66rem" }}>{s.label}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Post body — HTML */}
      <HtmlContent html={data.body} C={C} />

      {/* Replies thread */}
      {data.replies?.length > 0 && (
        <>
          <ThreadDivider label={`${data.replies.length} ${data.replies.length === 1 ? "Reply" : "Replies"}`} C={C} />
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {data.replies.map((r, i) => (
              <ReplyCard key={i} accentColor={pc} isSolved={r.is_solved} C={C}>
                <Box sx={{ display: "flex", alignItems: "center", gap: "5px", mb: 1 }}>
                  <Typography sx={{ color: r.is_solved ? "#10b981" : pc, fontSize: "0.8rem", lineHeight: 1, userSelect: "none" }}>↳</Typography>
                  <Typography sx={{ color: r.is_solved ? "#10b981" : C.textMuted, fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>
                    {r.is_solved ? "Solution" : "Reply"}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1.5, flexWrap: "wrap", gap: 1 }}>
                  <AuthorRow
                    username={r.author_username} rank={r.author_rank}
                    date={r.created_at}
                    platformColor={r.is_solved ? "#10b981" : pc} C={C}
                  />
                  <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                    {r.is_solved && (
                      <Chip icon={<CheckCircleIcon sx={{ fontSize: "13px !important" }} />}
                        label="Solution" size="small"
                        sx={{ bgcolor: "#10b981", color: "white", fontWeight: 700, fontSize: "0.68rem" }} />
                    )}
                    {r.kudos > 0 && (
                      <Chip label={`👍 ${r.kudos}`} size="small"
                        sx={{ bgcolor: C.hover, color: C.textSub, fontSize: "0.68rem" }} />
                    )}
                  </Box>
                </Box>
                {r.subject && r.subject !== data.subject && (
                  <Typography sx={{ color: C.textMuted, fontStyle: "italic", fontSize: "0.78rem", mb: 1 }}>
                    Re: {r.subject}
                  </Typography>
                )}
                <HtmlContent html={r.body} C={C} />
              </ReplyCard>
            ))}
          </Box>
        </>
      )}
    </>
  );
}

// ─── Reddit ───────────────────────────────────────────────────────────────────
function RedditView({ data, C }) {
  const pc = "#ff4500";

  // Recursive: no depth limit, no reply count limit — shows everything
  const renderComment = (c, depth = 0) => {
    const cc      = authorColor(c.author || "");
    const replies = c.replies || [];

    return (
      <Box sx={{ display: "flex", gap: "10px", alignItems: "stretch" }}>

        {/* ── Left column: avatar + vertical thread line ── */}
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 28 }}>
          <Avatar sx={{ bgcolor: cc, width: 28, height: 28, fontSize: "0.68rem", fontWeight: 700, flexShrink: 0 }}>
            {(c.author || "?")[0].toUpperCase()}
          </Avatar>
          {/* Line runs down to cover full height of all nested replies */}
          {replies.length > 0 && (
            <Box sx={{
              width: 2, flex: 1, mt: "6px", borderRadius: "2px",
              bgcolor: `${pc}55`,
              cursor: "default",
            }} />
          )}
        </Box>

        {/* ── Right column: header + body + nested replies ── */}
        <Box sx={{ flex: 1, minWidth: 0, pb: replies.length > 0 ? 0.5 : 0 }}>
          {/* Header row */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.4, flexWrap: "wrap" }}>
            <Typography sx={{ color: cc, fontWeight: 700, fontSize: "0.82rem", lineHeight: 1 }}>
              u/{c.author || "[deleted]"}
            </Typography>
            <Box sx={{
              display: "flex", alignItems: "center", gap: "2px",
              bgcolor: (c.score ?? 0) > 0 ? `${pc}15` : C.hover,
              px: 0.6, py: "1px", borderRadius: "4px",
            }}>
              <Typography sx={{ color: pc, fontWeight: 700, fontSize: "0.68rem" }}>▲</Typography>
              <Typography sx={{ color: (c.score ?? 0) > 0 ? pc : C.textMuted, fontWeight: 700, fontSize: "0.72rem" }}>
                {fmtNum(c.score ?? 0)}
              </Typography>
            </Box>
            <Typography sx={{ color: C.textMuted, fontSize: "0.67rem" }}>
              {fmtDate(c.created_at)}
            </Typography>
          </Box>

          {/* Body */}
          <PlainText text={c.body} C={C} />

          {/* Nested replies — each prefixed with ↳ arrow to show reply relationship */}
          {replies.length > 0 && (
            <Box sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
              {replies.map((r, i) => (
                <Box key={i} sx={{ display: "flex", alignItems: "flex-start", gap: "5px" }}>
                  <Typography sx={{ color: `${pc}90`, fontSize: "0.88rem", lineHeight: 1, mt: "5px", flexShrink: 0, userSelect: "none" }}>
                    ↳
                  </Typography>
                  <Box sx={{ flex: 1 }}>{renderComment(r, depth + 1)}</Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>

      </Box>
    );
  };

  return (
    <>
      <StatPills items={[
        { value: data.score, label: "score", color: pc },
        { value: data.upvote_ratio != null ? `${Math.round(data.upvote_ratio * 100)}%` : null, label: "upvotes" },
        { value: data.num_comments, label: "comments" },
      ]} C={C} />

      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mt: 1.5, mb: 2.5 }}>
        {data.subreddit && (
          <Chip label={`r/${data.subreddit}`} size="small"
            sx={{ bgcolor: pc, color: "white", fontWeight: 600, fontSize: "0.75rem" }} />
        )}
        {data.flair && (
          <Chip label={data.flair} size="small" sx={{ bgcolor: C.hover, color: C.textSub, fontSize: "0.72rem" }} />
        )}
        {data.is_nsfw && (
          <Chip label="NSFW" size="small" sx={{ bgcolor: "#ef4444", color: "white", fontSize: "0.72rem" }} />
        )}
      </Box>

      <PlainText text={data.body} C={C} />

      {data.url_content && (
        <>
          <Divider sx={{ bgcolor: C.border, my: 2 }} />
          <Typography sx={{ color: C.textMuted, fontSize: "0.7rem", mb: 0.75, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Linked Content
          </Typography>
          <PlainText text={data.url_content} C={C} />
        </>
      )}

      {data.comments?.length > 0 ? (
        <>
          <ThreadDivider label={`${data.comments.length} Comments`} C={C} />
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {data.comments.map((c, i) => (
              <Box key={i}>{renderComment(c, 0)}</Box>
            ))}
          </Box>
        </>
      ) : data.num_comments > 0 ? (
        <>
          <ThreadDivider label={`${data.num_comments} Comments`} C={C} />
          <Typography sx={{ color: C.textMuted, fontSize: "0.8rem", fontStyle: "italic", py: 1 }}>
            Comments could not be retrieved — Reddit restricts unauthenticated access to this subreddit.
          </Typography>
        </>
      ) : null}
    </>
  );
}

// ─── EduGeek ──────────────────────────────────────────────────────────────────
function EduGeekView({ data, C }) {
  const pc = "#0066cc";
  return (
    <>
      {data.reply_count > 0 && (
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mb: 2 }}>
          <Chip label={`${data.reply_count} replies`} size="small"
            sx={{ bgcolor: C.hover, color: C.textSub, fontSize: "0.72rem" }} />
        </Box>
      )}

      <Box sx={{ bgcolor: C.cardInner, border: `1px solid ${C.border}`, borderRadius: 1.5, p: 1.5, mb: 2.5 }}>
        <AuthorRow username={data.author} rank={data.author_rep} date={data.created_at} platformColor={pc} C={C} />
      </Box>

      <HtmlContent html={data.body} C={C} />

      {data.replies?.length > 0 && (
        <>
          <ThreadDivider label={`${data.replies.length} ${data.replies.length === 1 ? "Reply" : "Replies"}`} C={C} />
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {data.replies.map((r, i) => (
              <ReplyCard key={i} accentColor={pc} C={C}>
                <Box sx={{ display: "flex", alignItems: "center", gap: "5px", mb: 1 }}>
                  <Typography sx={{ color: pc, fontSize: "0.8rem", lineHeight: 1, userSelect: "none" }}>↳</Typography>
                  <Typography sx={{ color: C.textMuted, fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>Reply</Typography>
                </Box>
                <Box sx={{ mb: 1.5 }}>
                  <AuthorRow username={r.author} date={r.created_at} platformColor={pc} C={C} />
                </Box>
                <HtmlContent html={r.body} C={C} />
              </ReplyCard>
            ))}
          </Box>
        </>
      )}
    </>
  );
}

// ─── StackExchange ────────────────────────────────────────────────────────────
function StackExchangeView({ data, C }) {
  const pc = "#f48024";
  const sorted = [...(data.answers || [])].sort(
    (a, b) => (b.is_accepted ? 1 : 0) - (a.is_accepted ? 1 : 0) || b.score - a.score
  );

  const InlineComments = ({ comments }) =>
    comments?.length > 0 ? (
      <Box sx={{ mt: 1.5, pt: 1.5, borderTop: `1px solid ${C.border}` }}>
        {comments.map((c, i) => (
          <Box key={i} sx={{ display: "flex", gap: "6px", mb: 0.75, alignItems: "flex-start" }}>
            <Typography sx={{ color: `${pc}80`, fontSize: "0.82rem", lineHeight: 1, mt: "2px", flexShrink: 0, userSelect: "none" }}>↳</Typography>
            <Box>
              <Typography sx={{ color: C.text, fontSize: "0.8rem", lineHeight: 1.6 }}>{c.body}</Typography>
              <Typography sx={{ color: C.textMuted, fontSize: "0.67rem" }}>
                — {c.author_username} · {fmtNum(c.author_reputation)} rep · {fmtDate(c.created_at)}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
    ) : null;

  return (
    <>
      <StatPills items={[
        { value: data.score, label: "score", color: pc },
        { value: data.views, label: "views" },
        { value: data.answer_count, label: "answers", color: data.is_answered ? "#10b981" : undefined },
      ]} C={C} />

      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mt: 1.5, mb: 2 }}>
        {data.is_answered && (
          <Chip icon={<CheckCircleIcon sx={{ fontSize: "13px !important" }} />}
            label="Answered" size="small"
            sx={{ bgcolor: "#10b981", color: "white", fontWeight: 700, fontSize: "0.72rem" }} />
        )}
        {data.site && (
          <Chip label={data.site} size="small"
            sx={{ bgcolor: pc, color: "white", fontWeight: 600, fontSize: "0.75rem" }} />
        )}
        {data.tags && data.tags.split(/\s+/).filter(Boolean).map((t, i) => (
          <Chip key={i} label={t} size="small"
            sx={{ bgcolor: C.hover, color: C.textSub, fontSize: "0.72rem" }} />
        ))}
      </Box>

      <Box sx={{ bgcolor: C.cardInner, border: `1px solid ${C.border}`, borderRadius: 1.5, p: 1.5, mb: 2.5 }}>
        <AuthorRow
          username={data.author?.username} date={data.created_at}
          platformColor={pc} C={C}
          badge={data.author?.reputation > 0 ? (
            <Chip label={`${fmtNum(data.author.reputation)} rep`} size="small"
              sx={{ bgcolor: `${pc}18`, color: pc, fontSize: "0.63rem", height: 17 }} />
          ) : null}
        />
      </Box>

      <HtmlContent html={data.body} C={C} />
      <InlineComments comments={data.comments} />

      {sorted.length > 0 && (
        <>
          <ThreadDivider label={`${sorted.length} ${sorted.length === 1 ? "Answer" : "Answers"}`} C={C} />
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {sorted.map((ans, i) => (
              <ReplyCard key={i} accentColor={pc} isSolved={ans.is_accepted} C={C}>
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1.5, flexWrap: "wrap", gap: 1 }}>
                  <AuthorRow
                    username={ans.author?.username} date={ans.created_at}
                    platformColor={ans.is_accepted ? "#10b981" : pc} C={C}
                    badge={ans.author?.reputation > 0 ? (
                      <Chip label={`${fmtNum(ans.author.reputation)} rep`} size="small"
                        sx={{ bgcolor: `${pc}18`, color: pc, fontSize: "0.63rem", height: 17 }} />
                    ) : null}
                  />
                  <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                    {ans.is_accepted && (
                      <Chip icon={<CheckCircleIcon sx={{ fontSize: "13px !important" }} />}
                        label="Accepted" size="small"
                        sx={{ bgcolor: "#10b981", color: "white", fontWeight: 700, fontSize: "0.68rem" }} />
                    )}
                    <Chip label={`↑ ${ans.score}`} size="small" sx={{
                      bgcolor: ans.score > 0 ? `${pc}18` : C.hover,
                      color: ans.score > 0 ? pc : C.textMuted,
                      fontSize: "0.7rem", fontWeight: 600,
                    }} />
                  </Box>
                </Box>
                <HtmlContent html={ans.body} C={C} />
                <InlineComments comments={ans.comments} />
              </ReplyCard>
            ))}
          </Box>
        </>
      )}
    </>
  );
}

// ─── TikTok ───────────────────────────────────────────────────────────────────
function TikTokView({ data, C }) {
  const pc = "#fe2c55";
  const a  = data.author || {};
  const s  = data.stats  || {};
  const v  = data.video  || {};
  const m  = data.music  || {};

  return (
    <>
      <StatPills items={[
        { value: s.plays,    label: "plays",    color: pc },
        { value: s.likes,    label: "likes",    color: pc },
        { value: s.comments, label: "comments" },
        { value: s.shares,   label: "shares"   },
        { value: s.saves,    label: "saves"    },
      ]} C={C} />

      <Box sx={{ bgcolor: C.cardInner, border: `1px solid ${C.border}`, borderRadius: 1.5, p: 2, mt: 2, mb: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
          <Avatar sx={{ bgcolor: pc, width: 42, height: 42, fontWeight: 700, fontSize: "1.1rem", flexShrink: 0 }}>
            {(a.username || "?")[0].toUpperCase()}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.25 }}>
              <Typography sx={{ color: C.text, fontWeight: 700 }}>@{a.username}</Typography>
              {a.verified && <CheckCircleIcon sx={{ color: "#3b82f6", fontSize: 15 }} />}
            </Box>
            {a.nickname && a.nickname !== a.username && (
              <Typography sx={{ color: C.textSub, fontSize: "0.8rem" }}>{a.nickname}</Typography>
            )}
            {a.bio && <Typography sx={{ color: C.textSub, fontSize: "0.8rem", mt: 0.5 }}>{a.bio}</Typography>}
          </Box>
          <Box sx={{ display: "flex", gap: 2, flexShrink: 0 }}>
            {[{ v: a.followers, l: "Followers" }, { v: a.following, l: "Following" }, { v: a.likes, l: "Likes" }]
              .filter(x => x.v > 0).map((x, i) => (
                <Box key={i} sx={{ textAlign: "center" }}>
                  <Typography sx={{ color: C.text, fontWeight: 700, fontSize: "0.9rem" }}>{fmtNum(x.v)}</Typography>
                  <Typography sx={{ color: C.textMuted, fontSize: "0.64rem" }}>{x.l}</Typography>
                </Box>
              ))}
          </Box>
        </Box>
      </Box>

      <PlainText text={data.title} C={C} />

      {data.hashtags && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 1.5 }}>
          {data.hashtags.split(/\s+/).filter((h) => h.startsWith("#")).map((h, i) => (
            <Chip key={i} label={h} size="small" sx={{ bgcolor: C.hover, color: pc, fontSize: "0.72rem" }} />
          ))}
        </Box>
      )}

      {(m.title || m.artist || v.duration_sec > 0) && (
        <Box sx={{ display: "flex", gap: 1, mt: 1.5, flexWrap: "wrap" }}>
          {(m.title || m.artist) && (
            <Chip label={`🎵 ${[m.title, m.artist].filter(Boolean).join(" — ")}`}
              size="small" sx={{ bgcolor: C.cardInner, color: C.textSub, fontSize: "0.78rem", height: 26 }} />
          )}
          {v.duration_sec > 0 && (
            <Chip label={`⏱ ${v.duration_sec}s`} size="small"
              sx={{ bgcolor: C.cardInner, color: C.textSub, fontSize: "0.78rem", height: 26 }} />
          )}
        </Box>
      )}

      {data.comments?.length > 0 && (
        <>
          <ThreadDivider label={`${data.comments.length} Comments`} C={C} />
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {data.comments.slice(0, 30).map((c, i) => (
              <ReplyCard key={i} accentColor={pc} C={C}>
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.75, flexWrap: "wrap", gap: 0.5 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                    <Avatar sx={{ bgcolor: authorColor(c.author_username || ""), width: 22, height: 22, fontSize: "0.6rem" }}>
                      {(c.author_username || "?")[0].toUpperCase()}
                    </Avatar>
                    <Typography sx={{ color: pc, fontWeight: 600, fontSize: "0.8rem" }}>
                      @{c.author_username}
                    </Typography>
                    {c.likes > 0 && (
                      <Chip label={`♥ ${fmtNum(c.likes)}`} size="small"
                        sx={{ bgcolor: `${pc}12`, color: pc, fontSize: "0.62rem", height: 17 }} />
                    )}
                  </Box>
                  <Typography sx={{ color: C.textMuted, fontSize: "0.67rem" }}>{fmtDate(c.created_at)}</Typography>
                </Box>
                <PlainText text={c.text} C={C} />
              </ReplyCard>
            ))}
          </Box>
        </>
      )}
    </>
  );
}

// ─── Google News ──────────────────────────────────────────────────────────────
function GoogleNewsView({ data, C }) {
  const pc = "#4285f4";
  return (
    <>
      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mb: 2 }}>
        {data.source_name && (
          <Chip label={data.source_name} size="small"
            sx={{ bgcolor: pc, color: "white", fontWeight: 600, fontSize: "0.75rem" }} />
        )}
        {data.topic && (
          <Chip label={data.topic} size="small" sx={{ bgcolor: C.hover, color: C.textSub, fontSize: "0.72rem" }} />
        )}
        {data.word_count > 0 && (
          <Chip label={`${data.word_count} words`} size="small"
            sx={{ bgcolor: C.hover, color: C.textSub, fontSize: "0.72rem" }} />
        )}
      </Box>

      {data.image_url && (
        <Box component="img" src={data.image_url} alt="Article"
          sx={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 1.5, mb: 2.5, border: `1px solid ${C.border}` }}
          onError={(e) => { e.target.style.display = "none"; }}
        />
      )}

      {data.description && (
        <Box sx={{ bgcolor: C.cardInner, border: `1px solid ${C.border}`, borderRadius: 1.5, p: 2, mb: 2 }}>
          <Typography sx={{ color: C.textMuted, fontSize: "0.7rem", mb: 0.75, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Summary
          </Typography>
          <PlainText text={data.description} C={C} />
        </Box>
      )}

      {data.full_text && (
        <>
          <ThreadDivider label="Full Article" C={C} />
          <PlainText text={data.full_text} C={C} />
        </>
      )}

      {(data.search_query || data.source_url) && (
        <Box sx={{ mt: 2.5, bgcolor: C.cardInner, border: `1px solid ${C.border}`, borderRadius: 1.5, p: 2, display: "flex", gap: 3, flexWrap: "wrap" }}>
          {data.search_query && (
            <Box>
              <Typography sx={{ color: C.textMuted, fontSize: "0.7rem", mb: 0.3 }}>Search Query</Typography>
              <Typography sx={{ color: C.text, fontSize: "0.82rem" }}>{data.search_query}</Typography>
            </Box>
          )}
          {data.source_url && (
            <Box>
              <Typography sx={{ color: C.textMuted, fontSize: "0.7rem", mb: 0.3 }}>Source</Typography>
              <Typography component="a" href={data.source_url} target="_blank" rel="noreferrer"
                sx={{ color: pc, fontSize: "0.82rem", textDecoration: "none", "&:hover": { textDecoration: "underline" } }}>
                {data.source_url}
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </>
  );
}

// ─── Instagram ────────────────────────────────────────────────────────────────
function InstagramView({ data, C }) {
  const pc = "#e1306c";
  return (
    <>
      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mb: 2 }}>
        {data.post_type && (
          <Chip label={data.post_type} size="small"
            sx={{ bgcolor: pc, color: "white", fontWeight: 600, fontSize: "0.75rem" }} />
        )}
        {data.is_comments_disabled && (
          <Chip label="Comments disabled" size="small" sx={{ bgcolor: C.hover, color: C.textMuted, fontSize: "0.72rem" }} />
        )}
      </Box>

      {(data.display_url || data.image_url) && (
        <Box component="img" src={data.display_url || data.image_url} alt={data.alt_text || "Post"}
          sx={{ width: "100%", maxHeight: 320, objectFit: "cover", borderRadius: 1.5, mb: 2, border: `1px solid ${C.border}` }}
          onError={(e) => { e.target.style.display = "none"; }}
        />
      )}

      <Box sx={{ bgcolor: C.cardInner, border: `1px solid ${C.border}`, borderRadius: 1.5, p: 1.5, mb: 2.5 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: pc, width: 38, height: 38, fontWeight: 700 }}>
              {(data.owner_username || "?")[0].toUpperCase()}
            </Avatar>
            <Box>
              <Typography sx={{ color: pc, fontWeight: 700 }}>@{data.owner_username}</Typography>
              {data.owner_full_name && (
                <Typography sx={{ color: C.textSub, fontSize: "0.78rem" }}>{data.owner_full_name}</Typography>
              )}
            </Box>
          </Box>
          <StatPills items={[
            { value: data.likes_count, label: "likes", color: pc },
            { value: data.comments_count, label: "comments" },
          ]} C={C} />
        </Box>
      </Box>

      <PlainText text={data.caption} C={C} />

      {data.hashtags && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 1.5 }}>
          {data.hashtags.split(/\s+/).filter((h) => h.startsWith("#")).map((h, i) => (
            <Chip key={i} label={h} size="small" sx={{ bgcolor: C.hover, color: pc, fontSize: "0.72rem" }} />
          ))}
        </Box>
      )}

      {data.mentions && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.75 }}>
          {data.mentions.split(/\s+/).filter((m) => m.startsWith("@")).map((m, i) => (
            <Chip key={i} label={m} size="small" sx={{ bgcolor: C.hover, color: C.textSub, fontSize: "0.72rem" }} />
          ))}
        </Box>
      )}

      {data.comments?.length > 0 && (
        <>
          <ThreadDivider label={`${data.comments.length} Comments`} C={C} />
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {data.comments.slice(0, 30).map((c, i) => (
              <ReplyCard key={i} accentColor={pc} C={C}>
                <Typography sx={{ color: pc, fontWeight: 600, fontSize: "0.78rem", mb: 0.5 }}>
                  @{c.owner_username}
                </Typography>
                <PlainText text={c.text} C={C} />
              </ReplyCard>
            ))}
          </Box>
        </>
      )}
    </>
  );
}

// ─── Twitter ──────────────────────────────────────────────────────────────────
function TwitterView({ data, C }) {
  const pc = "#1da1f2";
  const a  = data.author || {};
  return (
    <>
      <StatPills items={[
        { value: data.views,     label: "views",     color: pc       },
        { value: data.favorites, label: "likes",     color: "#e1306c"},
        { value: data.retweets,  label: "retweets",  color: "#10b981"},
        { value: data.replies,   label: "replies"   },
        { value: data.quotes,    label: "quotes"    },
        { value: data.bookmarks, label: "bookmarks" },
      ]} C={C} />

      <Box sx={{ bgcolor: C.cardInner, border: `1px solid ${C.border}`, borderRadius: 1.5, p: 2, mt: 2, mb: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
          {a.avatar ? (
            <Box component="img" src={a.avatar} alt={a.name}
              sx={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
              onError={(e) => { e.target.style.display = "none"; }}
            />
          ) : (
            <Avatar sx={{ bgcolor: pc, width: 44, height: 44, fontWeight: 700, flexShrink: 0 }}>
              {(a.name || data.screen_name || "?")[0].toUpperCase()}
            </Avatar>
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Typography sx={{ color: C.text, fontWeight: 700 }}>{a.name}</Typography>
              {a.verified && <CheckCircleIcon sx={{ color: pc, fontSize: 15 }} />}
            </Box>
            <Typography sx={{ color: C.textSub, fontSize: "0.82rem" }}>@{data.screen_name}</Typography>
            {a.description && (
              <Typography sx={{ color: C.textSub, fontSize: "0.8rem", mt: 0.5 }}>{a.description}</Typography>
            )}
            {a.location && (
              <Typography sx={{ color: C.textMuted, fontSize: "0.75rem", mt: 0.25 }}>📍 {a.location}</Typography>
            )}
          </Box>
          <Box sx={{ display: "flex", gap: 2, flexShrink: 0 }}>
            {[{ v: a.followers_count, l: "Followers" }, { v: a.friends_count, l: "Following" }]
              .filter(x => x.v > 0).map((x, i) => (
                <Box key={i} sx={{ textAlign: "center" }}>
                  <Typography sx={{ color: C.text, fontWeight: 700, fontSize: "0.9rem" }}>{fmtNum(x.v)}</Typography>
                  <Typography sx={{ color: C.textMuted, fontSize: "0.64rem" }}>{x.l}</Typography>
                </Box>
              ))}
          </Box>
        </Box>
      </Box>

      <PlainText text={data.text} C={C} />

      {(() => {
        let tags = data.hashtags;
        if (typeof tags === "string") { try { tags = JSON.parse(tags); } catch { tags = []; } }
        tags = Array.isArray(tags) ? tags.filter(Boolean) : [];
        if (!tags.length) return null;
        return (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 1.5 }}>
            {tags.map((h, i) => (
              <Chip key={i} label={h.startsWith("#") ? h : `#${h}`} size="small"
                sx={{ bgcolor: C.hover, color: pc, fontSize: "0.72rem" }} />
            ))}
          </Box>
        );
      })()}

      {data.media_url && (
        <>
          <Divider sx={{ bgcolor: C.border, my: 2 }} />
          <Box component="img" src={data.media_url} alt="Media"
            sx={{ width: "100%", maxHeight: 300, objectFit: "cover", borderRadius: 1.5, border: `1px solid ${C.border}` }}
            onError={(e) => { e.target.style.display = "none"; }}
          />
        </>
      )}
    </>
  );
}

// ─── Spiceworks ───────────────────────────────────────────────────────────────
function SpiceworksView({ data, C }) {
  const pc   = "#e26c11";
  const tags = Array.isArray(data.tags)
    ? data.tags
    : (typeof data.tags === "string" ? data.tags.split(/,\s*/).filter(Boolean) : []);

  return (
    <>
      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mb: 2 }}>
        <Chip label={data.source || "Article"} size="small"
          sx={{ bgcolor: pc, color: "white", fontWeight: 600, fontSize: "0.75rem" }} />
        {data.category && (
          <Chip label={data.category} size="small"
            sx={{ bgcolor: C.hover, color: C.textSub, fontSize: "0.72rem" }} />
        )}
      </Box>

      {data.thumbnail && (
        <Box component="img" src={data.thumbnail} alt="Thumbnail"
          sx={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 1.5, mb: 2.5, border: `1px solid ${C.border}` }}
          onError={(e) => { e.target.style.display = "none"; }}
        />
      )}

      <PlainText text={data.body} C={C} />

      {tags.length > 0 && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 2 }}>
          {tags.map((t, i) => (
            <Chip key={i} label={t} size="small"
              sx={{ bgcolor: `${pc}18`, color: pc, fontSize: "0.72rem" }} />
          ))}
        </Box>
      )}
    </>
  );
}

// ─── QuoraView ────────────────────────────────────────────────────────────────
function QuoraView({ data, C }) {
  const pc      = "#b92b27";
  const answers = data.answers || [];

  return (
    <>
      {/* Topics row */}
      <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.6, mb: 2 }}>
        {(data.topics || []).map((t, i) => (
          <Chip key={i} label={t} size="small"
            sx={{ bgcolor: `${pc}18`, color: pc, fontSize: "0.72rem" }} />
        ))}
      </Box>

      <StatPills C={C} items={[
        { label: "Answers", value: data.answer_count },
      ]} />

      {answers.length > 0 && (
        <>
          <ThreadDivider label={`${answers.length} Answer${answers.length !== 1 ? "s" : ""}`} C={C} />
          {answers.map((a, idx) => (
            <ReplyCard key={idx} accentColor={pc} C={C}>
              <AuthorRow
                username={a.author_name || "Anonymous"}
                rank={a.author_credential || null}
                date={a.created_at}
                platformColor={pc}
                badge={a.is_ai_answer ? (
                  <Chip label="AI" size="small"
                    sx={{ bgcolor: "#7c3aed18", color: "#7c3aed", fontSize: "0.6rem", height: 15, fontWeight: 700 }} />
                ) : null}
                C={C}
              />
              <Box sx={{ mt: 1 }}>
                <StatPills C={C} items={[
                  { label: "upvotes",  value: a.upvotes,        color: "#10b981" },
                  { label: "views",    value: a.views,          color: "#3b82f6" },
                  { label: "shares",   value: a.shares,         color: "#f59e0b" },
                  { label: "comments", value: a.comments_count, color: "#a855f7" },
                ]} />
              </Box>
              {a.content && (
                <Box sx={{ mt: 1.5 }}>
                  <PlainText text={a.content} C={C} />
                </Box>
              )}
            </ReplyCard>
          ))}
        </>
      )}
    </>
  );
}

// ─── Facebook ────────────────────────────────────────────────────────────────
function FacebookView({ data, C }) {
  const pc       = "#1877f2";
  const comments = data.matched_comments || [];

  return (
    <>
      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mb: 2 }}>
        <Chip label="Facebook Group" size="small"
          sx={{ bgcolor: pc, color: "white", fontWeight: 600, fontSize: "0.75rem" }} />
        {data.group_url && (
          <Typography component="a" href={data.group_url} target="_blank" rel="noreferrer"
            sx={{ fontSize: "0.75rem", color: pc, alignSelf: "center",
                  textDecoration: "none", "&:hover": { textDecoration: "underline" } }}>
            View Group ↗
          </Typography>
        )}
      </Box>

      <StatPills C={C} items={[
        { label: "likes",    value: data.likes_count,    color: pc },
        { label: "comments", value: data.comments_count, color: "#10b981" },
      ]} />

      <Box sx={{ mt: 2 }}>
        <PlainText text={data.text} C={C} />
      </Box>

      {comments.length > 0 && (
        <>
          <ThreadDivider
            label={`${comments.length} Matched Comment${comments.length !== 1 ? "s" : ""}`}
            C={C}
          />
          {comments.map((c, idx) => (
            <ReplyCard key={idx} accentColor={pc} C={C}>
              <AuthorRow
                username={c.author || "Unknown"}
                date={c.created_at}
                platformColor={pc}
                C={C}
              />
              <Box sx={{ mt: 1 }}>
                <PlainText text={c.text} C={C} />
              </Box>
            </ReplyCard>
          ))}
        </>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  MAIN EXPORT
// ════════════════════════════════════════════════════════════════════════════
export default function RecordDetailModal({ open, onClose, row }) {
  const { C } = useAppTheme();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const doFetch = useCallback(() => {
    if (!row) return;
    setData(null); setError(null); setLoading(true);
    const src      = row.platform;
    const nativeId = src === "google_news"
      ? (row._raw?.google_news_url || row._raw?.url || row.url || "")
      : (row._raw?.id || row.url || row.id || "");
    apiFetch(`${API_BASE}/api/record/${src}/${encodeURIComponent(nativeId)}`)
      .then((r) => r.ok ? r.json() : r.json().then((e) => { throw new Error(e.detail || `HTTP ${r.status}`); }))
      .then((j) => setData(j.data))
      .catch((e) => setError(e.message))
      .finally(()  => setLoading(false));
  }, [row]);

  useEffect(() => { if (open && row) doFetch(); }, [open, row, doFetch]);

  if (!row) return null;

  const meta    = PLATFORM_META[row.platform] || { label: row.platform, color: "#64748b" };
  const title   = row._raw?.title || row._raw?.subject || row._raw?.caption?.slice(0, 120) || row._raw?.body?.slice(0, 120) || row._raw?.text?.slice(0, 120) || `Record ${row.id}`;
  const author  = row.author;
  const dateStr = row.date ? fmtDate(row.date) : null;
  const url     = row.url;

  const renderContent = () => {
    if (loading) return (
      <Box sx={{ py: 8, textAlign: "center" }}>
        <CircularProgress size={38} sx={{ color: meta.color }} />
        <Typography sx={{ color: C.textSub, mt: 2, fontSize: "0.875rem" }}>Loading full record…</Typography>
      </Box>
    );
    if (error) return (
      <Box sx={{ py: 6, textAlign: "center" }}>
        <Typography sx={{ color: "#ef4444", mb: 2 }}>Failed to load: {error}</Typography>
        <Button variant="outlined" size="small" onClick={doFetch}
          sx={{ borderColor: C.border, color: C.textSub }}>Retry</Button>
      </Box>
    );
    if (!data) return null;
    switch (row.platform) {
      case "reddit":        return <RedditView        data={data} C={C} />;
      case "tiktok":        return <TikTokView        data={data} C={C} />;
      case "edugeek":       return <EduGeekView       data={data} C={C} />;
      case "autodesk":      return <AutodeskView      data={data} C={C} />;
      case "stackexchange": return <StackExchangeView data={data} C={C} />;
      case "google_news":   return <GoogleNewsView    data={data} C={C} />;
      case "instagram":     return <InstagramView     data={data} C={C} />;
      case "twitter":       return <TwitterView       data={data} C={C} />;
      case "spiceworks":    return <SpiceworksView    data={data} C={C} />;
      case "quora":         return <QuoraView         data={data} C={C} />;
      case "facebook":      return <FacebookView      data={data} C={C} />;
      default: return (
        <Box sx={{ bgcolor: C.cardInner, border: `1px solid ${C.border}`, borderRadius: 1, p: 2, overflow: "auto" }}>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", color: C.text, fontSize: "0.78rem" }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        </Box>
      );
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { bgcolor: C.card, border: `1px solid ${C.border}`, backgroundImage: "none", maxHeight: "92vh" } }}>

      {/* ── Header ── */}
      <DialogTitle sx={{ p: 0 }}>
        <Box sx={{ px: 3, pt: 2.5, pb: 2, borderBottom: `1px solid ${C.border}` }}>
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
            <Chip label={meta.label} size="small"
              sx={{ bgcolor: meta.color, color: "white", fontWeight: 700, fontSize: "0.72rem", mt: 0.4, flexShrink: 0 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{
                color: C.text, fontWeight: 700, fontSize: "1rem", lineHeight: 1.35,
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
              }}>
                {title}
              </Typography>
              <Box sx={{ display: "flex", gap: 1.5, mt: 0.5, flexWrap: "wrap", alignItems: "center" }}>
                {author && <Typography sx={{ color: C.textSub, fontSize: "0.77rem" }}>by {author}</Typography>}
                {dateStr && <Typography sx={{ color: C.textMuted, fontSize: "0.77rem" }}>{dateStr}</Typography>}
                {url && (
                  <Typography component="a" href={url} target="_blank" rel="noreferrer"
                    sx={{ color: "#3b82f6", fontSize: "0.77rem", textDecoration: "none", "&:hover": { textDecoration: "underline" } }}>
                    View source ↗
                  </Typography>
                )}
              </Box>
            </Box>
            <IconButton onClick={onClose} size="small"
              sx={{ color: C.textMuted, flexShrink: 0, "&:hover": { color: C.text } }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>
      </DialogTitle>

      {/* ── Body ── */}
      <DialogContent sx={{ p: 3 }}>
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}
