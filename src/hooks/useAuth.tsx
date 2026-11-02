import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient, isSupabaseConfigured } from "../lib/supabase";
import {
  AuthServiceError,
  getMyProfile,
  signIn,
  signOut,
  signUp,
  type MyProfile,
} from "../services/auth";

type AuthStatus = "initializing" | "ready" | "signed_out";
type SignedOutMessage = { messageKey: string; reason?: string } | null;
type CachedAccess = { cachedAt: number; profile: MyProfile };

type AuthContextValue = {
  session: Session | null;
  profile: MyProfile | null;
  permissions: string[];
  status: AuthStatus;
  error: AuthServiceError | null;
  signedOutMessage: SignedOutMessage;
  signIn: typeof signIn;
  signUp: typeof signUp;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<MyProfile | null>;
};

const ACCESS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const ACCESS_CACHE_PREFIX = "zatona.access.";
const AuthContext = createContext<AuthContextValue | null>(null);

let sessionRequest: ReturnType<
  ReturnType<typeof getSupabaseClient>["auth"]["getSession"]
> | null = null;

function getSessionOnce() {
  sessionRequest ??= getSupabaseClient().auth.getSession();
  return sessionRequest;
}

function cacheKey(userId: string) {
  return `${ACCESS_CACHE_PREFIX}${userId}`;
}

function readCachedAccess(userId: string): CachedAccess | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedAccess;
    if (
      cached.profile?.id !== userId ||
      cached.profile.status !== "active" ||
      !Array.isArray(cached.profile.permissions) ||
      !Number.isFinite(cached.cachedAt) ||
      cached.cachedAt > Date.now() ||
      Date.now() - cached.cachedAt >= ACCESS_CACHE_TTL_MS
    ) {
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

function writeCachedAccess(profile: MyProfile) {
  try {
    window.localStorage.setItem(
      cacheKey(profile.id),
      JSON.stringify({ cachedAt: Date.now(), profile } satisfies CachedAccess),
    );
  } catch {
    // Access caching is optional; the live RPC remains authoritative.
  }
}

function clearCachedAccess(userId: string | null | undefined) {
  if (!userId) return;
  try {
    window.localStorage.removeItem(cacheKey(userId));
  } catch {
    // The in-memory auth state is still cleared if storage is unavailable.
  }
}

function clearOtherAccessCaches(userId?: string) {
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (
        key?.startsWith(ACCESS_CACHE_PREFIX) &&
        key !== (userId ? cacheKey(userId) : null)
      ) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Access caching is optional; the live RPC remains authoritative.
  }
}

function isUnauthorized(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  if ("status" in cause && cause.status === 401) return true;
  if ("cause" in cause) return isUnauthorized(cause.cause);
  return false;
}

function revokedMessage(profile: MyProfile | null): SignedOutMessage {
  if (profile?.status === "rejected") {
    return {
      messageKey: profile.reject_reason
        ? "login.accountRejectedWithReason"
        : "login.accountRejected",
      reason: profile.reject_reason ?? undefined,
    };
  }
  if (profile?.status === "suspended") {
    return { messageKey: "auth.messages.accountSuspended" };
  }
  return { messageKey: "auth.errors.profileUnavailable" };
}

