import React, { useState } from "react";
import {
  Box, Typography, IconButton, Badge, Drawer, List,
  ListItem, ListItemText, Chip, Button, Divider, Tooltip,
} from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import DeleteIcon        from "@mui/icons-material/Delete";
import MenuIcon          from "@mui/icons-material/Menu";
import LightModeIcon     from "@mui/icons-material/LightMode";
import DarkModeIcon      from "@mui/icons-material/DarkMode";
import LogoutIcon        from "@mui/icons-material/Logout";
import { useNotifications } from "../NotificationContext";
import { useAppTheme }      from "../AppThemeContext";
import { useAuth }          from "../AuthContext";
import { useNavigate }      from "react-router-dom";

const TYPE_COLOR = {
  success: "#10b981",
  error:   "#ef4444",
  warning: "#f59e0b",
  info:    "#3b82f6",
};

const TYPE_BG = {
  success: "#10b98118",
  error:   "#ef444418",
  warning: "#f59e0b18",
  info:    "#3b82f618",
};

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function TopBar({ onMenuClick, collapsed = false }) {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, markAllRead, deleteNotification, clearAll } =
    useNotifications();
  const { C, isDark, setMode } = useAppTheme();
  const { username, logout }   = useAuth();
  const navigate               = useNavigate();
  const toggleTheme = () => setMode(isDark ? "light" : "dark");

  const handleLogout = () => { logout(); navigate("/login", { replace: true }); };

  const handleOpen = () => { setOpen(true); markAllRead(); };

  return (
    <>
      {/* App Bar */}
      <Box
        sx={{
          position:     "fixed",
          top:          0,
          left:         { xs: 0, md: collapsed ? "64px" : "260px" },
          transition:   "left 0.25s ease",
          right:        0,
          zIndex:       1100,
          height:       56,
          bgcolor:      C.surface,
          borderBottom: `1px solid ${C.border}`,
          boxShadow:    C.shadow,
          display:      "flex",
          alignItems:   "center",
          px:           { xs: 2, md: 3 },
          gap:          1,
        }}
      >
        {onMenuClick && (
          <IconButton
            onClick={onMenuClick}
            size="small"
            sx={{ color: C.textMuted, display: { md: "none" } }}
          >
            <MenuIcon />
          </IconButton>
        )}

        <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box
            component="img"
            src="/TrendSenseLogo.png"
            alt="TrendSense"
            sx={{
              height:     { xs: 30, md: 40 },
              maxWidth:   160,
              objectFit:  "contain",
              filter:     isDark ? "none" : "invert(1)",
              transition: "filter 0.2s",
              userSelect: "none",
              flexShrink: 0,
            }}
          />
          <Typography sx={{
            fontWeight:    800,
            fontSize:      { xs: "1.15rem", md: "1.4rem" },
            letterSpacing: "0.3px",
            lineHeight:    1,
            userSelect:    "none",
            color:         C.text,
          }}>
            Trend<span style={{ color: "#3b82f6" }}>Sense</span>
          </Typography>
        </Box>

        <Tooltip title={isDark ? "Switch to light mode" : "Switch to dark mode"}>
          <IconButton
            onClick={toggleTheme}
            size="small"
            sx={{
              color: C.textMuted,
              border: `1px solid ${C.border}`,
              "&:hover": { color: isDark ? "#f59e0b" : "#3b82f6", borderColor: isDark ? "#f59e0b" : "#3b82f6" },
            }}
          >
            {isDark ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
          </IconButton>
        </Tooltip>

        {username && (
          <Typography sx={{ fontSize: "0.75rem", color: C.textMuted, display: { xs: "none", sm: "block" } }}>
            {username}
          </Typography>
        )}

        <Tooltip title="Sign out">
          <IconButton
            onClick={handleLogout}
            size="small"
            sx={{
              color: C.textMuted,
              border: `1px solid ${C.border}`,
              "&:hover": { color: "#ef4444", borderColor: "#ef4444" },
            }}
          >
            <LogoutIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Notifications">
          <IconButton
            onClick={handleOpen}
            size="small"
            sx={{
              color:  unreadCount > 0 ? "#3b82f6" : C.textMuted,
              border: `1px solid ${C.border}`,
              "&:hover": { color: "#3b82f6", borderColor: "#3b82f6" },
            }}
          >
            <Badge
              badgeContent={unreadCount}
              max={99}
              sx={{
                "& .MuiBadge-badge": {
                  bgcolor:  "#ef4444",
                  color:    "white",
                  fontSize: "0.6rem",
                  minWidth: 16,
                  height:   16,
                },
              }}
            >
              <NotificationsIcon fontSize="small" />
            </Badge>
          </IconButton>
        </Tooltip>
      </Box>

      {/* Notification Drawer */}
      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        PaperProps={{
          sx: {
            width:      360,
            bgcolor:    C.surface,
            border:     "none",
            borderLeft: `1px solid ${C.border}`,
          },
        }}
      >
        {/* Header */}
        <Box sx={{
          px: 2.5, py: 2,
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          borderBottom:   `1px solid ${C.border}`,
        }}>
          <Typography sx={{ fontWeight: 700, color: C.text, fontSize: "1rem" }}>
            Notifications
            {notifications.length > 0 && (
              <Chip
                label={notifications.length}
                size="small"
                sx={{
                  ml: 1, bgcolor: C.hover, color: C.textSub,
                  height: 18, fontSize: "0.65rem",
                }}
              />
            )}
          </Typography>
          {notifications.length > 0 && (
            <Button
              size="small"
              startIcon={<DeleteIcon sx={{ fontSize: "14px !important" }} />}
              onClick={clearAll}
              sx={{
                color: C.textMuted, textTransform: "none", fontSize: "0.75rem",
                "&:hover": { color: "#ef4444" },
              }}
            >
              Clear all
            </Button>
          )}
        </Box>

        {/* List */}
        {notifications.length === 0 ? (
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Box sx={{ textAlign: "center", px: 3 }}>
              <NotificationsIcon sx={{ color: C.border, fontSize: 40, mb: 1 }} />
              <Typography variant="body2" sx={{ color: C.textSub }}>
                No notifications yet
              </Typography>
              <Typography variant="caption" sx={{ color: C.textMuted }}>
                Collection runs, budget alerts and modifications will appear here.
              </Typography>
            </Box>
          </Box>
        ) : (
          <Box sx={{ flex: 1, overflowY: "auto" }}>
            {notifications.map((n, idx) => (
              <Box key={n.id}>
                <Box sx={{
                  px: 2.5, py: 1.5,
                  display:    "flex",
                  gap:        1.5,
                  bgcolor:    n.read ? "transparent" : TYPE_BG[n.type] || TYPE_BG.info,
                  "&:hover":  { bgcolor: C.hover },
                  transition: "background 0.15s",
                }}>
                  <Box sx={{
                    width:        8,
                    height:       8,
                    borderRadius: "50%",
                    bgcolor:      TYPE_COLOR[n.type] || TYPE_COLOR.info,
                    flexShrink:   0,
                    mt:           0.7,
                  }} />

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      sx={{ color: C.text, fontWeight: n.read ? 400 : 600, lineHeight: 1.3 }}
                    >
                      {n.title}
                    </Typography>
                    {n.message && (
                      <Typography
                        variant="caption"
                        sx={{ color: C.textSub, display: "block", lineHeight: 1.4, mt: 0.2 }}
                      >
                        {n.message}
                      </Typography>
                    )}
                    <Typography variant="caption" sx={{ color: C.textMuted, fontSize: "0.65rem" }}>
                      {timeAgo(n.timestamp)}
                    </Typography>
                  </Box>

                  <IconButton
                    size="small"
                    onClick={() => deleteNotification(n.id)}
                    sx={{
                      color: C.border, flexShrink: 0, p: 0.3,
                      "&:hover": { color: "#ef4444", bgcolor: "transparent" },
                    }}
                  >
                    <DeleteIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
                {idx < notifications.length - 1 && (
                  <Divider sx={{ bgcolor: C.border, mx: 2.5 }} />
                )}
              </Box>
            ))}
          </Box>
        )}
      </Drawer>
    </>
  );
}
