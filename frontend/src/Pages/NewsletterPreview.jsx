import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Box, Typography, CircularProgress } from "@mui/material";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export default function NewsletterPreview() {
  const [searchParams] = useSearchParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) {
      setPayload(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchPreview = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/public/preview?token=${encodeURIComponent(token)}`);
        if (!res.ok) {
          throw new Error("Preview unavailable");
        }
        const data = await res.json();
        if (!cancelled) {
          setPayload(data || null);
        }
      } catch {
        if (!cancelled) {
          setPayload(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchPreview();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", bgcolor: "#f8fafc", p: 3 }}>
        <Box sx={{ textAlign: "center" }}>
          <Typography variant="h6" sx={{ color: "#0f172a", fontWeight: 700 }}>
            Newsletter preview unavailable
          </Typography>
          <Typography sx={{ mt: 1, color: "#475569" }}>
            No temporary preview token was provided.
          </Typography>
        </Box>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", bgcolor: "#f8fafc" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!payload) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", bgcolor: "#f8fafc", p: 3 }}>
        <Box sx={{ textAlign: "center" }}>
          <Typography variant="h6" sx={{ color: "#0f172a", fontWeight: 700 }}>
            Preview expired or invalid
          </Typography>
          <Typography sx={{ mt: 1, color: "#475569" }}>
            This disposable preview link is no longer valid.
          </Typography>
        </Box>
      </Box>
    );
  }

  const html = payload.html || payload.content || "";
  const title = payload.title || "Newsletter Preview";

  return (
    <Box sx={{ width: "100vw", minHeight: "100vh", bgcolor: "#f8fafc", p: 0, m: 0 }}>
      <Box sx={{ maxWidth: "1200px", mx: "auto", px: { xs: 2, md: 4 }, py: 3, bgcolor: "#ffffff", minHeight: "100vh", boxSizing: "border-box" }}>
        <Typography variant="h4" sx={{ color: "#0f172a", fontWeight: 800, mb: 2 }}>
          {title}
        </Typography>
        <Box
          dangerouslySetInnerHTML={{ __html: html }}
          sx={{
            "& *": { boxSizing: "border-box" },
            "& a": { color: "#2563eb" },
          }}
        />
      </Box>
    </Box>
  );
}
