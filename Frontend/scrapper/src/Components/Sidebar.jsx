import React from "react";
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Drawer,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { NavLink } from "react-router-dom";
import MenuIcon          from "@mui/icons-material/Menu";
import CloseIcon         from "@mui/icons-material/Close";
import DashboardIcon     from "@mui/icons-material/Dashboard";
import StorageIcon       from "@mui/icons-material/Storage";
import SearchIcon        from "@mui/icons-material/Search";
import TrendingUpIcon    from "@mui/icons-material/TrendingUp";
import EmailIcon         from "@mui/icons-material/Email";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import AutoAwesomeIcon   from "@mui/icons-material/AutoAwesome";
import PsychologyIcon    from "@mui/icons-material/Psychology";
import { useAppTheme }   from "../AppThemeContext";

const menuItems = [
  { text: "Dashboard",      icon: <DashboardIcon />,      path: "/" },
  { text: "Monitoring",     icon: <StorageIcon />,        path: "/scraping" },
  { text: "Results Viewer", icon: <SearchIcon />,         path: "/results" },
  { text: "Smart Brain",    icon: <PsychologyIcon />,     path: "/smart-brain" },
  { text: "Trend Analysis", icon: <TrendingUpIcon />,     path: "/trends" },
  { text: "Newsletter",     icon: <EmailIcon />,          path: "/newsletter" },
  { text: "LLM Config",     icon: <AutoAwesomeIcon />,    path: "/llm-config" },
  { text: "Cost Governance",icon: <AccountBalanceIcon />, path: "/cost" },
];

const Sidebar = ({ collapsed = false, onToggle, mobileOpen = false, onMobileClose = () => {} }) => {
  const theme    = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const { C }    = useAppTheme();

  const navItemSx = {
    borderRadius: "8px",
    color: C.textSub,
    justifyContent: "center",
    "&.active": {
      bgcolor: C.activeNav,
      color: "#3b82f6",
      "& .MuiListItemIcon-root": { color: "#3b82f6" },
    },
    "&:hover": { bgcolor: C.hover },
  };

  const drawerContent = (isDrawer = false) => (
    <Box sx={{ bgcolor: C.surface, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header row */}
      <Box sx={{
        display:     "flex",
        alignItems:  "center",
        height:      56,
        px:          isDrawer ? 2 : 1,
        borderBottom: `1px solid ${C.border}`,
        justifyContent: isDrawer ? "space-between" : (collapsed ? "center" : "flex-end"),
        flexShrink:  0,
      }}>
        {isDrawer ? (
          <>
            {/* Logo + name in drawer header */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Box
                component="img"
                src="/TrendSenseLogo.png"
                alt="TrendSense"
                sx={{ height: 26, objectFit: "contain", userSelect: "none" }}
              />
              <Typography sx={{ fontWeight: 800, fontSize: "1rem", color: C.text, userSelect: "none" }}>
                Trend<span style={{ color: "#3b82f6" }}>Sense</span>
              </Typography>
            </Box>
            <IconButton onClick={onMobileClose} size="small" sx={{ color: C.textSub }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </>
        ) : (
          <IconButton
            onClick={onToggle}
            size="small"
            sx={{
              color: C.textSub,
              borderRadius: "8px",
              "&:hover": { bgcolor: C.hover, color: C.text },
            }}
          >
            {collapsed ? <MenuIcon /> : <CloseIcon />}
          </IconButton>
        )}
      </Box>

      {/* Nav Links */}
      <List sx={{ flexGrow: 1, px: 1, pt: 1 }}>
        {menuItems.map((item) => (
          <ListItem key={item.text} disablePadding sx={{ mb: 0.5 }}>
            <Tooltip
              title={collapsed && !isDrawer ? item.text : ""}
              placement="right"
              arrow
            >
              <ListItemButton
                component={NavLink}
                to={item.path}
                onClick={isDrawer ? onMobileClose : null}
                sx={{
                  ...navItemSx,
                  justifyContent: (collapsed && !isDrawer) ? "center" : "flex-start",
                  px: (collapsed && !isDrawer) ? 1 : 2,
                }}
              >
                <ListItemIcon sx={{
                  color: "inherit",
                  minWidth: (collapsed && !isDrawer) ? 0 : 40,
                  justifyContent: "center",
                }}>
                  {item.icon}
                </ListItemIcon>
                {(!collapsed || isDrawer) && (
                  <ListItemText
                    primary={item.text}
                    primaryTypographyProps={{ fontSize: "14px", fontWeight: 500 }}
                  />
                )}
              </ListItemButton>
            </Tooltip>
          </ListItem>
        ))}
      </List>
    </Box>
  );

  return (
    <>
      {/* MOBILE: Temporary Drawer — triggered by TopBar hamburger */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: "block", md: "none" },
          "& .MuiDrawer-paper": {
            boxSizing:   "border-box",
            width:       280,
            bgcolor:     C.surface,
            borderRight: `1px solid ${C.border}`,
          },
        }}
      >
        {drawerContent(true)}
      </Drawer>

      {/* DESKTOP: Permanent collapsible sidebar */}
      <Box sx={{
        display:    { xs: "none", md: "block" },
        width:      collapsed ? 64 : 260,
        transition: "width 0.25s ease",
        position:   "fixed",
        top: 0, left: 0,
        height:     "100vh",
        borderRight: `1px solid ${C.border}`,
        zIndex:     1100,
        overflow:   "hidden",
      }}>
        {drawerContent(false)}
      </Box>
    </>
  );
};

export default Sidebar;
