/**
 * core/contexts/index.js
 * ======================
 * Barrel export for all application contexts.
 * Import contexts from here for clean, location-independent imports:
 *
 *   import { useAuth, AuthProvider } from "../../core/contexts";
 *   import { useAppTheme, AppThemeProvider } from "../../core/contexts";
 */

export { AuthProvider, useAuth }             from "../../AuthContext";
export { AppThemeProvider, useAppTheme }     from "../../AppThemeContext";
export { BudgetProvider, useBudget }         from "../../BudgetContext";
export { NotificationProvider, useNotifications } from "../../NotificationContext";
