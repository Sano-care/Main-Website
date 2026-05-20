"use client";

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { User, Session } from "@supabase/supabase-js";
import { useRouter, usePathname } from "next/navigation";
import { createOpsBrowserClient } from "@/lib/supabase-browser";

// Master admin email - this user can create other admins
const MASTER_ADMIN_EMAIL = "master@sanocare.in";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isMasterAdmin: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isLoading: true,
  isMasterAdmin: false,
  signOut: async () => {},
});

export function OpsAuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => createOpsBrowserClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Case-insensitive email comparison for master admin check
  const isMasterAdmin = user?.email?.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase();

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    router.replace("/ops/login");
  }, [router, supabase]);

  useEffect(() => {
    // Get initial session
    const initAuth = async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      setIsLoading(false);

      // Redirect to login if not authenticated and not on login page
      if (!currentSession && pathname !== "/ops/login") {
        router.replace("/ops/login");
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (event === "SIGNED_OUT") {
          router.replace("/ops/login");
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [router, pathname, supabase]);

  // Handle visibility change - refresh session when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && session) {
        // Refresh session to ensure it's still valid
        const { data: { session: refreshedSession } } = await supabase.auth.getSession();
        if (!refreshedSession) {
          // Session expired, redirect to login
          router.replace("/ops/login");
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [session, router, supabase]);

  return (
    <AuthContext.Provider value={{ user, session, isLoading, isMasterAdmin, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useOpsAuth = () => useContext(AuthContext);
