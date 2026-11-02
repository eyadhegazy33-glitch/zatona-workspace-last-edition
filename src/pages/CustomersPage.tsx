import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Plus,
  Printer,
  Search,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import {
  getCustomers,
  getActiveStudentTypes,
  getStudentTypeName,
  type Customer,
  type CustomerSort,
  type CustomerStatus,
  type StudentType,
} from "../services/customers";

const pageSize = 25;
const inputClassName =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

function formatDate(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(
    new Date(`${value.slice(0, 10)}T12:00:00`),
  );
}

export function CustomersPage() {
  const { i18n, t } = useTranslation();
  const { permissions } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [studentTypes, setStudentTypes] = useState<StudentType[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [querySearch, setQuerySearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | "">("");
  const [studentTypeFilter, setStudentTypeFilter] = useState("");
  const [sort, setSort] = useState<CustomerSort>("created_at");
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [importInfoOpen, setImportInfoOpen] = useState(false);

  const canCreate = permissions.includes("customers.create");
  const canImport = permissions.includes("customers.import");
  const canPrint = permissions.includes("customers.cards");
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const dateLocale = i18n.language === "ar" ? "ar" : "en";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuerySearch(search.trim());
      setPage(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let mounted = true;
    void getActiveStudentTypes()
      .then((types) => {
        if (mounted) setStudentTypes(types);
      })
      .catch(() => {
        if (mounted) setLoadError(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await getCustomers({
        search: querySearch,
        status: statusFilter,
        studentTypeId: studentTypeFilter,
        sort,
        ascending,
        page,
        pageSize,
      });
      setCustomers(result.customers);
      setTotal(result.total);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [ascending, page, querySearch, sort, statusFilter, studentTypeFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const studentTypeNames = useMemo(
    () =>
      new Map(
        studentTypes.map((type) => [
          type.id,
          getStudentTypeName(type, i18n.language),
        ]),
      ),
    [i18n.language, studentTypes],
  );

  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink dark:text-white">
            {t("pages.customers.title")}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {t("pages.customers.description")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canImport && (
            <Link
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              to="/customers/import"
            >
              <Upload aria-hidden="true" size={16} />
              {t("customers.actions.import")}
            </Link>
          )}
          {canPrint && (
            <Link
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              to="/customers/cards/print"
            >
              <Printer aria-hidden="true" size={16} />
              {t("customers.actions.printCards")}
            </Link>
          )}
          {canCreate && (
            <Link
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-white hover:opacity-90"
              to="/customers/new"
            >
              <Plus aria-hidden="true" size={17} />
              {t("customers.actions.new")}
            </Link>
          )}
        </div>
      </div>

      {loadError && (
        <div
          className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          role="alert"
        >
          {t("customers.errors.load")}
          <button
            className="ms-3 font-semibold underline underline-offset-2"
            onClick={() => void refresh()}
            type="button"
          >
            {t("customers.actions.retry")}
          </button>
        </div>
      )}

      <div className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_12rem_14rem_12rem_auto]">
        <label className="relative">
          <span className="sr-only">{t("customers.filters.search")}</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400"
            size={17}
          />
          <input
            className={`${inputClassName} ps-10`}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("customers.filters.search")}
            type="search"
            value={search}
          />
        </label>
        <label>
          <span className="sr-only">{t("customers.filters.status")}</span>
          <select
            className={inputClassName}
            onChange={(event) => {
              setStatusFilter(event.target.value as CustomerStatus | "");
              setPage(0);
            }}
            value={statusFilter}
          >
            <option value="">{t("customers.filters.allStatuses")}</option>
            {(["active", "blocked", "expired"] as const).map((status) => (
              <option key={status} value={status}>
                {t(`customers.status.${status}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{t("customers.filters.studentType")}</span>
          <select
            className={inputClassName}
            onChange={(event) => {
              setStudentTypeFilter(event.target.value);
              setPage(0);
            }}
            value={studentTypeFilter}
          >
            <option value="">{t("customers.filters.allStudentTypes")}</option>
            {studentTypes.map((studentType) => (
              <option key={studentType.id} value={studentType.id}>
                {getStudentTypeName(studentType, i18n.language)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{t("customers.filters.sort")}</span>
          <select
            className={inputClassName}
            onChange={(event) => {
              setSort(event.target.value as CustomerSort);
              setPage(0);
            }}
            value={sort}
          >
            <option value="created_at">{t("customers.sort.created")}</option>
            <option value="first_name">{t("customers.sort.name")}</option>
            <option value="code">{t("customers.sort.code")}</option>
            <option value="expiry_date">{t("customers.sort.expiry")}</option>
          </select>
        </label>
        <button
          aria-label={t(
            ascending ? "customers.sort.descending" : "customers.sort.ascending",
          )}
          className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          onClick={() => {
            setAscending((value) => !value);
            setPage(0);
          }}
          type="button"
        >
          {t(ascending ? "customers.sort.ascending" : "customers.sort.descending")}
        </button>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-start text-sm dark:divide-slate-800">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold">{t("customers.fields.code")}</th>
                <th className="px-4 py-3 font-semibold">{t("customers.fields.name")}</th>
                <th className="px-4 py-3 font-semibold">{t("customers.fields.studentType")}</th>
                <th className="px-4 py-3 font-semibold">{t("customers.fields.phone")}</th>
                <th className="px-4 py-3 font-semibold">{t("customers.fields.status")}</th>
                <th className="px-4 py-3 font-semibold">{t("customers.fields.expiry")}</th>
                <th className="px-4 py-3 font-semibold">{t("customers.fields.created")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading && (
                <tr>
                  <td className="px-4 py-10 text-center text-slate-500" colSpan={7}>
                    <LoaderCircle
                      aria-label={t("customers.loading")}
                      className="mx-auto animate-spin"
                      size={20}
                    />
                  </td>
                </tr>
              )}
              {!loading &&
                customers.map((customer) => (
                  <tr className="text-slate-700 dark:text-slate-200" key={customer.id}>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                      <Link
                        className="font-semibold text-brand underline-offset-2 hover:underline"
                        to={`/customers/${customer.id}`}
                      >
                        {customer.code}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      <Link className="hover:underline" to={`/customers/${customer.id}`}>
                        {customer.full_name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {studentTypeNames.get(customer.student_type_id) ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3" dir="ltr">
                      {customer.phone || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          customer.status === "active"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            : customer.status === "blocked"
                              ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                              : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                        }`}
                      >
                        {t(`customers.status.${customer.status}`)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {customer.expires_on
                        ? formatDate(customer.expires_on, dateLocale)
                        : t("customers.values.noExpiry")}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatDate(customer.created_at, dateLocale)}
                    </td>
                  </tr>
                ))}
              {!loading && customers.length === 0 && (
                <tr>
                  <td className="px-4 py-12 text-center text-slate-500 dark:text-slate-400" colSpan={7}>
                    {t("customers.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t("customers.pagination.summary", { start, end, total })}
          </p>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t("customers.pagination.page", {
                current: page + 1,
                total: pageCount,
              })}
            </span>
            <button
              aria-label={t("customers.pagination.previous")}
              className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200"
              disabled={page === 0 || loading}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              type="button"
            >
              {i18n.dir() === "rtl" ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
            </button>
            <button
              aria-label={t("customers.pagination.next")}
              className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200"
              disabled={page + 1 >= pageCount || loading}
              onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
              type="button"
            >
              {i18n.dir() === "rtl" ? <ChevronLeft size={17} /> : <ChevronRight size={17} />}
            </button>
          </div>
        </div>
      </div>

      {importInfoOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setImportInfoOpen(false);
          }}
        >
          <section
            aria-labelledby="customer-import-title"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"
            role="dialog"
          >
            <h2
              className="text-lg font-semibold text-ink dark:text-white"
              id="customer-import-title"
            >
              {t("customers.import.title")}
            </h2>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              {t("customers.import.description")}
            </p>
            <button
              className="mt-5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
              onClick={() => setImportInfoOpen(false)}
              type="button"
            >
              {t("customers.actions.close")}
            </button>
          </section>
        </div>
      )}

    </section>
  );
}
