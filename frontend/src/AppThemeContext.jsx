import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
import { ThemeProvider, createTheme, CssBaseline } from "@mui/material";

const LS_KEY = "TrendSense_theme_mode";

// ── Color token palettes ──────────────────────────────────────────────────────

export const DARK = {
  bg:        "#0a0e17",
  surface:   "#0d121f",
  card:      "#111827",
  cardInner: "#0d121f",
  border:    "#1e293b",
  text:      "#ffffff",
  textSub:   "#94a3b8",
  textMuted: "#64748b",
  hover:     "#1e293b",
  activeNav: "#1e293b",
  inputBg:   "#0d121f",
  shadow:    "none",
};

export const LIGHT = {
  bg:        "#f1f5f9",
  surface:   "#ffffff",
  card:      "#ffffff",
  cardInner: "#f8fafc",
  border:    "#e2e8f0",
  text:      "#0f172a",
  textSub:   "#475569",
  textMuted: "#64748b",
  hover:     "#f1f5f9",
  activeNav: "#eff6ff",
  inputBg:   "#f8fafc",
  shadow:    "0 1px 3px rgba(0,0,0,0.08)",
};

// ── Context ───────────────────────────────────────────────────────────────────

const AppThemeContext = createContext({
  mode:    "dark",
  setMode: () => {},
  C:       DARK,
  isDark:  true,
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function AppThemeProvider({ children }) {
  const [mode, setModeRaw] = useState(() => {
    try { return localStorage.getItem(LS_KEY) || "dark"; } catch { return "dark"; }
  });

  // Track OS dark-preference for "auto" mode
  const [sysDark, setSysDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const handler = (e) => setSysDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const setMode = (m) => {
    try { localStorage.setItem(LS_KEY, m); } catch {}
    setModeRaw(m);
  };

  const resolved = mode === "auto" ? (sysDark ? "dark" : "light") : mode;
  const isDark   = resolved === "dark";
  const C        = isDark ? DARK : LIGHT;

  const muiTheme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: resolved,
          background: { default: C.bg, paper: C.surface },
          primary:    { main: "#3b82f6" },
          text: { primary: C.text, secondary: C.textSub },
        },
        components: {
          MuiCssBaseline: {
            styleOverrides: { body: { backgroundColor: C.bg, color: C.text } },
          },
          MuiPaper: {
            styleOverrides: { root: { backgroundColor: C.surface, backgroundImage: "none" } },
          },
          MuiMenuItem: {
            styleOverrides: {
              root: {
                color: C.text,
                "&:hover":            { backgroundColor: C.hover },
                "&.Mui-selected":     { backgroundColor: C.activeNav, color: "#3b82f6" },
                "&.Mui-selected:hover": { backgroundColor: C.activeNav },
              },
            },
          },
          MuiTableCell: {
            styleOverrides: {
              root: { borderBottom: `1px solid ${C.border}`, color: C.text },
              head: { backgroundColor: C.card,   color: C.textSub, fontWeight: 600 },
            },
          },
          MuiTableRow: {
            styleOverrides: {
              root: { "&:hover": { backgroundColor: `${C.hover} !important` } },
            },
          },
          MuiDivider: {
            styleOverrides: { root: { borderColor: C.border } },
          },
          MuiDrawer: {
            styleOverrides: { paper: { backgroundColor: C.surface, backgroundImage: "none" } },
          },
          MuiDialog: {
            styleOverrides: { paper: { backgroundColor: C.card, backgroundImage: "none" } },
          },
          MuiMenu: {
            styleOverrides: { paper: { backgroundColor: C.card, backgroundImage: "none" } },
          },
          MuiSelect: {
            styleOverrides: {
              icon: { color: C.textSub },
            },
          },
          MuiInputBase: {
            styleOverrides: { input: { color: C.text } },
          },
          MuiOutlinedInput: {
            styleOverrides: {
              root: {
                backgroundColor: C.inputBg,
                color: C.text,
                "& .MuiOutlinedInput-notchedOutline": { borderColor: C.border },
                "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "#3b82f6" },
              },
            },
          },
          MuiInputLabel: {
            styleOverrides: { root: { color: C.textSub } },
          },
          MuiChip: {
            styleOverrides: { label: { color: "inherit" } },
          },
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolved]
  );

  return (
    <AppThemeContext.Provider value={{ mode, setMode, C, isDark }}>
      <ThemeProvider theme={muiTheme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppThemeContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAppTheme() {
  return useContext(AppThemeContext);
}
