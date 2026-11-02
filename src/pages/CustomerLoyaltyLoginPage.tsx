import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, LockKeyhole, Sparkles } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import {
  customerLoyaltyLogin,
  storeCustomerLoyaltyToken,
} from "../services/customerLoyalty";

const loginSchema = z.object({
  customerCode: z.string().trim().min(1).max(40),
  phone: z.string().trim().min(6).max(40),
  pin: z.string().regex(/^[0-9]{6,12}$/),
});

type LoginValues = z.infer<typeof loginSchema>;

export function CustomerLoyaltyLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState(false);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { customerCode: "", phone: "", pin: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(false);
    try {
      const token = await customerLoyaltyLogin(values);
      storeCustomerLoyaltyToken(token);
      navigate("/customer/portal", { replace: true });
    } catch {
      setSubmitError(true);
    }
  });

  return (
    <section className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6 sm:py-12">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="bg-brand px-6 py-7 text-white sm:px-8">
          <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-white/15">
            <Sparkles aria-hidden="true" size={25} />
          </span>
          <h1 className="mt-4 text-2xl font-bold">{t("customerLoyalty.login.title")}</h1>
          <p className="mt-2 text-sm leading-6 text-white/85">
            {t("customerLoyalty.login.description")}
          </p>
        </div>

        <form
          aria-label={t("customerLoyalty.login.formLabel")}
          className="space-y-5 p-6 sm:p-8"
          noValidate
          onSubmit={(event) => void onSubmit(event)}
        >
          {submitError && (
            <p
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
              role="alert"
            >
              {t("customerLoyalty.login.invalid")}
            </p>
          )}
          <div>
            <label className="text-sm font-semibold" htmlFor="loyalty-code">
              {t("customerLoyalty.login.customerCode")}
            </label>
            <input
              autoComplete="username"
              className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 font-mono text-lg uppercase outline-none focus:border-brand dark:border-slate-700 dark:bg-slate-950"
              id="loyalty-code"
              {...register("customerCode")}
            />
            {errors.customerCode && (
              <p className="mt-1 text-sm text-red-600">
                {t("customerLoyalty.login.required")}
              </p>
            )}
          </div>
          <div>
            <label className="text-sm font-semibold" htmlFor="loyalty-phone">
              {t("customerLoyalty.login.phone")}
            </label>
            <input
              autoComplete="tel"
              className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-lg outline-none focus:border-brand dark:border-slate-700 dark:bg-slate-950"
              dir="ltr"
              id="loyalty-phone"
              inputMode="tel"
              {...register("phone")}
            />
            {errors.phone && (
              <p className="mt-1 text-sm text-red-600">
                {t("customerLoyalty.login.required")}
              </p>
            )}
          </div>
          <div>
            <label className="text-sm font-semibold" htmlFor="loyalty-pin">
              {t("customerLoyalty.login.pin")}
            </label>
            <div className="relative mt-2">
              <LockKeyhole
                aria-hidden="true"
                className="absolute start-4 top-1/2 -translate-y-1/2 text-slate-400"
                size={18}
              />
              <input
                autoComplete="current-password"
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white ps-11 pe-4 text-lg tracking-[0.3em] outline-none focus:border-brand dark:border-slate-700 dark:bg-slate-950"
                dir="ltr"
                id="loyalty-pin"
                inputMode="numeric"
                maxLength={12}
                type="password"
                {...register("pin")}
              />
            </div>
            {errors.pin && (
              <p className="mt-1 text-sm text-red-600">
                {t("customerLoyalty.login.pinHelp")}
              </p>
            )}
          </div>
          <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
            {t("customerLoyalty.login.privacy")}
          </p>
          <button
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting && <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />}
            {isSubmitting
              ? t("customerLoyalty.login.submitting")
              : t("customerLoyalty.login.submit")}
          </button>
          <div className="text-center text-sm text-slate-500 dark:text-slate-400">
            {t("customerLoyalty.login.employeeLink")}{" "}
            <Link className="font-semibold text-brand hover:underline" to="/login">
              {t("customerLoyalty.login.employeeLogin")}
            </Link>
          </div>
        </form>
      </div>
    </section>
  );
}
