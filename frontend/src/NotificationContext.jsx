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