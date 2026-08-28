import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "TrendSense_notifications_v1";

const NotificationContext = createContext({
  notifications: [],
  unreadCount:   0,
  addNotification:    () => {},
  markAllRead:        () => {},
  deleteNotification: () => {},
  clearAll:           () => {},
});

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Persist every change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
    } catch {}
  }, [notifications]);

  // ── Sync background notifications from backend ──────────────────────────────
  useEffect(() => {
    const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
    const syncNotifications = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;
      try {
        const res = await fetch(`${API_BASE}/api/notifications/recent`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.notifications) && data.notifications.length > 0) {
          setNotifications((prev) => {
            const existingIds = new Set(prev.map((n) => n.id));
            const newItems = data.notifications
              .filter((n) => !existingIds.has(n.id))
              .map((n) => ({ ...n, read: false }));
            if (newItems.length === 0) return prev;
            return [...newItems, ...prev].slice(0, 100);
          });
        }
      } catch (_) {}
    };

    syncNotifications();
    const intervalId = setInterval(syncNotifications, 10_000);
    return () => clearInterval(intervalId);
  }, []);

  const addNotification = useCallback(({ title, message, type = "info" }) => {
    setNotifications((prev) => [
      {
        id:        Date.now() + Math.random(),
        title,
        message,
        type,       // "success" | "warning" | "error" | "info"
        timestamp:  new Date().toISOString(),
        read:       false,
      },
      ...prev,
    ].slice(0, 100)); // keep max 100
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const deleteNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clearAll = useCallback(() => setNotifications([]), []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      addNotification,
      markAllRead,
      deleteNotification,
      clearAll,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}