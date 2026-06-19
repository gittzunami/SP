import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { resetAuthFailed } from "./api";

const TOKEN_KEY = "TrendSense_jwt";

const AuthContext = createContext({
  token:           null,
  username:        null,
  isAuthenticated: false,
  login:           () => {},
  logout:          () => {},
});

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
  });
  const [username, setUsername] = useState(() => {
    try { return localStorage.getItem(TOKEN_KEY + "_user") || null; } catch { return null; }
  });

  const login = useCallback((accessToken, user) => {
    resetAuthFailed(); // allow requests to proceed after a fresh login
    try {
      localStorage.setItem(TOKEN_KEY, accessToken);
      localStorage.setItem(TOKEN_KEY + "_user", user);
    } catch {}
    setToken(accessToken);
    setUsername(user);
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY + "_user");
    } catch {}
    setToken(null);
    setUsername(null);
  }, []);

  // Listen for 401 responses from apiFetch and log out cleanly so React
  // unmounts all protected components (and their setInterval pollers) before
  // navigating — prevents the flood of repeated 401 requests seen otherwise.
  useEffect(() => {
    const handler = () => logout();
    window.addEventListener("auth:unauthorized", handler);
    return () => window.removeEventListener("auth:unauthorized", handler);
  }, [logout]);

  return (
    <AuthContext.Provider value={{ token, username, isAuthenticated: !!token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function authHeader(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
