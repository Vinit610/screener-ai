import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/screener";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Check onboarding status
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("onboarding_done")
          .eq("id", user.id)
          .single();

        if (profile && !profile.onboarding_done) {
          return NextResponse.redirect(`${origin}/onboarding`);
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // If code exchange fails, redirect to login with error
  return NextResponse.redirect(`${origin}/auth/login`);
}
