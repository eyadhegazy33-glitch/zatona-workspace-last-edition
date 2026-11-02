import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { z } from "zod";
import { isSupabaseConfigured } from "../lib/supabase";
import { AuthServiceError, updatePassword } from "../services/auth";

const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "register.validation.passwordMin")
      .regex(/(?=.*\p{L})(?=.*\d)/u, "register.validation.passwordComplexity"),
    confirmPassword: z.string().min(1, "register.validation.confirmPassword"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "register.validation.passwordMismatch",
    path: ["confirmPassword"],
  });

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export function ResetPasswordPage() {
  const { i18n, t } = useTranslation();
  const BackIcon = i18n.dir() === "rtl" ? ArrowRight : ArrowLeft;
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit(async ({ password }) => {
    setSubmitError(null);

    try {
      await updatePassword(password);
      setUpdated(true);
    } catch (error) {
      setSubmitError(
        error instanceof AuthServiceError
          ? error.messageKey
          : "auth.errors.generic",
      );
    }
  });

  const passwordField = (
    field: "password" | "confirmPassword",
    visible: boolean,
    setVisible: (value: boolean) => void,
  ) => {
    const error = errors[field];
    const labelKey =
      field === "password"
        ? "register.fields.password"
        : "register.fields.confirmPassword";
    const errorId = `reset-${field}-error`;

    return (
      <div key={field}>
        <label
          className="text-sm font-medium text-slate-700 dark:text-slate-300"
          htmlFor={`reset-${field}`}
        >
          {t(labelKey)}
        </label>
        <div className="relative">
          <input
            autoComplete="new-password"
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pe-12 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
            id={`reset-${field}`}
            type={visible ? "text" : "password"}
            {...register(field)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            placeholder={t(
              field === "password"
                ? "register.placeholders.password"
                : "register.placeholders.confirmPassword",
            )}
          />
          <button
            aria-label={
              visible
                ? t("register.hidePassword")
                : t("register.showPassword")
            }
            className="absolute inset-y-2 end-2 inline-flex w-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand dark:text-slate-400 dark:hover:bg-slate-800"
            onClick={() => setVisible(!visible)}
            type="button"
          >
            {visible ? (
              <EyeOff aria-hidden="true" size={18} />
            ) : (
              <Eye aria-hidden="true" size={18} />
            )}
          </button>
        </div>
        {error && (
          <p
            className="mt-1.5 text-sm text-red-600 dark:text-red-400"
            id={errorId}
          >
            {t(error.message ?? "auth.errors.generic")}
          </p>
        )}
      </div>
    );
  };

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
            {t("resetPassword.title")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
            {t("resetPassword.description")}
          </p>

          {updated ? (
            <div className="mt-6" role="status">
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                {t("resetPassword.success")}
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
              aria-label={t("resetPassword.formLabel")}
              className="mt-7 space-y-5"
              noValidate
              onSubmit={(event) => {
                void onSubmit(event);
              }}
            >
              {passwordField("password", showPassword, setShowPassword)}
              {passwordField(
                "confirmPassword",
                showConfirmPassword,
                setShowConfirmPassword,
              )}

              {submitError && (
                <p
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                  role="alert"
                >
                  {t(submitError)}
                </p>
              )}

              {!isSupabaseConfigured && (
                <p className="text-sm text-amber-700 dark:text-amber-300" role="status">
                  {t("auth.errors.supabaseNotConfigured")}
                </p>
              )}

              <button
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand/90 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-slate-900"
                disabled={isSubmitting || !isSupabaseConfigured}
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
                  ? t("resetPassword.submitting")
                  : t("resetPassword.submit")}
              </button>
            </form>
          )}

          {!updated && (
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
