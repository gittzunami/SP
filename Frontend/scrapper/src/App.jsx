import React, { useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { Box } from "@mui/material";

// ── Shared layout components ──────────────────────────────────────────────────
import { Sidebar, TopBar } from "./shared/components";

// ── Feature pages (imported via feature index — colocated with their domain) ─
import Dashboard        from "./features/dashboard";
import Scraping         from "./features/scraping";
import Results          from "./features/results";
import Trends           from "./features/trends";
import Newsletter       from "./features/newsletter";
import CostGovernance   from "./features/cost-governance";
import LLMConfiguration from "./features/llm";
import SmartBrain       from "./features/smart-brain";

// ── Auth page (not a "feature" — no domain data) ─────────────────────────────
import Login from "./Pages/Login";

// ── App-wide contexts (from core layer) ──────────────────────────────────────
import { BudgetProvider }             from "./core/contexts";
import { AppThemeProvider, useAppTheme } from "./core/contexts";
import { NotificationProvider }       from "./core/contexts";
import { AuthProvider, useAuth }      from "./core/contexts";

import GlobalBudgetBanner from "./GlobalBudgetBanner";


function PrivateRoute({ children }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function AppInner() {
  const { C } = useAppTheme();
  const [collapsed,  setCollapsed]  = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarW = collapsed ? 64 : 260;

  return (
    <Router>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<Login />} />

        {/* Protected shell */}
        <Route
          path="/*"
          element={
            <PrivateRoute>
              <BudgetProvider>
                <GlobalBudgetBanner />
                <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: C.bg }}>
                  <Sidebar
                    collapsed={collapsed}
                    onToggle={() => setCollapsed((p) => !p)}
                    mobileOpen={mobileOpen}
                    onMobileClose={() => setMobileOpen(false)}
                  />
                  <Box
                    sx={{
                      flexGrow: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      marginLeft: { xs: 0, md: `${sidebarW}px` },
                      transition: "margin-left 0.25s ease",
                      overflowX: "hidden",
                    }}
                  >
                    <TopBar
                      collapsed={collapsed}
                      onMenuClick={() => setMobileOpen((p) => !p)}
                    />
                    <Box
                      sx={{
                        p:         { xs: 2, sm: 3, md: 4 },
                        mt:        "56px",
                        bgcolor:   C.bg,
                        height:    "calc(100vh - 56px)",
                        overflowY: "auto",
                        overflowX: "hidden",
                        minWidth:  0,
                        display:   "flex",
                        flexDirection: "column",
                      }}
                    >
                      <Box sx={{ flex: 1 }}>
                        <Routes>
                          <Route path="/"             element={<Dashboard />} />
                          <Route path="/scraping"     element={<Scraping />} />
                          <Route path="/results"      element={<Results />} />
                          <Route path="/trends"       element={<Trends />} />
                          <Route path="/newsletter"   element={<Newsletter />} />
                          <Route path="/cost"         element={<CostGovernance />} />
                          <Route path="/llm-config"   element={<LLMConfiguration />} />
                          <Route path="/smart-brain"  element={<SmartBrain />} />
                        </Routes>
                      </Box>

                      {/* ── Footer ── */}
                      <Box
                        component="footer"
                        sx={{
                          mt: 6,
                          py: 2,
                          borderTop: `1px solid ${C.border}`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 0.75,
                        }}
                      >
                        <Box sx={{
                          width: 6, height: 6, borderRadius: "50%",
                          background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                        }} />
                        <span style={{ fontSize: "0.7rem", color: C.textMuted, letterSpacing: "0.05em" }}>
                          Powered by
                        </span>
                        <span style={{
                          fontSize: "0.72rem",
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                          background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
                          WebkitBackgroundClip: "text",
                          WebkitTextFillColor: "transparent",
                        }}>
                          HexaVibes Solutions
                        </span>
                        <Box sx={{
                          width: 6, height: 6, borderRadius: "50%",
                          background: "linear-gradient(135deg, #8b5cf6, #3b82f6)",
                        }} />
                      </Box>
                    </Box>
                  </Box>
                </Box>
              </BudgetProvider>
            </PrivateRoute>
          }
        />
      </Routes>
    </Router>
  );
}

function App() {
  return (
    <AppThemeProvider>
      <NotificationProvider>
        <AuthProvider>
          <AppInner />
        </AuthProvider>
      </NotificationProvider>
    </AppThemeProvider>
  );
}

export default App;
