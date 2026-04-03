const raw = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

// Resolve at call-time so the check always runs in the browser context,
// avoiding mixed-content blocks when the page is served over HTTPS.
function resolveBackendUrl(): string {
  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    raw.startsWith("http://")
  ) {
    return raw.replace("http://", "https://");
  }
  return raw;
}

// Lazy-initialised constant — safe for both SSR and client imports.
let _resolved: string | undefined;
export function getBackendUrl(): string {
  if (_resolved === undefined) {
    _resolved = resolveBackendUrl();
  }
  return _resolved;
}

/** @deprecated Use getBackendUrl() for reliable HTTPS upgrade */
export const BACKEND_URL = resolveBackendUrl();
