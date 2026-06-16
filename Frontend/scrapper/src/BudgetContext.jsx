import React, {
  createContext, useContext, useState, useEffect, useCallback, useRef,
} from "react";
import { apiFetch } from "./api";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export const EMAIL_ALERT_THRESHOLD = 77;   // ~80% — warning email, scrapers keep running
export const HARD_BLOCK_THRESHOLD  = 97;   // ~100% — all scrapers permanently stopped

const BudgetContext = createContext({
  budgetPct:      0,
  isEmailAlert:   false,
  isHardBlocked:  false,
  dismissed:      false,
  setDismissed:   () => {},
  refresh:        () => {},
  data:           null,
});

export function BudgetProvider({ children }) {
  const [data,      setData]      = useState(null);
  const [dismissed, setDismissed] = useState(false);

  const emailSentRef     = useRef({ warning: false, blocked: false });
  const prevHardBlockRef = useRef(false);

  // Bridge to NotificationContext via a window global set by App.jsx
  const notify = (opts) => {
    try { window.__TrendSenseNotify?.(opts); } catch {}
  };

  const fetchSummary = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/spending/summary`);
      if (!res.ok) return;
      const json = await res.json();
      setData(json);

      const pct = json.budget_used_pct ?? 0;

      // Reset when budget drops back below warning threshold
      if (pct < EMAIL_ALERT_THRESHOLD) {
        setDismissed(false);
        emailSentRef.current     = { warning: false, blocked: false };
        prevHardBlockRef.current = false;
      }

      // Warning email (~80%) — fire once
      if (pct >= EMAIL_ALERT_THRESHOLD && !emailSentRef.current.warning) {
        emailSentRef.current.warning = true;
        apiFetch(`${API_BASE}/api/spending/trigger-alert`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ budget_pct: pct, alert_type: "warning" }),
        }).catch(() => {});
        notify({
          title:   "Budget warning",
          message: `${pct.toFixed(1)}% of monthly budget used. Alert email sent.`,
          type:    "warning",
        });
      }

      // Hard-block email (~100%) — fire once
      const isNowBlocked = pct >= HARD_BLOCK_THRESHOLD;
      if (isNowBlocked && !prevHardBlockRef.current && !emailSentRef.current.blocked) {
        emailSentRef.current.blocked = true;
        prevHardBlockRef.current     = true;
        apiFetch(`${API_BASE}/api/spending/trigger-alert`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ budget_pct: pct, alert_type: "blocked" }),
        }).catch(() => {});
        notify({
          title:   "🚫 Budget limit reached",
          message: `${pct.toFixed(1)}% used — all scrapers have been blocked.`,
          type:    "error",
        });
      }
    } catch {
      // silent — backend may be starting up
    }
  }, []);

  useEffect(() => {
    fetchSummary();
    const id = setInterval(fetchSummary, 30_000);
    return () => clearInterval(id);
  }, [fetchSummary]);

  const budgetPct     = data?.budget_used_pct ?? 0;
  const isEmailAlert  = budgetPct >= EMAIL_ALERT_THRESHOLD;
  const isHardBlocked = budgetPct >= HARD_BLOCK_THRESHOLD;

  return (
    <BudgetContext.Provider value={{
      budgetPct,
      isEmailAlert,
      isHardBlocked,
      dismissed,
      setDismissed,
      refresh: fetchSummary,
      data,
    }}>
      {children}
    </BudgetContext.Provider>
  );
}

export function useBudget() {
  return useContext(BudgetContext);
}