"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUserStore } from "@/store/userStore";

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { setUser, setProfile, setLoading, logout } = useUserStore();

  useEffect(() => {
    const supabase = createClient();
    setLoading(true);

    // Use onAuthStateChange as the single source of truth.
    // The INITIAL_SESSION event fires immediately with the current session,
    // so there is no need for a separate getSession() call (which would race
    // for the browser navigator lock and cause "lock was released" errors).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (
        (event === "INITIAL_SESSION" || event === "SIGNED_IN" ||
          event === "TOKEN_REFRESHED") &&
        session?.user
      ) {
        setUser(session.user);
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("*")
          .eq("id", session.user.id)
          .single();

        if (profile) {
          setProfile(profile);
        }
      } else if (event === "SIGNED_OUT") {
        logout();
      }

      // Loading is done after the first event (INITIAL_SESSION)
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setUser, setProfile, setLoading, logout]);

  return <>{children}</>;
}
