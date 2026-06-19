import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api";
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Switch,
  FormControlLabel,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
  List,
  ListItem,
  ListItemText,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Snackbar,
  Alert,
  CircularProgress,
  Checkbox,
} from "@mui/material";
import Save   from "@mui/icons-material/Save";
import Delete from "@mui/icons-material/Delete";
import Add    from "@mui/icons-material/Add";
import { useAppTheme }      from "../AppThemeContext";
import { useNotifications } from "../NotificationContext";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const LS_KEY   = "TrendSense_general_settings";

const PROVIDER_LABELS = {
  openai:    "OpenAI API",
  anthropic: "Anthropic API",
  gemini:    "Google Gemini API",
};

const PROVIDER_MODELS = {
  openai:    ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5-20251001"],
  gemini:    ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0"],
};

const DEFAULT_SETTINGS = {
  organizationName: "Intelligence Operations",
  apiNotifications: true,
  weeklyReports:    true,
  costAlerts:       true,
  alertThreshold:   1000,
};

const DANGER_COPY = {
  cache:  { title: "Clear Cache",        body: "This will clear all locally cached application data. This action cannot be undone." },
  reset:  { title: "Reset All Settings", body: "This will reset all settings to their default values. This action cannot be undone." },
  delete: { title: "Delete Account",     body: "This will permanently delete all your account data and settings. This action cannot be undone." },
};

