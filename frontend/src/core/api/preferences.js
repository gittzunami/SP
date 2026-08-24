/**
 * core/api/preferences.js
 * ────────────────────────
 * Thin wrappers around GET/PUT /api/preferences/:key.
 * Replaces all localStorage-based UI state persistence across the app.
 *
 * Usage:
 *   import { getPref, setPref, clearAllPrefs } from "../core/api/preferences";
 *   const theme = await getPref("theme_mode", "dark");
 *   await setPref("theme_mode", "light");
 */

import { apiFetch } from "../../api";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

/**
 * Fetch a single preference value from the DB.
 * Returns `defaultVal` if the key doesn't exist or on error.
 */
export async function getPref(key, defaultVal = null) {
  try {
    const res = await apiFetch(`${API_BASE}/api/preferences/${key}`);
    if (!res.ok) return defaultVal;
    const data = await res.json();
    return data.value ?? defaultVal;
  } catch {
    return defaultVal;
  }
}

/**
 * Upsert a preference value in the DB.
 * Fire-and-forget safe — errors are swallowed so UI is never blocked.
 */
export async function setPref(key, value) {
  try {
    await apiFetch(`${API_BASE}/api/preferences/${key}`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ value: String(value) }),
    });
  } catch {
    // non-blocking
  }
}

/**
 * Delete ALL preferences (used by Settings > Danger Zone > Clear Cache).
 */
export async function clearAllPrefs() {
  try {
    await apiFetch(`${API_BASE}/api/preferences`, { method: "DELETE" });
  } catch {
    // non-blocking
  }
}
