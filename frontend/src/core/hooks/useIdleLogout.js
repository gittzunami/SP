import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts";

const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "scroll", "touchstart"];

// Logs the user out and redirects to /login after 60 minutes with no
// mouse/keyboard/scroll activity while a session is active.
export function useIdleLogout() {
  const { isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const timerRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    const handleIdleTimeout = () => {
      logout();
      navigate("/login", { replace: true });
    };

    const resetTimer = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(handleIdleTimeout, IDLE_TIMEOUT_MS);
    };

    resetTimer();
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, resetTimer));

    return () => {
      clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, [isAuthenticated, logout, navigate]);
}
