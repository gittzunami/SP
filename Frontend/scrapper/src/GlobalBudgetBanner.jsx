import React from "react";
import {
  Box, Typography, Button, IconButton, LinearProgress,
} from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import BlockIcon        from "@mui/icons-material/Block";
import EmailIcon        from "@mui/icons-material/Email";
import CloseIcon        from "@mui/icons-material/Close";
import { useBudget, EMAIL_ALERT_THRESHOLD, HARD_BLOCK_THRESHOLD } from "./BudgetContext";

export default function GlobalBudgetBanner() {
  const { budgetPct, isEmailAlert, isHardBlocked, dismissed, setDismissed } = useBudget();

  // Nothing to show below email threshold
  if (!isEmailAlert) return null;
  // User dismissed the warning banner (and we're not hard-blocked) — hide
  if (dismissed && !isHardBlocked) return null;

  const bgColor = isHardBlocked ? "#7f1d1d" : "#78350f";
  const border  = isHardBlocked ? "#dc2626" : "#d97706";

  return (
    <Box
      role="alert"
      aria-live="assertive"
      sx={{
        position:     "fixed",
        top:          0,
        left:         0,
        right:        0,
        zIndex:       2000,
        bgcolor:      bgColor,
        borderBottom: `2px solid ${border}`,
        px:           { xs: 2, md: 4 },
        py:           1.2,
        display:      "flex",
        alignItems:   "center",
        gap:          2,
        minHeight:    56,
      }}
    >
      {/* Icon */}
      <Box sx={{ flexShrink: 0 }}>
        {isHardBlocked
          ? <BlockIcon        sx={{ color: "#fca5a5", fontSize: 26 }} />
          : <WarningAmberIcon sx={{ color: "#fcd34d", fontSize: 26 }} />
        }
      </Box>

      {/* Message */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{
          fontWeight: 700,
          color:      "white",
          fontSize:   { xs: "0.82rem", md: "0.92rem" },
          lineHeight: 1.3,
        }}>
          {isHardBlocked
            ? `🚫 Budget limit reached — ${budgetPct.toFixed(1)}% used. All scrapers are permanently BLOCKED.`
            : `⚠️ Budget warning — ${budgetPct.toFixed(1)}% of monthly budget used. An alert email has been sent.`
          }
        </Typography>
        <Typography variant="caption" sx={{
          color:      isHardBlocked ? "#fca5a5" : "#fde68a",
          display:    "block",
          lineHeight: 1.3,
        }}>
          {isHardBlocked
            ? "Scrapers are disabled until you increase your budget in Cost Governance → Modifications."
            : "Scrapers continue to run. Visit Cost Governance to review spending or adjust your budget."
          }
        </Typography>
        <LinearProgress
          variant="determinate"
          value={Math.min(budgetPct, 100)}
          sx={{
            mt: 0.8, height: 4, borderRadius: 2, maxWidth: 300,
            bgcolor: "rgba(255,255,255,0.15)",
            "& .MuiLinearProgress-bar": {
              bgcolor: isHardBlocked ? "#ef4444" : "#f59e0b",
            },
          }}
        />
      </Box>

      {/* Dismiss — only at warning level, not when hard-blocked */}
      {!isHardBlocked && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<EmailIcon />}
            onClick={() => setDismissed(true)}
            sx={{
              borderColor: "#d97706",
              color:       "#fde68a",
              fontSize:    "0.75rem",
              whiteSpace:  "nowrap",
              "&:hover": { bgcolor: "rgba(217,119,6,0.15)", borderColor: "#f59e0b" },
            }}
          >
            Got it
          </Button>
          <IconButton
            size="small"
            onClick={() => setDismissed(true)}
            sx={{ color: "rgba(255,255,255,0.6)", "&:hover": { color: "white" } }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
    </Box>
  );
}