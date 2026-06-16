const TOKEN_KEY = "TrendSense_jwt";

// Set to true on first 401. Prevents flooding the backend while React
// processes the logout and unmounts all polling components.
// Reset via resetAuthFailed() only when the user explicitly logs in.
let _authFailed = false;

// Called by AuthContext.login() after a successful login so requests resume.
export function resetAuthFailed() {
  _authFailed = false;
}

export async function apiFetch(url, options = {}) {
  // Auth already failed — skip the network request entirely
  if (_authFailed) return new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } });

  const token = localStorage.getItem(TOKEN_KEY);
  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(url, { ...options, headers });

  // First 401 — set flag and signal logout once
  if (res.status === 401 && !_authFailed) {
    _authFailed = true;
    window.dispatchEvent(new CustomEvent("auth:unauthorized"));
  }

  return res;
}
