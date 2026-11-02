import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { z } from "zod";
import { isSupabaseConfigured } from "../lib/supabase";
import { AuthServiceError, sendPasswordReset } from "../services/auth";

const forgotPasswordSchema = z.object({
  email: z.string().trim().email("forgotPassword.validation.email"),
});

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordPage() {
  const { i18n, t } = useTranslation();
  const BackIcon = i18n.dir() === "rtl" ? ArrowRight : ArrowLeft;
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setSubmitError(null);

    try {
      await sendPasswordReset(email);
      setSubmitted(true);
    } catch (error) {
      setSubmitError(
        error instanceof AuthServiceError
          ? error.messageKey
          : "auth.errors.generic",
      );
    }
  });

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
          <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-white sm:text-3xl">
            {t("pages.forgotPassword.title")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
            {t("pages.forgotPassword.description")}
          </p>

          {submitted ? (
            <div className="mt-6" role="status">
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                {t("forgotPassword.success")}
              </p>
              <Link
                className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-medium text-white transition hover:bg-brand/90 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                to="/login"
              >
                <BackIcon aria-hidden="true" size={16} />
                {t("register.backToLogin")}
              </Link>
            </div>
          ) : (
            <form
              aria-label={t("forgotPassword.formLabel")}
              className="mt-7 space-y-5"
              noValidate
              onSubmit={(event) => {
                void onSubmit(event);
              }}
            >
              <div>
                <label
                  className="text-sm font-medium text-slate-700 dark:text-slate-300"
                  htmlFor="recovery-email"
                >
                  {t("login.fields.email")}
                </label>
                <input
                  autoComplete="email"
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                  id="recovery-email"
                  type="email"
                  {...register("email")}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? "recovery-email-error" : undefined}
                  placeholder={t("login.placeholders.email")}
                />
                {errors.email && (
                  <p
                    className="mt-1.5 text-sm text-red-600 dark:text-red-400"
                    id="recovery-email-error"
                  >
                    {t(errors.email.message ?? "auth.errors.generic")}
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

              <button
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand/90 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-slate-900"
                disabled={
                  isSubmitting ||
                  !isSupabaseConfigured
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
                {isSubmitting
                  ? t("forgotPassword.submitting")
                  : t("forgotPassword.submit")}
              </button>

              {!isSupabaseConfigured && (
                <p className="text-sm text-amber-700 dark:text-amber-300" role="status">
                  {t("auth.errors.supabaseNotConfigured")}
                </p>
              )}
            </form>
          )}

          {!submitted && (
            <Link
              className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-brand underline-offset-4 hover:underline dark:text-emerald-400"
              to="/login"
            >
              <BackIcon aria-hidden="true" size={16} />
              {t("register.backToLogin")}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
