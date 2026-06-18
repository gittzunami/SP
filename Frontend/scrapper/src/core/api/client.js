/**
 * core/api/client.js
 * ==================
 * Centralised API layer — wraps fetch with JWT auth, handles 401 flooding,
 * and dispatches the auth:unauthorized event to trigger a clean logout.
 *
 * Usage:
 *   import { apiFetch } from "../../core/api/client";
 */

const TOKEN_KEY = "TrendSense_jwt";

// Set to true on first 401. Prevents flooding the backend while React
// processes the logout and unmounts all polling components.
// Reset via resetAuthFailed() only when the user explicitly logs in.
let _authFailed = false;

export function resetAuthFailed() {
  _authFailed = false;
}

export async function apiFetch(url, options = {}) {
  if (_authFailed)
    return new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } });

  const token = localStorage.getItem(TOKEN_KEY);
  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && !_authFailed) {
    _authFailed = true;
    window.dispatchEvent(new CustomEvent("auth:unauthorized"));
  }

  return res;
}
