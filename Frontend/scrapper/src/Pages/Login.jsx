import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, TextField, Button, Typography, InputAdornment,
  IconButton, CircularProgress, Alert, Collapse,
} from "@mui/material";
import VisibilityIcon        from "@mui/icons-material/Visibility";
import VisibilityOffIcon     from "@mui/icons-material/VisibilityOff";
import CheckCircleIcon       from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import { useAuth }           from "../AuthContext";

const API = "http://localhost:8000";

// Password requirements
const RULES = [
  { label: "8+ chars",   test: (p) => p.length >= 8 },
  { label: "Uppercase",  test: (p) => /[A-Z]/.test(p) },
  { label: "Number",     test: (p) => /[0-9]/.test(p) },
  { label: "Special",    test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export default function Login() {
  const navigate    = useNavigate();
  const { login }   = useAuth();

  const [userId,   setUserId]   = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [pwFocused, setPwFocused] = useState(false);

  const ruleResults = useMemo(() => RULES.map((r) => r.test(password)), [password]);
  const allValid    = ruleResults.every(Boolean);
  const canSubmit   = userId.trim() && password && allValid && !loading;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ username: userId.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "Login failed. Please try again.");
        return;
      }
      login(data.access_token, data.username);
      navigate("/", { replace: true });
    } catch {
      setError("Cannot reach server. Make sure the backend is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display:   "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(ellipse at 60% 20%, #0f2040 0%, #060c18 55%, #020509 100%)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background grid lines */}
      <Box sx={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: `
          linear-gradient(rgba(59,130,246,0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(59,130,246,0.04) 1px, transparent 1px)
        `,
        backgroundSize: "48px 48px",
      }} />

      {/* Glowing orbs */}
      <Box sx={{
        position: "absolute", width: 500, height: 500,
        borderRadius: "50%", top: "-120px", right: "-100px",
        background: "radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      <Box sx={{
        position: "absolute", width: 400, height: 400,
        borderRadius: "50%", bottom: "-80px", left: "-80px",
        background: "radial-gradient(circle, rgba(99,102,241,0.1) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      {/* Login card */}
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{
          position: "relative",
          width: "100%",
          maxWidth: 440,
          mx: 2,
          background: "linear-gradient(145deg, rgba(17,24,39,0.95) 0%, rgba(13,18,31,0.98) 100%)",
          border: "1px solid rgba(59,130,246,0.18)",
          borderRadius: 3,
          boxShadow: "0 0 0 1px rgba(59,130,246,0.06), 0 24px 64px rgba(0,0,0,0.6)",
          backdropFilter: "blur(12px)",
          px: { xs: 3, sm: 4.5 },
          pt: 5,
          pb: 4,
        }}
      >
        {/* Top accent bar */}
        <Box sx={{
          position: "absolute", top: 0, left: "10%", right: "10%", height: 2,
          borderRadius: "0 0 4px 4px",
          background: "linear-gradient(90deg, transparent, #3b82f6, #6366f1, transparent)",
        }} />

        {/* Logo */}
        <Box sx={{ textAlign: "center", mb: 2 }}>
          <Box
            component="img"
            src="/TrendSenseLogo.png"
            alt="TrendSense"
            sx={{ height: 72, objectFit: "contain", filter: "drop-shadow(0 0 18px rgba(59,130,246,0.4))" }}
          />
        </Box>

        {/* App name */}
        <Typography
          variant="h4"
          sx={{
            textAlign: "center",
            fontWeight: 800,
            letterSpacing: "0.04em",
            background: "linear-gradient(135deg, #60a5fa 0%, #818cf8 50%, #a78bfa 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            mb: 0.5,
          }}
        >
          TrendSense
        </Typography>

        {/* Brand tagline */}
        <Box sx={{ textAlign: "center", mb: 3.5 }}>
          <Typography
            component="span"
            sx={{
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "#f0f6ff",
              letterSpacing: "0.02em",
            }}
          >
            Cloudsfer
          </Typography>
          <Typography
            component="span"
            sx={{
              fontSize: "0.78rem",
              color: "#94a3b8",
              mx: 0.6,
            }}
          >
            ·
          </Typography>
          <Typography
            component="span"
            sx={{
              fontSize: "0.76rem",
              color: "#94a3b8",
              letterSpacing: "0.02em",
            }}
          >
            powered by{" "}
          </Typography>
          <Typography
            component="span"
            sx={{
              fontSize: "0.78rem",
              fontWeight: 700,
              background: "linear-gradient(90deg, #f59e0b, #fbbf24)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              letterSpacing: "0.02em",
            }}
          >
            Tzunami
          </Typography>
        </Box>

        {/* Divider with label */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3.5 }}>
          <Box sx={{ flex: 1, height: "1px", bgcolor: "rgba(148,163,184,0.15)" }} />
          <Typography sx={{ fontSize: "0.68rem", color: "#475569", letterSpacing: "0.12em", whiteSpace: "nowrap" }}>
            SIGN IN TO CONTINUE
          </Typography>
          <Box sx={{ flex: 1, height: "1px", bgcolor: "rgba(148,163,184,0.15)" }} />
        </Box>

        {/* User ID field */}
        <TextField
          fullWidth
          label="User ID"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          autoFocus
          autoComplete="username"
          sx={{ mb: 2.5, ...fieldSx }}
        />

        {/* Password field */}
        <TextField
          fullWidth
          label="Password"
          type={showPw ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onFocus={() => setPwFocused(true)}
          onBlur={() => setPwFocused(false)}
          autoComplete="current-password"
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton onClick={() => setShowPw((p) => !p)} edge="end" size="small"
                  sx={{ color: "#64748b" }}>
                  {showPw ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          }}
          sx={{ mb: 1.5, ...fieldSx }}
        />

        {/* Password requirement pills */}
        <Collapse in={pwFocused || (password.length > 0 && !allValid)}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.8, mb: 2 }}>
            {RULES.map((rule, i) => {
              const ok = ruleResults[i];
              return (
                <Box key={rule.label} sx={{
                  display: "flex", alignItems: "center", gap: 0.4,
                  px: 1.2, py: 0.3, borderRadius: 99,
                  border: `1px solid ${ok ? "rgba(16,185,129,0.4)" : "rgba(100,116,139,0.3)"}`,
                  bgcolor: ok ? "rgba(16,185,129,0.08)" : "transparent",
                  transition: "all 0.2s ease",
                }}>
                  {ok
                    ? <CheckCircleIcon sx={{ fontSize: 12, color: "#10b981" }} />
                    : <RadioButtonUncheckedIcon sx={{ fontSize: 12, color: "#475569" }} />}
                  <Typography sx={{ fontSize: "0.68rem", color: ok ? "#10b981" : "#64748b" }}>
                    {rule.label}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Collapse>

        {/* Error */}
        <Collapse in={!!error}>
          <Alert
            severity="error"
            onClose={() => setError("")}
            sx={{
              mb: 2, bgcolor: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.25)",
              color: "#fca5a5",
              "& .MuiAlert-icon": { color: "#f87171" },
            }}
          >
            {error}
          </Alert>
        </Collapse>

        {/* Submit */}
        <Button
          type="submit"
          fullWidth
          disabled={!canSubmit}
          sx={{
            mt: 0.5,
            py: 1.5,
            fontSize: "0.9rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            borderRadius: 2,
            textTransform: "none",
            background: canSubmit
              ? "linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)"
              : "rgba(30,41,59,0.8)",
            color: canSubmit ? "#ffffff" : "#475569",
            border: canSubmit ? "none" : "1px solid rgba(71,85,105,0.4)",
            boxShadow: canSubmit ? "0 4px 20px rgba(37,99,235,0.35)" : "none",
            transition: "all 0.2s ease",
            "&:hover": {
              background: canSubmit
                ? "linear-gradient(135deg, #1d4ed8 0%, #4338ca 100%)"
                : "rgba(30,41,59,0.8)",
              boxShadow: canSubmit ? "0 6px 28px rgba(37,99,235,0.45)" : "none",
              transform: canSubmit ? "translateY(-1px)" : "none",
            },
            "&:active": { transform: "translateY(0)" },
          }}
        >
          {loading
            ? <CircularProgress size={20} sx={{ color: "#94a3b8" }} />
            : "Sign In"}
        </Button>

        {/* Footer note */}
        <Typography sx={{ mt: 3, textAlign: "center", fontSize: "0.72rem", letterSpacing: "0.06em" }}>
          <span style={{ color: "#64748b" }}>Powered by </span>
          <span style={{
            background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            fontWeight: 700,
            letterSpacing: "0.05em",
          }}>
            HexaVibes Solutions
          </span>
        </Typography>
      </Box>
    </Box>
  );
}

const fieldSx = {
  "& .MuiOutlinedInput-root": {
    backgroundColor: "rgba(7,12,22,0.6)",
    borderRadius: 1.5,
    "& fieldset": { borderColor: "rgba(59,130,246,0.2)" },
    "&:hover fieldset": { borderColor: "rgba(59,130,246,0.45)" },
    "&.Mui-focused fieldset": { borderColor: "#3b82f6" },
    "& input": { color: "#e2e8f0", fontSize: "0.9rem" },
  },
  "& .MuiInputLabel-root": { color: "#64748b", fontSize: "0.88rem" },
  "& .MuiInputLabel-root.Mui-focused": { color: "#60a5fa" },
};