const Settings = () => {
  const { mode, setMode, C } = useAppTheme();
  const { addNotification }  = useNotifications();

  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [apiKeys,     setApiKeys]     = useState([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [snack, setSnack] = useState({ open: false, msg: "", severity: "success" });

  const [addOpen,   setAddOpen]   = useState(false);
  const [newKey,    setNewKey]    = useState({ provider: "openai", model: "", apiKey: "", setActive: false });
  const [addSaving, setAddSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting,     setDeleting]     = useState(false);

  const [dangerTarget,  setDangerTarget]  = useState(null);
  const [dangerLoading, setDangerLoading] = useState(false);

  const showSnack = (msg, severity = "success") =>
    setSnack({ open: true, msg, severity });

  // ── Load LLM API keys ─────────────────────────────────────────────────────
  const fetchApiKeys = useCallback(async () => {
    setLoadingKeys(true);
    try {
      const res  = await apiFetch(`${API_BASE}/api/llm/configs`);
      const data = await res.json();
      setApiKeys(Array.isArray(data) ? data : []);
    } catch {
      showSnack("Failed to load API keys", "error");
    } finally {
      setLoadingKeys(false);
    }
  }, []);

  useEffect(() => { fetchApiKeys(); }, [fetchApiKeys]);

  // ── Load budget from backend ──────────────────────────────────────────────
  useEffect(() => {
    apiFetch(`${API_BASE}/api/spending/budget`)
      .then((r) => r.json())
      .then((data) => {
        if (data.monthly_limit_usd != null)
          setSettings((p) => ({ ...p, alertThreshold: data.monthly_limit_usd }));
      })
      .catch(() => {});
  }, []);

  // ── General settings ──────────────────────────────────────────────────────
  const handleChange = (field, value) =>
    setSettings((p) => ({ ...p, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(settings));
      const res = await apiFetch(`${API_BASE}/api/spending/budget`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          monthly_limit_usd:   Number(settings.alertThreshold) || 1000,
          alert_threshold_pct: 80,
        }),
      });
      if (!res.ok) throw new Error("Budget save failed");
      showSnack("Settings saved successfully");
      addNotification({
        title:   "Settings saved",
        message: `Monthly budget limit set to $${Number(settings.alertThreshold).toLocaleString()}`,
        type:    "info",
      });
    } catch {
      showSnack("Failed to save settings", "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Add API key ───────────────────────────────────────────────────────────
  const handleAddKey = async () => {
    if (!newKey.apiKey.trim() || !newKey.model.trim()) {
      showSnack("API key and model are required", "error");
      return;
    }
    setAddSaving(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/llm/config`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          provider:   newKey.provider,
          api_key:    newKey.apiKey,
          model:      newKey.model,
          set_active: newKey.setActive,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setAddOpen(false);
      setNewKey({ provider: "openai", model: "", apiKey: "", setActive: false });
      showSnack("API key saved");
      fetchApiKeys();
    } catch {
      showSnack("Failed to save API key", "error");
    } finally {
      setAddSaving(false);
    }
  };

  // ── Delete API key ────────────────────────────────────────────────────────
  const handleDeleteKey = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/llm/config/${deleteTarget}/key`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      showSnack("API key removed");
      setDeleteTarget(null);
      fetchApiKeys();
    } catch {
      showSnack("Failed to remove API key", "error");
    } finally {
      setDeleting(false);
    }
  };

  // ── Danger zone ───────────────────────────────────────────────────────────
  const handleDanger = async () => {
    setDangerLoading(true);
    try {
      if (dangerTarget === "cache") {
        ["TrendSense_notifications_v1", LS_KEY].forEach((k) => localStorage.removeItem(k));
        showSnack("Cache cleared");
      } else if (dangerTarget === "reset") {
        localStorage.removeItem(LS_KEY);
        setSettings(DEFAULT_SETTINGS);
        showSnack("Settings reset to defaults");
      } else if (dangerTarget === "delete") {
        localStorage.clear();
        setSettings(DEFAULT_SETTINGS);
        showSnack("Account data deleted");
      }
    } finally {
      setDangerLoading(false);
      setDangerTarget(null);
    }
  };

  // ── Key display helpers ───────────────────────────────────────────────────
  const keyStatus = (key) => {
    if (key.is_active) return "Active";
    if (key.has_key)   return "Configured";
    return "Inactive";
  };
  const keyChipSx = (key) => {
    if (key.is_active) return { bgcolor: "#10b98150", color: "#10b981" };
    if (key.has_key)   return { bgcolor: "#3b82f650", color: "#3b82f6" };
    return { bgcolor: C.hover, color: C.textSub };
  };

  // ── Shared sx helpers ─────────────────────────────────────────────────────
  const inputSx = {
    "& .MuiOutlinedInput-root": {
      color: C.text,
      bgcolor: C.inputBg,
      "& fieldset": { borderColor: C.border },
      "&:hover fieldset": { borderColor: "#3b82f6" },
    },
    "& .MuiInputBase-input": { color: C.text },
  };
  const selectSx = {
    color: C.text,
    bgcolor: C.inputBg,
    "& .MuiOutlinedInput-notchedOutline": { borderColor: C.border },
    "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "#3b82f6" },
  };
  const labelStyle = { style: { color: C.textSub } };
  const cardSx = { bgcolor: C.card, border: `1px solid ${C.border}`, mb: 3, boxShadow: C.shadow };

  return (
    <Box sx={{ color: C.text, pb: 4 }}>
      {/* Header */}
      <Typography
        sx={{
          fontWeight: "bold",
          mb: 0.5,
          color: C.text,
          fontSize: { xs: "1.2rem", sm: "1.4rem", md: "1.75rem" },
        }}
      >
        Settings
      </Typography>
      <Typography variant="body2" sx={{ color: C.textSub, mb: { xs: 3, md: 4 } }}>
        Configure your application settings and preferences.
      </Typography>

      {/* ── General Settings ──────────────────────────────────────────────── */}
      <Card sx={cardSx}>
        <CardContent sx={{ p: { xs: 2, md: 3 } }}>
          <Typography sx={{ color: C.text, mb: 2, fontWeight: 600, fontSize: { xs: "1rem", md: "1.1rem" } }}>
            General Settings
          </Typography>

          <TextField
            fullWidth
            label="Organization Name"
            value={settings.organizationName}
            onChange={(e) => handleChange("organizationName", e.target.value)}
            sx={{ mb: 3, ...inputSx }}
            InputLabelProps={labelStyle}
          />

          {/* Theme selector — changes immediately */}
          <FormControl fullWidth sx={{ mb: 3 }}>
            <InputLabel sx={{ color: C.textSub }}>Theme</InputLabel>
            <Select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              label="Theme"
              sx={selectSx}
            >
              <MenuItem value="dark">Dark Mode</MenuItem>
              <MenuItem value="light">Light Mode</MenuItem>
              <MenuItem value="auto">Auto (System)</MenuItem>
            </Select>
          </FormControl>

          <Divider sx={{ bgcolor: C.border, my: 2 }} />

          <Typography variant="subtitle2" sx={{ color: C.textSub, mb: 2 }}>
            Notifications &amp; Alerts
          </Typography>

          {[
            { field: "apiNotifications", label: "API Error Notifications" },
            { field: "weeklyReports",    label: "Weekly Summary Reports" },
            { field: "costAlerts",       label: "Cost Alerts" },
          ].map(({ field, label }) => (
            <FormControlLabel
              key={field}
              control={
                <Switch
                  checked={settings[field]}
                  onChange={(e) => handleChange(field, e.target.checked)}
                  sx={{
                    "& .MuiSwitch-switchBase.Mui-checked": { color: "#3b82f6" },
                    "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": {
                      bgcolor: "#3b82f650",
                    },
                  }}
                />
              }
              label={
                <Typography sx={{ color: C.textSub, fontSize: { xs: "0.875rem", md: "1rem" } }}>
                  {label}
                </Typography>
              }
              sx={{ mb: 2, display: "flex" }}
            />
          ))}

          {settings.costAlerts && (
            <TextField
              fullWidth
              type="number"
              label="Monthly Budget Limit ($)"
              value={settings.alertThreshold}
              onChange={(e) => handleChange("alertThreshold", parseFloat(e.target.value) || 0)}
              inputProps={{ min: 0, step: 10 }}
              sx={{ mb: 3, ...inputSx }}
              InputLabelProps={labelStyle}
            />
          )}

          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save />}
            onClick={handleSave}
            disabled={saving}
            sx={{ bgcolor: "#3b82f6", color: "white", "&:hover": { bgcolor: "#2563eb" } }}
          >
            Save Settings
          </Button>
        </CardContent>
      </Card>

      {/* ── API Keys ──────────────────────────────────────────────────────── */}
      <Card sx={cardSx}>
        <CardContent sx={{ p: { xs: 2, md: 3 } }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
            <Typography sx={{ color: C.text, fontWeight: 600, fontSize: { xs: "1rem", md: "1.1rem" } }}>
              API Keys
            </Typography>
            <Button
              startIcon={<Add />}
              size="small"
              sx={{ color: "#3b82f6" }}
              onClick={() => setAddOpen(true)}
            >
              Add Key
            </Button>
          </Box>

          {loadingKeys ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={24} sx={{ color: "#3b82f6" }} />
            </Box>
          ) : (
            <List sx={{ p: 0 }}>
              {apiKeys.map((key) => (
                <ListItem
                  key={key.provider}
                  sx={{
                    bgcolor: C.cardInner, mb: 1, borderRadius: 1,
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    px: { xs: 1.5, md: 2 },
                  }}
                >
                  <ListItemText
                    primary={
                      <Typography sx={{ color: C.text, fontWeight: 500, fontSize: { xs: "0.875rem", md: "1rem" } }}>
                        {PROVIDER_LABELS[key.provider] || key.provider}
                      </Typography>
                    }
                    secondary={
                      <Typography variant="caption" sx={{ color: C.textSub }}>
                        {key.model ? `Model: ${key.model}` : "No model configured"}
                      </Typography>
                    }
                  />
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
                    <Chip label={keyStatus(key)} size="small" sx={keyChipSx(key)} />
                    {key.has_key && (
                      <IconButton
                        size="small"
                        sx={{ color: "#ef4444" }}
                        onClick={() => setDeleteTarget(key.provider)}
                      >
                        <Delete fontSize="small" />
                      </IconButton>
                    )}
                  </Box>
                </ListItem>
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      {/* ── Danger Zone ───────────────────────────────────────────────────── */}
      <Card sx={{ bgcolor: C.card, border: "1px solid #ef4444", boxShadow: C.shadow }}>
        <CardContent sx={{ p: { xs: 2, md: 3 } }}>
          <Typography sx={{ color: "#ef4444", mb: 2, fontWeight: 600, fontSize: { xs: "1rem", md: "1.1rem" } }}>
            Danger Zone
          </Typography>
          <Typography variant="body2" sx={{ color: C.textSub, mb: 3 }}>
            These actions cannot be undone. Please proceed with caution.
          </Typography>
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            {[
              { key: "cache",  label: "Clear Cache" },
              { key: "reset",  label: "Reset All Settings" },
              { key: "delete", label: "Delete Account" },
            ].map(({ key, label }) => (
              <Button
                key={key}
                variant="outlined"
                onClick={() => setDangerTarget(key)}
                sx={{
                  borderColor: "#ef4444", color: "#ef4444",
                  "&:hover": { borderColor: "#dc2626", color: "#dc2626" },
                  fontSize: { xs: "0.75rem", md: "0.875rem" },
                }}
              >
                {label}
              </Button>
            ))}
          </Box>
        </CardContent>
      </Card>

      {/* ── Add Key Dialog ────────────────────────────────────────────────── */}
      <Dialog
        open={addOpen}
        onClose={() => !addSaving && setAddOpen(false)}
        PaperProps={{ sx: { bgcolor: C.card, border: `1px solid ${C.border}`, minWidth: { xs: 300, sm: 380 } } }}
      >
        <DialogTitle sx={{ color: C.text }}>Add / Update API Key</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1, mb: 2 }}>
            <InputLabel sx={{ color: C.textSub }}>Provider</InputLabel>
            <Select
              value={newKey.provider}
              label="Provider"
              onChange={(e) => setNewKey((p) => ({ ...p, provider: e.target.value, model: "" }))}
              sx={selectSx}
            >
              <MenuItem value="openai">OpenAI</MenuItem>
              <MenuItem value="anthropic">Anthropic</MenuItem>
              <MenuItem value="gemini">Google Gemini</MenuItem>
            </Select>
          </FormControl>

          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel sx={{ color: C.textSub }}>Model</InputLabel>
            <Select
              value={newKey.model}
              label="Model"
              onChange={(e) => setNewKey((p) => ({ ...p, model: e.target.value }))}
              sx={selectSx}
            >
              {(PROVIDER_MODELS[newKey.provider] || []).map((m) => (
                <MenuItem key={m} value={m}>{m}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            fullWidth
            type="password"
            label="API Key"
            placeholder="sk-..."
            value={newKey.apiKey}
            onChange={(e) => setNewKey((p) => ({ ...p, apiKey: e.target.value }))}
            sx={{ mb: 2, ...inputSx }}
            InputLabelProps={labelStyle}
          />

          <FormControlLabel
            control={
              <Checkbox
                checked={newKey.setActive}
                onChange={(e) => setNewKey((p) => ({ ...p, setActive: e.target.checked }))}
                sx={{ color: "#3b82f6", "&.Mui-checked": { color: "#3b82f6" } }}
              />
            }
            label={
              <Typography sx={{ color: C.textSub, fontSize: "0.9rem" }}>
                Set as active provider
              </Typography>
            }
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAddOpen(false)} disabled={addSaving} sx={{ color: C.textSub }}>Cancel</Button>
          <Button
            onClick={handleAddKey}
            disabled={addSaving}
            variant="contained"
            startIcon={addSaving && <CircularProgress size={14} color="inherit" />}
            sx={{ bgcolor: "#3b82f6", "&:hover": { bgcolor: "#2563eb" } }}
          >
            Save Key
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Key Confirmation ───────────────────────────────────────── */}
      <Dialog
        open={!!deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        PaperProps={{ sx: { bgcolor: C.card, border: `1px solid ${C.border}` } }}
      >
        <DialogTitle sx={{ color: "#ef4444" }}>Remove API Key</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: C.textSub }}>
            Remove the API key for{" "}
            <strong style={{ color: C.text }}>{PROVIDER_LABELS[deleteTarget]}</strong>?
            This will deactivate the provider.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting} sx={{ color: C.textSub }}>Cancel</Button>
          <Button
            onClick={handleDeleteKey}
            disabled={deleting}
            variant="contained"
            startIcon={deleting && <CircularProgress size={14} color="inherit" />}
            sx={{ bgcolor: "#ef4444", "&:hover": { bgcolor: "#dc2626" } }}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Danger Zone Confirmation ──────────────────────────────────────── */}
      <Dialog
        open={!!dangerTarget}
        onClose={() => !dangerLoading && setDangerTarget(null)}
        PaperProps={{ sx: { bgcolor: C.card, border: "1px solid #ef4444" } }}
      >
        <DialogTitle sx={{ color: "#ef4444" }}>
          {dangerTarget ? DANGER_COPY[dangerTarget]?.title : ""}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: C.textSub }}>
            {dangerTarget ? DANGER_COPY[dangerTarget]?.body : ""}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDangerTarget(null)} disabled={dangerLoading} sx={{ color: C.textSub }}>Cancel</Button>
          <Button
            onClick={handleDanger}
            disabled={dangerLoading}
            variant="contained"
            startIcon={dangerLoading && <CircularProgress size={14} color="inherit" />}
            sx={{ bgcolor: "#ef4444", "&:hover": { bgcolor: "#dc2626" } }}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Snackbar ──────────────────────────────────────────────────────── */}
      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={snack.severity}
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          sx={{ width: "100%" }}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Settings;
