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

    // Fetch current session on mount
    async function init() {
      setLoading(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        setUser(session.user);
        // Fetch profile
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("*")
          .eq("id", session.user.id)
          .single();

        if (profile) {
          setProfile(profile);
        }
      }
      setLoading(false);
    }

    init();

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
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
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setUser, setProfile, setLoading, logout]);

  return <>{children}</>;
}
