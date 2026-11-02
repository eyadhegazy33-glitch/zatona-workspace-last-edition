import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, LoaderCircle, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { z } from "zod";
import { useAuth } from "../hooks/useAuth";
import { createCustomerSchema } from "../lib/validationSchemas";
import {
  createCustomer,
  findCustomerByNameAndBirthDate,
  getActiveStudentTypes,
  getCustomer,
  getStudentTypeName,
  updateCustomer,
  type CustomerInput,
  type StudentType,
} from "../services/customers";

const inputClassName =
  "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

function customerErrorKey(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    if (cause.code === "23505") return "customers.errors.duplicate";
    if (cause.code === "42501") return "customers.errors.permission";
  }
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string" &&
    cause.message.toLowerCase().includes("not allowed")
  ) {
    return "customers.errors.permission";
  }
  return "customers.errors.save";
}

function asDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

export function CustomerFormPage() {
  const { i18n, t } = useTranslation();
  const { permissions } = useAuth();
  const navigate = useNavigate();
  const { customerId } = useParams();
  const isEdit = Boolean(customerId);
  const [studentTypes, setStudentTypes] = useState<StudentType[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);

  const schema = useMemo(() => createCustomerSchema(), []);

  type FormValues = z.infer<typeof schema>;
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: "",
      lastName: "",
      birthDate: "",
      studentTypeId: "",
      phone: "",
      expiryDate: "",
      notes: "",
    },
  });

  useEffect(() => {
    let mounted = true;
    void getActiveStudentTypes()
      .then((types) => {
        if (mounted) setStudentTypes(types);
      })
      .catch(() => {
        if (mounted) setErrorKey("customers.errors.studentTypes");
      })
      .finally(() => {
        if (mounted) setLoadingTypes(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!isEdit || !customerId) {
      setLoading(false);
      return () => {
        mounted = false;
      };
    }
    setLoading(true);
    void getCustomer(customerId)
      .then((customer) => {
        if (!mounted) return;
        if (!customer) {
          setErrorKey("customers.errors.notFound");
          return;
        }
        reset({
          firstName: customer.first_name,
          lastName: customer.last_name,
          birthDate: asDateInput(customer.birth_date),
          studentTypeId: customer.student_type_id,
          phone: customer.phone ?? "",
          expiryDate: asDateInput(customer.expires_on),
          notes: customer.notes ?? "",
        });
      })
      .catch(() => {
        if (mounted) setErrorKey("customers.errors.load");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [customerId, isEdit, reset]);

  const submit = async (values: FormValues) => {
    setErrorKey(null);
    setDuplicateId(null);
    const input: CustomerInput = {
      ...values,
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      phone: values.phone.trim(),
      notes: values.notes.trim(),
    };

    try {
      if (isEdit && customerId) {
        await updateCustomer(customerId, input);
        navigate(`/customers/${customerId}`, { replace: true });
      } else {
        const createdId = await createCustomer(input);
        navigate(`/customers/${createdId}`, { replace: true });
      }
    } catch (cause) {
      const mappedError = customerErrorKey(cause);
      setErrorKey(mappedError);
      if (mappedError === "customers.errors.duplicate" && permissions.includes("customers.view")) {
        try {
          const existing = await findCustomerByNameAndBirthDate({
            firstName: input.firstName,
            lastName: input.lastName,
            birthDate: input.birthDate,
          });
          if (existing && existing.id !== customerId) {
            setDuplicateId(existing.id);
          }
        } catch {
          setDuplicateId(null);
        }
      }
    }
  };

  const fieldError = (key: keyof FormValues) => {
    const message = errors[key]?.message;
    return typeof message === "string" ? t(message) : null;
  };
  const listHref = "/customers";

  if (loading) {
    return (
      <div className="grid min-h-64 place-items-center">
        <LoaderCircle
          aria-label={t("customers.loading")}
          className="animate-spin text-brand"
          size={24}
        />
      </div>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
        to={listHref}
      >
        <ArrowLeft aria-hidden="true" size={17} />
        {t("customers.actions.backToList")}
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-ink dark:text-white">
        {t(isEdit ? "customers.form.editTitle" : "customers.form.newTitle")}
      </h1>

      {errorKey && (
        <div
          className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          role="alert"
        >
          {t(errorKey)}
          {duplicateId && (
            <Link
              className="ms-2 font-semibold underline underline-offset-2"
              to={`/customers/${duplicateId}`}
            >
              {t("customers.actions.viewExisting")}
            </Link>
          )}
        </div>
      )}

      <form
        className="mt-6 space-y-5 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-7"
        noValidate
        onSubmit={(event) => void handleSubmit(submit)(event)}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("customers.fields.firstName")}
            <input
              aria-invalid={Boolean(errors.firstName)}
              className={inputClassName}
              autoComplete="given-name"
              {...register("firstName")}
            />
            {fieldError("firstName") && (
              <span className="mt-1 block text-xs text-red-600 dark:text-red-400">
                {fieldError("firstName")}
              </span>
            )}
          </label>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("customers.fields.lastName")}
            <input
              aria-invalid={Boolean(errors.lastName)}
              className={inputClassName}
              autoComplete="family-name"
              {...register("lastName")}
            />
            {fieldError("lastName") && (
              <span className="mt-1 block text-xs text-red-600 dark:text-red-400">
                {fieldError("lastName")}
              </span>
            )}
          </label>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("customers.fields.birthDate")}
            <input
              aria-invalid={Boolean(errors.birthDate)}
              className={inputClassName}
              max={new Date().toISOString().slice(0, 10)}
              type="date"
              {...register("birthDate")}
            />
            {fieldError("birthDate") && (
              <span className="mt-1 block text-xs text-red-600 dark:text-red-400">
                {fieldError("birthDate")}
              </span>
            )}
          </label>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("customers.fields.studentType")}
            <select
              aria-invalid={Boolean(errors.studentTypeId)}
              className={inputClassName}
              disabled={loadingTypes}
              {...register("studentTypeId")}
            >
              <option value="">
                {t(
                  loadingTypes
                    ? "customers.form.loadingStudentTypes"
                    : "customers.form.selectStudentType",
                )}
              </option>
              {studentTypes.map((studentType) => (
                <option key={studentType.id} value={studentType.id}>
                  {getStudentTypeName(studentType, i18n.language)}
                </option>
              ))}
            </select>
            {fieldError("studentTypeId") && (
              <span className="mt-1 block text-xs text-red-600 dark:text-red-400">
                {fieldError("studentTypeId")}
              </span>
            )}
          </label>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("customers.fields.phone")}
            <input
              aria-invalid={Boolean(errors.phone)}
              className={inputClassName}
              autoComplete="tel"
              dir="ltr"
              inputMode="tel"
              {...register("phone")}
            />
            {fieldError("phone") && (
              <span className="mt-1 block text-xs text-red-600 dark:text-red-400">
                {fieldError("phone")}
              </span>
            )}
          </label>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("customers.fields.expiry")}
            <input
              aria-invalid={Boolean(errors.expiryDate)}
              className={inputClassName}
              type="date"
              {...register("expiryDate")}
            />
            {fieldError("expiryDate") && (
              <span className="mt-1 block text-xs text-red-600 dark:text-red-400">
                {fieldError("expiryDate")}
              </span>
            )}
          </label>
        </div>

        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
          {t("customers.fields.notes")}
          <textarea
            aria-invalid={Boolean(errors.notes)}
            className={inputClassName}
            rows={4}
            {...register("notes")}
          />
          {fieldError("notes") && (
            <span className="mt-1 block text-xs text-red-600 dark:text-red-400">
              {fieldError("notes")}
            </span>
          )}
        </label>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 dark:border-slate-800 sm:flex-row sm:justify-end">
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
            to={listHref}
          >
            {t("customers.actions.cancel")}
          </Link>
          <button
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60"
            disabled={isSubmitting || loadingTypes}
            type="submit"
          >
            {isSubmitting ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" size={17} />
            ) : (
              <Save aria-hidden="true" size={17} />
            )}
            {t(isSubmitting ? "customers.actions.saving" : "customers.actions.save")}
          </button>
        </div>
      </form>
    </section>
  );
}
