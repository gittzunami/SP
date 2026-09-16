import React from "react";
import { useParams } from "react-router-dom";
import { Box, Typography } from "@mui/material";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export default function NewsletterPreview() {
  const { newsletterId } = useParams();

  if (!newsletterId) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", bgcolor: "#f8fafc", p: 3 }}>
        <Box sx={{ textAlign: "center" }}>
          <Typography variant="h6" sx={{ color: "#0f172a", fontWeight: 700 }}>
            Newsletter preview unavailable
          </Typography>
          <Typography sx={{ mt: 1, color: "#475569" }}>
            No newsletter ID was provided.
          </Typography>
        </Box>
      </Box>
    );
  }

  const previewUrl = `${API_BASE}/api/newsletters/${encodeURIComponent(newsletterId)}/preview`;

  return (
    <Box sx={{ width: "100vw", height: "100vh", overflow: "hidden", bgcolor: "#f8fafc" }}>
      <iframe
        title="Newsletter preview"
        src={previewUrl}
        style={{ width: "100%", height: "100%", border: "none", background: "#ffffff", display: "block" }}
      />
    </Box>
  );
}
