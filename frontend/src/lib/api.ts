const raw = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

// Upgrade to HTTPS when the frontend is served over HTTPS (e.g. Vercel)
// to avoid mixed-content browser blocks.
export const BACKEND_URL =
  typeof window !== "undefined" &&
  window.location.protocol === "https:" &&
  raw.startsWith("http://")
    ? raw.replace("http://", "https://")
    : raw;
