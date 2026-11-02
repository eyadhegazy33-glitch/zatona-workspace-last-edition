import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { z } from "zod";
import { BrandingIdentity } from "../components/BrandingIdentity";
import { useAuth } from "../hooks/useAuth";
import {
  AuthServiceError,
  getProfileForUser,
  mapAuthError,
} from "../services/auth";
import { loginSchema } from "../lib/validationSchemas";

type LoginValues = z.infer<typeof loginSchema>;
const lockoutDurationMs = 60_000;
const attemptsBeforeLockout = 5;

export function LoginPage() {
  const { signIn, signOut } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [accountMessage, setAccountMessage] = useState<{
    key: string;
    reason?: string;
  } | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const submitStarted = useRef(false);
  const routeState = location.state as
    | { messageKey?: unknown; reason?: unknown }
    | null;
  const routeMessageKey =
    typeof routeState?.messageKey === "string" ? routeState.messageKey : null;
  const routeReason =
    typeof routeState?.reason === "string" ? routeState.reason : undefined;
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (!lockoutUntil) {
      setRemainingSeconds(0);
      return;
    }

    const updateRemainingTime = () => {
      const nextRemaining = Math.max(
        0,
        Math.ceil((lockoutUntil - Date.now()) / 1000),
      );
      setRemainingSeconds(nextRemaining);

      if (nextRemaining === 0) {
        setLockoutUntil(null);
        setFailedAttempts(0);
      }
    };

    updateRemainingTime();
    const intervalId = window.setInterval(updateRemainingTime, 250);

    return () => window.clearInterval(intervalId);
  }, [lockoutUntil]);

  const onSubmit = handleSubmit(async ({ email, password }) => {
    if (submitStarted.current || lockoutUntil) {
      return;
    }

    submitStarted.current = true;
    setSubmitError(null);
    setAccountMessage(null);

    try {
      const { user } = await signIn(email, password);
      const profile = await getProfileForUser(user.id);

      if (!profile) {
        throw new AuthServiceError("auth.errors.profileUnavailable");
      }

      setFailedAttempts(0);
      setLockoutUntil(null);

      if (profile.status === "active") {
        navigate("/dashboard", { replace: true });
        return;
      }

      if (profile.status === "pending") {
        navigate("/pending-approval", { replace: true });
        return;
      }

      if (profile.status === "rejected") {
        await signOut();
        setAccountMessage({
          key: profile.reject_reason
            ? "login.accountRejectedWithReason"
            : "login.accountRejected",
          reason: profile.reject_reason ?? undefined,
        });
        return;
      }

      if (profile.status === "suspended") {
        await signOut();
        setAccountMessage({ key: "login.accountSuspended" });
        return;
      }

      await signOut();
      setSubmitError("auth.errors.profileUnavailable");
    } catch (error) {
      const mappedError = mapAuthError(error);
      setSubmitError(mappedError.messageKey);

      if (mappedError.messageKey === "auth.errors.invalidCredentials") {
        const nextAttempts = failedAttempts + 1;
        setFailedAttempts(nextAttempts);

        if (nextAttempts >= attemptsBeforeLockout) {
          setLockoutUntil(Date.now() + lockoutDurationMs);
        }
      }
    } finally {
      submitStarted.current = false;
    }
  });

  const lockedOut = remainingSeconds > 0;
  const displayedMessage = accountMessage
    ? accountMessage.reason
      ? t(accountMessage.key, { reason: accountMessage.reason })
      : t(accountMessage.key)
    : routeMessageKey
      ? routeReason
        ? t(routeMessageKey, { reason: routeReason })
        : t(routeMessageKey)
      : null;

  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-7">
          <BrandingIdentity />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-9">
          <div className="mb-7">
            <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-white sm:text-3xl">
              {t("pages.login.title")}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
              {t("pages.login.description")}
            </p>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
              {t("login.customerLink")}{" "}
              <Link className="font-semibold text-brand hover:underline" to="/customer/login">
                {t("login.customerSignIn")}
              </Link>
            </p>
          </div>

          {displayedMessage && (
            <p
              className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              role="status"
            >
              {displayedMessage}
            </p>
          )}

          <form
            aria-label={t("login.formLabel")}
            className="space-y-5"
            noValidate
            onSubmit={(event) => {
              void onSubmit(event);
            }}
          >
            <div>
              <label
                className="text-sm font-medium text-slate-700 dark:text-slate-300"
                htmlFor="login-email"
              >
                {t("login.fields.email")}
              </label>
              <input
                autoComplete="email"
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                id="login-email"
                type="email"
                {...register("email")}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "login-email-error" : undefined}
                placeholder={t("login.placeholders.email")}
              />
              {errors.email && (
                <p
                  className="mt-1.5 text-sm text-red-600 dark:text-red-400"
                  id="login-email-error"
                >
                  {t(errors.email.message ?? "auth.errors.generic")}
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <label
                  className="text-sm font-medium text-slate-700 dark:text-slate-300"
                  htmlFor="login-password"
                >
                  {t("login.fields.password")}
                </label>
                <Link
                  className="text-sm font-medium text-brand underline-offset-4 hover:underline dark:text-emerald-400"
                  to="/forgot-password"
                >
                  {t("login.forgotPassword")}
                </Link>
              </div>
              <div className="relative">
                <input
                  autoComplete="current-password"
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pe-12 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  {...register("password")}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={
                    errors.password ? "login-password-error" : undefined
                  }
                  placeholder={t("login.placeholders.password")}
                />
                <button
                  aria-label={
                    showPassword
                      ? t("register.hidePassword")
                      : t("register.showPassword")
                  }
                  className="absolute inset-y-2 end-2 inline-flex w-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand dark:text-slate-400 dark:hover:bg-slate-800"
                  onClick={() => setShowPassword((visible) => !visible)}
                  type="button"
                >
                  {showPassword ? (
                    <EyeOff aria-hidden="true" size={18} />
                  ) : (
                    <Eye aria-hidden="true" size={18} />
                  )}
                </button>
              </div>
              {errors.password && (
                <p
                  className="mt-1.5 text-sm text-red-600 dark:text-red-400"
                  id="login-password-error"
                >
                  {t(errors.password.message ?? "auth.errors.generic")}
                </p>
              )}
            </div>

            {submitError && (
              <p
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                role="alert"
              >
                {t(submitError)}
              </p>
            )}

            {failedAttempts > 0 && !lockedOut && (
              <p
                className="text-sm text-amber-700 dark:text-amber-300"
                role="status"
              >
                {t("login.failedAttempts", {
                  count: attemptsBeforeLockout - failedAttempts,
                })}
              </p>
            )}

            {lockedOut && (
              <p
                className="text-sm text-amber-700 dark:text-amber-300"
                role="status"
              >
                {t("login.lockout", { seconds: remainingSeconds })}
              </p>
            )}

            <button
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand/90 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-slate-900"
              disabled={
                isSubmitting ||
                lockedOut
              }
              type="submit"
            >
              {isSubmitting && (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin"
                  size={18}
                />
              )}
              {lockedOut
                ? t("login.lockoutButton", { seconds: remainingSeconds })
                : isSubmitting
                  ? t("login.submitting")
                  : t("login.submit")}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
            {t("login.noAccount")}{" "}
            <Link
              className="font-medium text-brand underline-offset-4 hover:underline dark:text-emerald-400"
              to="/register"
            >
              {t("login.createAccount")}
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
