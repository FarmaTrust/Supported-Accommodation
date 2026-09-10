import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { getAuthFeedback } from "@shared/authFeedback";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  // Login is started via startLogin() in the effect below, only when we actually
  // navigate — never during render. startLogin() mints a one-time nonce + writes
  // the state cookie, so calling it per render would overwrite the cookie and
  // desync it from an in-flight login's `state`.
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const utils = trpc.useUtils();

  const statusQuery = trpc.auth.status.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.status.setData(undefined, { user: null, issue: null });
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      // Clear the Preview auto-login token mirrored into sessionStorage, so
      // header-based sessions (Safari ITP / WebView) are logged out too. The
      // backend cookie is cleared by the logout mutation.
      try {
        sessionStorage.removeItem("manus-cookie");
      } catch {}
      utils.auth.status.setData(undefined, { user: null, issue: null });
      await utils.auth.status.invalidate();
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    try {
      localStorage.setItem("manus-runtime-user-info", JSON.stringify(statusQuery.data?.user ?? null));
    } catch {}
    const authIssue = statusQuery.error
      ? getAuthFeedback("AUTH_SERVICE_UNAVAILABLE")
      : statusQuery.data?.issue
        ? getAuthFeedback(statusQuery.data.issue)
        : null;
    return {
      user: statusQuery.data?.user ?? null,
      authIssue,
      loading: statusQuery.isLoading || logoutMutation.isPending,
      error: statusQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(statusQuery.data?.user),
    };
  }, [
    statusQuery.data,
    statusQuery.error,
    statusQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (statusQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (redirectPath && window.location.pathname === redirectPath) return;

    // Navigate at this moment only. startLogin() mints the nonce + cookie itself.
    if (redirectPath) {
      window.location.href = redirectPath;
    } else {
      startLogin();
    }
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    statusQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => statusQuery.refetch(),
    logout,
  };
}
