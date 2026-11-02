import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";

function RouteMessage({ messageKey }: { messageKey: string }) {
  const { t } = useTranslation();

  return (
    <div
      className="mx-auto max-w-5xl px-6 py-16 text-slate-700 dark:text-slate-200"
      role="status"
    >
      {t(messageKey)}
    </div>
  );
}

function RouteSkeleton() {
  return (
    <div
      aria-busy="true"
      className="mx-auto max-w-5xl animate-pulse space-y-4 px-6 py-16"
      role="status"
    >
      <div className="h-8 w-56 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="h-4 w-full max-w-xl rounded bg-slate-200 dark:bg-slate-800" />
      <div className="h-48 rounded-2xl bg-slate-100 dark:bg-slate-900" />
    </div>
  );
}

function SignOutAndRedirect({
  messageKey,
  reason,
}: {
  messageKey: string;
  reason?: string;
}) {
  const { signOut } = useAuth();
  const [complete, setComplete] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;

    void signOut()
      .then(() => {
        if (mounted) {
          setComplete(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setFailed(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, [signOut]);

  if (failed) {
    return <RouteMessage messageKey="auth.errors.signOutFailed" />;
  }

  if (complete) {
    return (
      <Navigate
        replace
        to="/login"
        state={{ messageKey, reason }}
      />
    );
  }

  return <RouteMessage messageKey="auth.messages.signingOut" />;
}

export function ProtectedRoute() {
  const { error, profile, session, status, signedOutMessage } = useAuth();

  if (status === "initializing") {
    return <RouteSkeleton />;
  }

  if (status === "signed_out" || !session) {
    return <Navigate replace to="/login" state={signedOutMessage ?? undefined} />;
  }

  if (error) {
    return <RouteMessage messageKey={error.messageKey} />;
  }

  if (!profile) {
    return <RouteMessage messageKey="auth.errors.profileUnavailable" />;
  }

  if (profile.status === "pending") {
    return <Navigate replace to="/pending-approval" />;
  }

  if (profile.status === "rejected" || profile.status === "suspended") {
    return (
      <SignOutAndRedirect
        messageKey={
          profile.status === "rejected"
            ? profile.reject_reason
              ? "login.accountRejectedWithReason"
              : "login.accountRejected"
            : "auth.messages.accountSuspended"
        }
        reason={
          profile.status === "rejected"
            ? profile.reject_reason ?? undefined
            : undefined
        }
      />
    );
  }

  if (profile.status !== "active") {
    return <Navigate replace to="/login" />;
  }

  return <Outlet />;
}

export function PendingApprovalRoute() {
  const { error, profile, session, status, signedOutMessage } = useAuth();

  if (status === "initializing") {
    return <RouteSkeleton />;
  }

  if (status === "signed_out" || !session) {
    return <Navigate replace to="/login" state={signedOutMessage ?? undefined} />;
  }

  if (error) {
    return <RouteMessage messageKey={error.messageKey} />;
  }

  if (!profile) {
    return <RouteMessage messageKey="auth.errors.profileUnavailable" />;
  }

  if (profile.status === "active") {
    return <Navigate replace to="/dashboard" />;
  }

  if (profile.status === "pending") {
    return <Outlet />;
  }

  if (profile.status === "rejected" || profile.status === "suspended") {
    return (
      <SignOutAndRedirect
        messageKey={
          profile.status === "rejected"
            ? profile.reject_reason
              ? "login.accountRejectedWithReason"
              : "login.accountRejected"
            : "login.accountSuspended"
        }
        reason={
          profile.status === "rejected"
            ? profile.reject_reason ?? undefined
            : undefined
        }
      />
    );
  }

  return <Navigate replace to="/login" />;
}

export function PermissionRoute({
  permission,
}: {
  permission: string | readonly string[];
}) {
  const { error, permissions, profile, status } = useAuth();

  if (status === "initializing") return <RouteSkeleton />;
  if (error) return <RouteMessage messageKey={error.messageKey} />;
  if (!profile) return <RouteMessage messageKey="auth.errors.profileUnavailable" />;
  const requiredPermissions = Array.isArray(permission)
    ? permission
    : [permission];
  if (!requiredPermissions.some((required) => permissions.includes(required))) {
    return <Navigate replace to="/not-allowed" />;
  }

  return <Outlet />;
}

export function NotAllowedPage() {
  const { t } = useTranslation();

  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-3xl font-semibold text-ink dark:text-white">
        {t("pages.notAllowed.title")}
      </h1>
      <p className="mt-3 text-slate-600 dark:text-slate-400">
        {t("pages.notAllowed.description")}
      </p>
    </section>
  );
}
