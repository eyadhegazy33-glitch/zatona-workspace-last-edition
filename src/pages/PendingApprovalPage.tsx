import { Check, Clock3, LoaderCircle, LogOut } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { AuthServiceError } from "../services/auth";

export function PendingApprovalPage() {
  const { profile, refreshProfile, signOut } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleCheckAgain = async () => {
    setChecking(true);
    setMessage(null);

    try {
      const nextProfile = await refreshProfile();

      if (nextProfile?.status === "active") {
        navigate("/dashboard", { replace: true });
        return;
      }

      if (nextProfile?.status === "rejected") {
        return;
      }

      if (nextProfile?.status === "suspended") {
        return;
      }

      if (!nextProfile) {
        setMessage("auth.errors.profileUnavailable");
        return;
      }

      setMessage("pendingApproval.stillPending");
    } catch (error) {
      setMessage(
        error instanceof AuthServiceError
          ? error.messageKey
          : "auth.errors.profileUnavailable",
      );
    } finally {
      setChecking(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    setMessage(null);

    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch {
      setMessage("auth.errors.signOutFailed");
      setSigningOut(false);
    }
  };

  const displayName = [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-7 flex items-center gap-3">
          <span
            aria-label={t("register.logoPlaceholder")}
            className="inline-flex size-11 items-center justify-center rounded-xl bg-brand text-lg font-semibold text-white"
          >
            E
          </span>
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
            {t("register.logoPlaceholder")}
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-9">
          <div className="mb-5 inline-flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <Clock3 aria-hidden="true" size={22} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-white sm:text-3xl">
            {t("pages.pendingApproval.title")}
          </h1>
          <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
            {t("pendingApproval.description")}
          </p>

          <div className="mt-6 space-y-2 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/70">
            {displayName && (
              <p className="text-slate-700 dark:text-slate-200">
                <span className="font-medium">{t("pendingApproval.name")}:</span>{" "}
                {displayName}
              </p>
            )}
            {profile?.email && (
              <p className="break-all text-slate-700 dark:text-slate-200">
                <span className="font-medium">{t("login.fields.email")}:</span>{" "}
                {profile.email}
              </p>
            )}
          </div>

          {message && (
            <p
              className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              role="status"
            >
              {t(message)}
            </p>
          )}

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <button
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand/90 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-slate-900"
              disabled={checking || signingOut}
              onClick={() => void handleCheckAgain()}
              type="button"
            >
              {checking ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin"
                  size={18}
                />
              ) : (
                <Check aria-hidden="true" size={18} />
              )}
              {checking
                ? t("pendingApproval.checking")
                : t("pendingApproval.checkAgain")}
            </button>
            <button
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus:ring-offset-slate-900"
              disabled={checking || signingOut}
              onClick={() => void handleSignOut()}
              type="button"
            >
              {signingOut ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin"
                  size={18}
                />
              ) : (
                <LogOut aria-hidden="true" size={18} />
              )}
              {signingOut
                ? t("pendingApproval.signingOut")
                : t("pendingApproval.signOut")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
