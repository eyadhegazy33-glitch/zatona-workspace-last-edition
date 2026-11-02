import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { z } from "zod";
import { BrandingIdentity } from "../components/BrandingIdentity";
import { useAuth } from "../hooks/useAuth";
import { isSupabaseConfigured } from "../lib/supabase";
import { getRegistrableRoles, type RegistrableRole } from "../services/roles";
import { AuthServiceError } from "../services/auth";
import { registrationSchema } from "../lib/validationSchemas";

type RegistrationValues = z.infer<typeof registrationSchema>;

const inputClassName =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800";

const labelClassName = "text-sm font-medium text-slate-700 dark:text-slate-300";

export function RegisterPage() {
  const { signUp } = useAuth();
  const { i18n, t } = useTranslation();
  const BackIcon = i18n.dir() === "rtl" ? ArrowRight : ArrowLeft;
  const [roles, setRoles] = useState<RegistrableRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const submitStarted = useRef(false);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<RegistrationValues>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      phoneNumber: "",
      email: "",
      password: "",
      confirmPassword: "",
      requestedRoleId: "",
    },
  });

  useEffect(() => {
    let mounted = true;
    setRolesLoading(true);
    setRolesError(null);

    if (!isSupabaseConfigured) {
      setRoles([]);
      setRolesError("auth.errors.supabaseNotConfigured");
      setRolesLoading(false);
      return () => {
        mounted = false;
      };
    }

    void getRegistrableRoles()
      .then((registrableRoles) => {
        if (mounted) {
          setRoles(registrableRoles);
        }
      })
      .catch(() => {
        if (mounted) {
          setRolesError("register.errors.rolesUnavailable");
        }
      })
      .finally(() => {
        if (mounted) {
          setRolesLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [retryCount]);

  const onSubmit = handleSubmit(async (values) => {
    if (submitStarted.current) {
      return;
    }

    submitStarted.current = true;
    setSubmitError(null);

    try {
      await signUp({
        firstName: values.firstName,
        lastName: values.lastName,
        phoneNumber: values.phoneNumber,
        email: values.email,
        password: values.password,
        requestedRoleId: values.requestedRoleId,
      });
      setSubmitted(true);
    } catch (error) {
      const messageKey =
        error instanceof AuthServiceError
          ? error.messageKey
          : "auth.errors.generic";

      if (messageKey === "auth.errors.weakPassword") {
        setError("password", {
          type: "server",
          message: "auth.errors.weakPassword",
        });
      } else {
        setSubmitError(messageKey);
      }
    } finally {
      submitStarted.current = false;
    }
  });

  const registerField = register;

  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-7">
          <BrandingIdentity />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-9">
          {submitted ? (
            <div className="py-4" role="status">
              <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-white sm:text-3xl">
                {t("register.successTitle")}
              </h1>
              <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
                {t("register.successMessage")}
              </p>
              <Link
                className="mt-7 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-medium text-white transition hover:bg-brand/90 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                to="/login"
              >
                <BackIcon aria-hidden="true" size={16} />
                {t("register.backToLogin")}
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-7">
                <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-white sm:text-3xl">
                  {t("pages.register.title")}
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                  {t("pages.register.description")}
                </p>
              </div>

              <form
                aria-label={t("register.formLabel")}
                className="space-y-5"
                noValidate
                onSubmit={(event) => {
                  void onSubmit(event);
                }}
              >
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label className={labelClassName} htmlFor="firstName">
                      {t("register.fields.firstName")}
                    </label>
                    <input
                      autoComplete="given-name"
                      className={inputClassName}
                      id="firstName"
                      maxLength={50}
                      {...registerField("firstName")}
                      aria-invalid={Boolean(errors.firstName)}
                      aria-describedby={
                        errors.firstName ? "firstName-error" : undefined
                      }
                      placeholder={t("register.placeholders.firstName")}
                    />
                    {errors.firstName && (
                      <p className="mt-1.5 text-sm text-red-600 dark:text-red-400" id="firstName-error">
                        {t(errors.firstName.message ?? "auth.errors.generic")}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className={labelClassName} htmlFor="lastName">
                      {t("register.fields.lastName")}
                    </label>
                    <input
                      autoComplete="family-name"
                      className={inputClassName}
                      id="lastName"
                      maxLength={50}
                      {...registerField("lastName")}
                      aria-invalid={Boolean(errors.lastName)}
                      aria-describedby={
                        errors.lastName ? "lastName-error" : undefined
                      }
                      placeholder={t("register.placeholders.lastName")}
                    />
                    {errors.lastName && (
                      <p className="mt-1.5 text-sm text-red-600 dark:text-red-400" id="lastName-error">
                        {t(errors.lastName.message ?? "auth.errors.generic")}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label className={labelClassName} htmlFor="phoneNumber">
                    {t("register.fields.phoneNumber")}
                  </label>
                  <input
                    autoComplete="tel"
                    className={inputClassName}
                    dir="ltr"
                    id="phoneNumber"
                    inputMode="tel"
                    type="tel"
                    {...registerField("phoneNumber")}
                    aria-invalid={Boolean(errors.phoneNumber)}
                    aria-describedby={
                      errors.phoneNumber ? "phoneNumber-error" : undefined
                    }
                    placeholder={t("register.placeholders.phoneNumber")}
                  />
                  {errors.phoneNumber && (
                    <p
                      className="mt-1.5 text-sm text-red-600 dark:text-red-400"
                      id="phoneNumber-error"
                    >
                      {t(errors.phoneNumber.message ?? "auth.errors.generic")}
                    </p>
                  )}
                </div>

                <div>
                  <label className={labelClassName} htmlFor="email">
                    {t("register.fields.email")}
                  </label>
                  <input
                    autoComplete="email"
                    className={inputClassName}
                    id="email"
                    type="email"
                    {...registerField("email")}
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={errors.email ? "email-error" : undefined}
                    placeholder={t("register.placeholders.email")}
                  />
                  {errors.email && (
                    <p className="mt-1.5 text-sm text-red-600 dark:text-red-400" id="email-error">
                      {t(errors.email.message ?? "auth.errors.generic")}
                    </p>
                  )}
                </div>

                <div>
                  <label className={labelClassName} htmlFor="password">
                    {t("register.fields.password")}
                  </label>
                  <div className="relative">
                    <input
                      autoComplete="new-password"
                      className={`${inputClassName} pe-12`}
                      id="password"
                      type={showPassword ? "text" : "password"}
                      {...registerField("password")}
                      aria-invalid={Boolean(errors.password)}
                      aria-describedby={
                        errors.password ? "password-error" : "password-hint"
                      }
                      placeholder={t("register.placeholders.password")}
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
                  {errors.password ? (
                    <p className="mt-1.5 text-sm text-red-600 dark:text-red-400" id="password-error">
                      {t(errors.password.message ?? "auth.errors.generic")}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400" id="password-hint">
                      {t("register.passwordHint")}
                    </p>
                  )}
                </div>

                <div>
                  <label className={labelClassName} htmlFor="confirmPassword">
                    {t("register.fields.confirmPassword")}
                  </label>
                  <div className="relative">
                    <input
                      autoComplete="new-password"
                      className={`${inputClassName} pe-12`}
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      {...registerField("confirmPassword")}
                      aria-invalid={Boolean(errors.confirmPassword)}
                      aria-describedby={
                        errors.confirmPassword
                          ? "confirmPassword-error"
                          : undefined
                      }
                      placeholder={t("register.placeholders.confirmPassword")}
                    />
                    <button
                      aria-label={
                        showConfirmPassword
                          ? t("register.hidePassword")
                          : t("register.showPassword")
                      }
                      className="absolute inset-y-2 end-2 inline-flex w-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand dark:text-slate-400 dark:hover:bg-slate-800"
                      onClick={() =>
                        setShowConfirmPassword((visible) => !visible)
                      }
                      type="button"
                    >
                      {showConfirmPassword ? (
                        <EyeOff aria-hidden="true" size={18} />
                      ) : (
                        <Eye aria-hidden="true" size={18} />
                      )}
                    </button>
                  </div>
                  {errors.confirmPassword && (
                    <p className="mt-1.5 text-sm text-red-600 dark:text-red-400" id="confirmPassword-error">
                      {t(
                        errors.confirmPassword.message ?? "auth.errors.generic",
                      )}
                    </p>
                  )}
                </div>

                <div>
                  <label className={labelClassName} htmlFor="requestedRoleId">
                    {t("register.fields.role")}
                  </label>
                  <select
                    className={inputClassName}
                    disabled={rolesLoading || roles.length === 0}
                    id="requestedRoleId"
                    {...registerField("requestedRoleId")}
                    aria-invalid={Boolean(errors.requestedRoleId)}
                    aria-describedby={[
                      "role-note",
                      errors.requestedRoleId ? "role-error" : undefined,
                      rolesError ? "roles-error" : undefined,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <option value="">
                      {rolesLoading
                        ? t("register.rolesLoading")
                        : t("register.selectRole")}
                    </option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400" id="role-note">
                    {t("register.roleNote")}
                  </p>
                  {errors.requestedRoleId && (
                    <p className="mt-1.5 text-sm text-red-600 dark:text-red-400" id="role-error">
                      {t(
                        errors.requestedRoleId.message ?? "auth.errors.generic",
                      )}
                    </p>
                  )}
                  {rolesError && (
                    <div
                      className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-red-600 dark:text-red-400"
                      id="roles-error"
                      role="alert"
                    >
                      <span>{t(rolesError)}</span>
                      {isSupabaseConfigured && (
                        <button
                          className="font-medium underline underline-offset-2"
                          onClick={() => setRetryCount((count) => count + 1)}
                          type="button"
                        >
                          {t("register.retry")}
                        </button>
                      )}
                    </div>
                  )}
                  {!rolesLoading && !rolesError && roles.length === 0 && (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                      {t("register.noRoles")}
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
                    rolesLoading ||
                    roles.length === 0 ||
                    Boolean(rolesError)
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
                    ? t("register.submitting")
                    : t("register.submit")}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
                {t("register.haveAccount")}{" "}
                <Link
                  className="font-medium text-brand underline-offset-4 hover:underline dark:text-emerald-400"
                  to="/login"
                >
                  {t("register.backToLogin")}
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
