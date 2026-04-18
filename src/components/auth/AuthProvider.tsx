"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

// Single source of truth for the signed-in user on the client. Wraps
// the whole app in layout.tsx and exposes:
//
//   - `session` / `user`   — raw Supabase auth state
//   - `profile`            — user_profiles row (null until completeSignup)
//   - `loyalty`            — stars balance + rewards info
//   - `welcomeDiscount`    — 30% off flag
//   - sign-in helpers      — `signInWithApple`, `signInWithGoogle`,
//                            `signInWithPhone`, `verifyOtp`
//   - `completeSignup`     — final step after OAuth (or phone-only)
//   - `signOut`, `refresh`
//
// State shape matches the `/api/me` response exactly; the provider
// calls `/api/me` on mount AND whenever the auth session changes, then
// caches the result in memory. Components consume it via `useAuth()`.

export type AuthProfile = {
  user_id: string;
  square_customer_id: string;
  phone_e164: string;
  first_name: string | null;
  last_name: string | null;
};

export type LoyaltyInfo = {
  accountId: string;
  balance: number;
  lifetimePoints: number;
};

export type WelcomeDiscountInfo = {
  available: boolean;
  percentage: number;
};

export type MeResponse = {
  ok: true;
  authed: boolean;
  profile: AuthProfile | null;
  email?: string | null;
  phone?: string | null;
  loyalty: LoyaltyInfo | null;
  welcomeDiscount: WelcomeDiscountInfo;
  starsPerReward: number;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: AuthProfile | null;
  loyalty: LoyaltyInfo | null;
  welcomeDiscount: WelcomeDiscountInfo;
  starsPerReward: number;
  loading: boolean;
  signInWithApple: (redirectTo?: string) => Promise<void>;
  signInWithGoogle: (redirectTo?: string) => Promise<void>;
  signInWithPhone: (phoneE164: string) => Promise<void>;
  verifyOtp: (phoneE164: string, token: string) => Promise<void>;
  completeSignup: (args: {
    firstName: string;
    lastName?: string;
  }) => Promise<AuthProfile>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

const DEFAULT_WELCOME: WelcomeDiscountInfo = {
  available: false,
  percentage: 0,
};

function getRedirectUrl(redirectTo?: string): string {
  const next = redirectTo && redirectTo.startsWith("/") ? redirectTo : "/account";
  if (typeof window !== "undefined") {
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return `${site}/auth/callback?next=${encodeURIComponent(next)}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyInfo | null>(null);
  const [welcomeDiscount, setWelcomeDiscount] =
    useState<WelcomeDiscountInfo>(DEFAULT_WELCOME);
  const [starsPerReward, setStarsPerReward] = useState(9);
  const [loading, setLoading] = useState(true);

  const inFlight = useRef<Promise<void> | null>(null);

  const fetchMe = useCallback(async () => {
    // De-dupe overlapping refresh() calls so the tab doesn't hammer
    // /api/me after e.g. an OAuth redirect and an onAuthStateChange
    // fire within milliseconds of each other.
    if (inFlight.current) return inFlight.current;
    const p = (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const json = (await res.json()) as MeResponse;
        if (!json.ok) return;
        setProfile(json.profile);
        setLoyalty(json.loyalty);
        setWelcomeDiscount(json.welcomeDiscount);
        setStarsPerReward(json.starsPerReward);
      } catch {
        // Non-fatal — leave state untouched.
      }
    })();
    inFlight.current = p;
    try {
      await p;
    } finally {
      inFlight.current = null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (!mounted) return;
      setSession(data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: string, nextSession: Session | null) => {
        setSession(nextSession);
      },
    );

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  // Whenever session changes, re-hydrate profile/loyalty/welcome.
  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchMe();
      setLoading(false);
    })();
  }, [session?.access_token, fetchMe]);

  const signInWithApple = useCallback(
    async (redirectTo?: string) => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "apple",
        options: { redirectTo: getRedirectUrl(redirectTo) },
      });
      if (error) throw error;
    },
    [supabase],
  );

  const signInWithGoogle = useCallback(
    async (redirectTo?: string) => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: getRedirectUrl(redirectTo) },
      });
      if (error) throw error;
    },
    [supabase],
  );

  const signInWithPhone = useCallback(
    async (phoneE164: string) => {
      // If the visitor is already signed in via Apple/Google but has
      // no phone yet, link the phone to the existing session rather
      // than creating a separate account. updateUser triggers the SMS
      // OTP for the verify step.
      if (session?.user && !session.user.phone) {
        const { error } = await supabase.auth.updateUser({ phone: phoneE164 });
        if (error) throw error;
        return;
      }

      const { error } = await supabase.auth.signInWithOtp({ phone: phoneE164 });
      if (error) throw error;
    },
    [supabase, session],
  );

  const verifyOtp = useCallback(
    async (phoneE164: string, token: string) => {
      // Same split as signInWithPhone: if the user already has a
      // session, they're confirming a phone-add (type "phone_change").
      // Otherwise this is a first-time phone sign-in (type "sms").
      const alreadySignedIn = !!session?.user && !session.user.phone;
      if (alreadySignedIn) {
        const { error } = await supabase.auth.verifyOtp({
          phone: phoneE164,
          token,
          type: "phone_change",
        });
        if (error) throw error;
        return;
      }

      const { error } = await supabase.auth.verifyOtp({
        phone: phoneE164,
        token,
        type: "sms",
      });
      if (error) throw error;
    },
    [supabase, session],
  );

  const completeSignup = useCallback(
    async ({
      firstName,
      lastName,
    }: {
      firstName: string;
      lastName?: string;
    }) => {
      const res = await fetch("/api/auth/complete-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Sign up failed");
      }
      const next = json.profile as AuthProfile;
      setProfile(next);
      // Reload loyalty / welcome since a brand-new customer just got
      // a welcome discount granted server-side.
      await fetchMe();
      return next;
    },
    [fetchMe],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setLoyalty(null);
    setWelcomeDiscount(DEFAULT_WELCOME);
  }, [supabase]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loyalty,
      welcomeDiscount,
      starsPerReward,
      loading,
      signInWithApple,
      signInWithGoogle,
      signInWithPhone,
      verifyOtp,
      completeSignup,
      signOut,
      refresh: fetchMe,
    }),
    [
      session,
      profile,
      loyalty,
      welcomeDiscount,
      starsPerReward,
      loading,
      signInWithApple,
      signInWithGoogle,
      signInWithPhone,
      verifyOtp,
      completeSignup,
      signOut,
      fetchMe,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
