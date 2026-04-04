"use client";

import { useUserStore } from "@/store/userStore";
import { createClient } from "@/lib/supabase/client";
import Badge from "@/components/ui/Badge";

export default function AppHeader() {
  const { user, profile } = useUserStore();

  async function handleLogout() {
    // Clear zustand store immediately for instant UI feedback
    useUserStore.getState().logout();
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-2">
      <div className="flex items-center gap-4">
        <a href="/" className="text-sm font-bold text-white">
          screener-ai
        </a>
        <nav className="hidden items-center gap-3 sm:flex">
          <a
            href="/screener"
            className="text-xs text-muted transition hover:text-white"
          >
            Screener
          </a>
          <a
            href="/mf"
            className="text-xs text-muted transition hover:text-white"
          >
            Mutual Funds
          </a>
          <a
            href="/compare"
            className="text-xs text-muted transition hover:text-white"
          >
            Compare
          </a>
          {user && (
            <>
              <a
                href="/portfolio"
                className="text-xs text-muted transition hover:text-white"
              >
                Portfolio
              </a>
              <a
                href="/paper-trading"
                className="text-xs text-muted transition hover:text-white"
              >
                Paper Trading
              </a>
            </>
          )}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        {user ? (
          <>
            {profile?.investment_style && (
              <Badge
                label={
                  profile.investment_style.charAt(0).toUpperCase() +
                  profile.investment_style.slice(1)
                }
                variant="sector"
              />
            )}
            <span className="text-xs text-muted">
              {user.email}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded border border-border px-2 py-1 text-xs text-muted transition hover:border-muted hover:text-white"
            >
              Logout
            </button>
          </>
        ) : (
          <a
            href="/auth/login"
            className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary/80"
          >
            Login
          </a>
        )}
      </div>
    </header>
  );
}