type AuthProviderProps = {
  children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [status, setStatus] = useState<AuthStatus>("initializing");
  const [error, setError] = useState<AuthServiceError | null>(null);
  const [signedOutMessage, setSignedOutMessage] =
    useState<SignedOutMessage>(null);
  const sessionRef = useRef<Session | null>(null);
  const userIdRef = useRef<string | null>(null);

  const clearState = useCallback((message: SignedOutMessage = null) => {
    clearCachedAccess(userIdRef.current);
    clearOtherAccessCaches();
    userIdRef.current = null;
    sessionRef.current = null;
    setSession(null);
    setProfile(null);
    setError(null);
    setSignedOutMessage(message);
    setStatus("signed_out");
  }, []);

  const loadAccess = useCallback(
    async (nextSession: Session, useCache: boolean) => {
      const userId = nextSession.user.id;
      clearOtherAccessCaches(userId);
      const previousUserId = userIdRef.current;
      if (previousUserId && previousUserId !== userId) {
        clearCachedAccess(previousUserId);
        setProfile(null);
      }
      userIdRef.current = userId;
      sessionRef.current = nextSession;
      setSession(nextSession);
      setSignedOutMessage(null);
      setError(null);

      const cached = useCache ? readCachedAccess(userId) : null;
      if (cached) {
        setProfile(cached.profile);
        setStatus("ready");
      } else {
        setProfile(null);
        setStatus("initializing");
      }

      try {
        const freshProfile = await getMyProfile(userId);
        if (userIdRef.current !== userId) return;
        if (
          !freshProfile ||
          freshProfile.deleted_at ||
          freshProfile.status === "rejected" ||
          freshProfile.status === "suspended"
        ) {
          clearCachedAccess(userId);
          const message = revokedMessage(freshProfile);
          setSignedOutMessage(message);
          setProfile(null);
          setSession(null);
          sessionRef.current = null;
          userIdRef.current = null;
          setStatus("signed_out");
          try {
            await signOut();
          } catch (signOutError) {
            setError(
              signOutError instanceof AuthServiceError
                ? signOutError
                : new AuthServiceError("auth.errors.signOutFailed", {
                    cause:
                      signOutError instanceof Error ? signOutError : undefined,
                  }),
            );
          }
          setSignedOutMessage(message);
          return;
        }

        if (freshProfile.status === "active") writeCachedAccess(freshProfile);
        else clearCachedAccess(userId);
        setProfile(freshProfile);
        setStatus("ready");
      } catch (cause: unknown) {
        if (userIdRef.current !== userId) return;
        if (isUnauthorized(cause)) {
          clearCachedAccess(userId);
          setProfile(null);
          setSession(null);
          sessionRef.current = null;
          userIdRef.current = null;
          setSignedOutMessage({ messageKey: "auth.errors.profileUnavailable" });
          setStatus("signed_out");
          try {
            await signOut();
          } catch (signOutError) {
            setError(
              signOutError instanceof AuthServiceError
                ? signOutError
                : new AuthServiceError("auth.errors.signOutFailed", {
                    cause:
                      signOutError instanceof Error ? signOutError : undefined,
                  }),
            );
          }
          setSignedOutMessage({ messageKey: "auth.errors.profileUnavailable" });
          return;
        }
        if (!cached) {
          setError(
            cause instanceof AuthServiceError
              ? cause
              : new AuthServiceError("auth.errors.profileUnavailable", {
                  cause: cause instanceof Error ? cause : undefined,
                }),
          );
        }
        if (!cached) setProfile(null);
        setStatus("ready");
      }
    },
    [],
  );

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setError(new AuthServiceError("auth.errors.supabaseNotConfigured"));
      setStatus("signed_out");
      return;
    }

    let mounted = true;
    let authEventReceived = false;
    const client = getSupabaseClient();
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, nextSession) => {
      if (event === "TOKEN_REFRESHED") return;
      if (event === "SIGNED_IN" && nextSession?.user.id === userIdRef.current) {
        return;
      }
      authEventReceived = true;
      if (event === "SIGNED_OUT" || !nextSession) {
        clearState();
        return;
      }

      queueMicrotask(() => {
        if (mounted) void loadAccess(nextSession, true);
      });
    });

    void getSessionOnce()
      .then(({ data, error: sessionError }) => {
        if (!mounted || authEventReceived) return;
        if (sessionError) {
          setError(
            new AuthServiceError("auth.errors.generic", { cause: sessionError }),
          );
          setStatus("signed_out");
          return;
        }
        if (!data.session) {
          clearState();
          return;
        }
        void loadAccess(data.session, true);
      })
      .catch((cause: unknown) => {
        if (!mounted || authEventReceived) return;
        setError(
          new AuthServiceError("auth.errors.generic", {
            cause: cause instanceof Error ? cause : undefined,
          }),
        );
        setStatus("signed_out");
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [clearState, loadAccess]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    clearState();
  }, [clearState]);

  const refreshProfile = useCallback(async () => {
    const currentSession = sessionRef.current;
    if (!currentSession) {
      setProfile(null);
      return null;
    }
    const refreshed = await getMyProfile(currentSession.user.id);
    if (
      !refreshed ||
      refreshed.deleted_at ||
      refreshed.status === "rejected" ||
      refreshed.status === "suspended"
    ) {
      const message = revokedMessage(refreshed);
      clearState(message);
      try {
        await signOut();
      } catch (cause) {
        setError(
          cause instanceof AuthServiceError
            ? cause
            : new AuthServiceError("auth.errors.signOutFailed", {
                cause: cause instanceof Error ? cause : undefined,
              }),
        );
      }
      setSignedOutMessage(message);
      return null;
    }
    if (refreshed.status === "active") writeCachedAccess(refreshed);
    else clearCachedAccess(refreshed.id);
    setProfile(refreshed);
    setError(null);
    setStatus("ready");
    return refreshed;
  }, [clearState]);

  const permissions = profile?.permissions ?? [];
  const contextValue = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      permissions,
      status,
      error,
      signedOutMessage,
      signIn,
      signUp,
      signOut: handleSignOut,
      refreshProfile,
    }),
    [
      session,
      profile,
      permissions,
      status,
      error,
      signedOutMessage,
      handleSignOut,
      refreshProfile,
    ],
  );

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }

  return context;
}
