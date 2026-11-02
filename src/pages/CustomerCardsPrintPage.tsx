import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Printer, RefreshCw } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { CustomerCard, type CustomerCardDetails } from "../components/CustomerCard";
import { useAuth } from "../hooks/useAuth";
import { useBranding } from "../hooks/useBranding";
import { waitForPrintAssets } from "../lib/print";
import { getCustomerQrToken, reissueQrToken } from "../services/customers";
import {
  getCustomerCardRecords,
  getCustomerImportOptions,
  logCustomerCardPrint,
  type CustomerCardRecord,
  type CustomerImportOption,
} from "../services/customerCards";
import {
  getActiveStudentTypes,
  getStudentTypeName,
  type StudentType,
} from "../services/customers";

const customerPageSize = 50;
const maxSelectedCards = 500;

function splitIntoRows<T>(items: T[], rowSize: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += rowSize) {
    rows.push(items.slice(index, index + rowSize));
  }
  return rows;
}

function backSideOrder<T>(items: T[]): T[] {
  return splitIntoRows(items, 2).flatMap((row) => row.reverse());
}

function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export function CustomerCardsPrintPage() {
  const { i18n, t } = useTranslation();
  const { permissions } = useAuth();
  const { loading: brandingLoading } = useBranding();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [studentTypeId, setStudentTypeId] = useState("");
  const [createdToday, setCreatedToday] = useState(false);
  const [customers, setCustomers] = useState<CustomerCardRecord[]>([]);
  const [knownCustomers, setKnownCustomers] = useState<
    Record<string, CustomerCardRecord>
  >({});
  const [totalCustomers, setTotalCustomers] = useState(0);
  const [studentTypes, setStudentTypes] = useState<StudentType[]>([]);
  const [imports, setImports] = useState<CustomerImportOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [reissuingId, setReissuingId] = useState("");
  const [includeBack, setIncludeBack] = useState(false);
  const [error, setError] = useState("");
  const importId = searchParams.get("import") ?? "";
  const singleCustomerId = searchParams.get("customer") ?? "";
  const canManage = permissions.includes("customers.edit");
  const cardFilters = useMemo(
    () => ({
      search,
      studentTypeId,
      createdToday,
      importId,
      customerId: singleCustomerId || undefined,
    }),
    [createdToday, importId, search, singleCustomerId, studentTypeId],
  );

  const refreshCustomers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [page, types, importOptions] = await Promise.all([
        getCustomerCardRecords({
          ...cardFilters,
        }, { offset: 0, limit: customerPageSize }),
        getActiveStudentTypes(),
        getCustomerImportOptions(),
      ]);
      setCustomers(page.records);
      setTotalCustomers(page.total);
      setKnownCustomers((current) => ({
        ...current,
        ...Object.fromEntries(page.records.map((customer) => [customer.id, customer])),
      }));
      setStudentTypes(types);
      setImports(importOptions);
      if (singleCustomerId) {
        setSelectedIds(
          page.records.some((customer) => customer.id === singleCustomerId)
            ? [singleCustomerId]
            : [],
        );
      }
    } catch {
      setError(t("customerCards.errors.load"));
    } finally {
      setLoading(false);
    }
  }, [cardFilters, singleCustomerId, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshCustomers(), 250);
    return () => window.clearTimeout(timer);
  }, [refreshCustomers]);

  const selectedCustomers = useMemo(
    () => selectedIds.flatMap((id) => (knownCustomers[id] ? [knownCustomers[id]] : [])),
    [knownCustomers, selectedIds],
  );

  useEffect(() => {
    let cancelled = false;
    const missing = selectedCustomers.filter((customer) => !tokens[customer.id]);

    if (!missing.length) {
      setLoadingTokens(false);
      return () => {
        cancelled = true;
      };
    }

    setLoadingTokens(true);
    setError("");
    void (async () => {
      try {
        const nextTokens: Record<string, string> = {};
        for (let index = 0; index < missing.length; index += 10) {
          const batch = missing.slice(index, index + 10);
          const values = await Promise.all(
            batch.map(async (customer) => [
              customer.id,
              await getCustomerQrToken(customer.id),
            ] as const),
          );
          for (const [id, token] of values) nextTokens[id] = token;
        }
        if (!cancelled) setTokens((current) => ({ ...current, ...nextTokens }));
      } catch {
        if (!cancelled) setError(t("customerCards.errors.load"));
      } finally {
        if (!cancelled) setLoadingTokens(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedCustomers, t, tokens]);

  const cardById = useMemo(() => {
    const entries = selectedCustomers.flatMap((customer) => {
      const token = tokens[customer.id];
      if (!token) return [];
      const studentType = customer.student_type
        ? getStudentTypeName(customer.student_type, i18n.language)
        : "";
      const card: CustomerCardDetails = {
        fullName: customer.full_name,
        studentType: studentType ?? "",
        birthDate: formatDate(customer.birth_date),
        code: customer.code,
        qrToken: token,
      };
      return [[customer.id, card] as const];
    });
    return new Map(entries);
  }, [i18n.language, selectedCustomers, tokens]);
  const printPages = useMemo(
    () =>
      selectedCustomers
        .filter((customer) => cardById.has(customer.id))
        .map((customer) => [customer]),
    [cardById, selectedCustomers],
  );

  const toggleCustomer = (customerId: string) => {
    if (
      !selectedIds.includes(customerId) &&
      selectedIds.length >= maxSelectedCards
    ) {
      setError(t("customerCards.errors.maxSelected"));
      return;
    }
    setSelectedIds((current) =>
      current.includes(customerId)
        ? current.filter((id) => id !== customerId)
        : [...current, customerId],
    );
  };

  const selectAllFiltered = async () => {
    setError("");
    try {
      const page = await getCustomerCardRecords(cardFilters, {
        offset: 0,
        limit: 500,
      });
      setKnownCustomers((current) => ({
        ...current,
        ...Object.fromEntries(page.records.map((customer) => [customer.id, customer])),
      }));
      const mergedIds = [
        ...new Set([...selectedIds, ...page.records.map((customer) => customer.id)]),
      ];
      if (mergedIds.length > maxSelectedCards) {
        setError(t("customerCards.errors.maxSelected"));
        return;
      }
      setSelectedIds(mergedIds);
    } catch {
      setError(t("customerCards.errors.load"));
    }
  };

  const loadMoreCustomers = async () => {
    if (loading || customers.length >= totalCustomers) return;
    setLoading(true);
    setError("");
    try {
      const page = await getCustomerCardRecords(cardFilters, {
        offset: customers.length,
        limit: customerPageSize,
      });
      setCustomers((current) => [...current, ...page.records]);
      setKnownCustomers((current) => ({
        ...current,
        ...Object.fromEntries(page.records.map((customer) => [customer.id, customer])),
      }));
    } catch {
      setError(t("customerCards.errors.load"));
    } finally {
      setLoading(false);
    }
  };

  const printCards = async () => {
    if (printing || !cardById.size || loadingTokens || brandingLoading) return;
    setPrinting(true);
    setError("");
    try {
      const printRoot = document.getElementById("customer-print-pages");
      if (!printRoot) {
        setError(t("customerCards.errors.qr"));
        return;
      }
      await waitForPrintAssets(printRoot);
      const printedCount = cardById.size;
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() =>
          window.requestAnimationFrame(() => resolve()),
        ),
      );
      window.print();
      window.setTimeout(() => {
        void (async () => {
          try {
            await logCustomerCardPrint(printedCount);
          } catch {
            setError(t("customerCards.errors.print"));
          }
        })();
      }, 0);
    } catch {
      setError(t("customerCards.errors.print"));
    } finally {
      setPrinting(false);
    }
  };

  const reissueCustomerQr = async (customerId: string) => {
    if (reissuingId) return;
    setReissuingId(customerId);
    setError("");
    try {
      const token = await reissueQrToken(customerId);
      setTokens((current) => ({ ...current, [customerId]: token }));
    } catch {
      setError(t("customerCards.errors.reissue"));
    } finally {
      setReissuingId("");
    }
  };

  const changeImport = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("import", value);
    else next.delete("import");
    setSearchParams(next);
  };

  return (
    <div className="customer-card-print-root mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6">
      <div className="customer-card-screen-controls">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink dark:text-white">
              {t("customerCards.title")}
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {t("customerCards.description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
              to="/customers"
            >
              {t("customerCards.backToCustomers")}
            </Link>
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-[rgb(var(--color-primary))] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={
                !cardById.size || loadingTokens || brandingLoading || printing
              }
              onClick={() => void printCards()}
              type="button"
            >
              <Printer aria-hidden="true" size={17} />
              {printing ? t("customerCards.printing") : t("customerCards.print")}
            </button>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">{t("customerCards.chooseCustomers")}</h2>
              <button
                className="text-sm font-medium text-[rgb(var(--color-primary))] disabled:opacity-50"
                disabled={loading || customers.length === 0 || totalCustomers === 0}
                onClick={() => void selectAllFiltered()}
                type="button"
              >
                {t("customerCards.selectAll", { count: Math.min(totalCustomers, 500) })}
              </button>
            </div>
            <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
              <label className="grid min-w-0 gap-1 text-sm">
                <span>{t("customerCards.search")}</span>
                <input
                  className="min-w-0 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("customerCards.searchPlaceholder")}
                  value={search}
                />
              </label>
              <label className="grid min-w-0 gap-1 text-sm">
                <span>{t("customerCards.studentType")}</span>
                <select
                  className="min-w-0 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700"
                  onChange={(event) => setStudentTypeId(event.target.value)}
                  value={studentTypeId}
                >
                  <option value="">{t("customerCards.allStudentTypes")}</option>
                  {studentTypes.map((studentType) => (
                    <option key={studentType.id} value={studentType.id}>
                      {getStudentTypeName(studentType, i18n.language)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid min-w-0 gap-1 text-sm md:col-span-2">
                <span>{t("customerCards.import")}</span>
                <select
                  className="min-w-0 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700"
                  onChange={(event) => changeImport(event.target.value)}
                  value={importId}
                >
                  <option value="">{t("customerCards.allImports")}</option>
                  {imports.map((item) => (
                    <option key={item.id} value={item.id}>
                      {formatDate(item.created_at.slice(0, 10))} ·{" "}
                      {item.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 items-center gap-2 text-sm md:col-span-2">
                <input
                  checked={createdToday}
                  onChange={(event) => setCreatedToday(event.target.checked)}
                  type="checkbox"
                />
                {t("customerCards.createdToday")}
              </label>
            </div>

            {error && (
              <p
                className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
                role="alert"
              >
                {error}
              </p>
            )}
            <div
              aria-busy={loading}
              className="mt-4 max-h-[28rem] space-y-2 overflow-y-auto"
            >
              {loading ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  {t("customerCards.loading")}
                </p>
              ) : customers.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  {t("customerCards.empty")}
                </p>
              ) : (
                customers.map((customer) => (
                  <label
                    className="flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800"
                    data-testid="customer-card-selection-row"
                    key={customer.id}
                  >
                    <input
                      checked={selectedIds.includes(customer.id)}
                      disabled={
                        !selectedIds.includes(customer.id) &&
                        selectedIds.length >= maxSelectedCards
                      }
                      onChange={() => toggleCustomer(customer.id)}
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {customer.full_name}
                      </span>
                      <span className="mt-1 block font-mono text-xs text-slate-500">
                        {customer.code}
                      </span>
                    </span>
                    {canManage && selectedIds.includes(customer.id) && (
                      <button
                        aria-label={t("customerCards.reissueFor", {
                          code: customer.code,
                        })}
                        className="inline-flex items-center gap-1 rounded-md p-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
                        disabled={Boolean(reissuingId)}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void reissueCustomerQr(customer.id);
                        }}
                        type="button"
                      >
                        <RefreshCw
                          aria-hidden="true"
                          className={
                            reissuingId === customer.id ? "animate-spin" : ""
                          }
                          size={14}
                        />
                        <span className="sr-only">
                          {t("customerCards.reissue")}
                        </span>
                      </button>
                    )}
                  </label>
                ))
              )}
            </div>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {t("customerCards.selectedCount", { count: selectedIds.length })}
            </p>
            {!loading && customers.length < totalCustomers && (
              <button
                className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50 dark:border-slate-700"
                disabled={loading}
                onClick={() => void loadMoreCustomers()}
                type="button"
              >
                {t("customerCards.loadMore", {
                  loaded: customers.length,
                  total: totalCustomers,
                })}
              </button>
            )}
          </section>

          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">{t("customerCards.preview")}</h2>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={includeBack}
                  onChange={(event) => setIncludeBack(event.target.checked)}
                  type="checkbox"
                />
                {t("customerCards.printBacks")}
              </label>
            </div>
            {loadingTokens && (
              <p className="mt-3 text-sm text-slate-500" role="status">
                {t("customerCards.loadingQr")}
              </p>
            )}
            {!selectedCustomers.length && !loading && (
              <p className="mt-8 text-center text-sm text-slate-500">
                {t("customerCards.noSelection")}
              </p>
            )}
            <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,21rem),1fr))] gap-4">
              {selectedCustomers.map((customer) => {
                const card = cardById.get(customer.id);
                if (!card) return null;
                return (
                  <div className="min-w-0" key={customer.id}>
                    <CustomerCard customer={card} />
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {customer.full_name}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
      {createPortal(
        <div className="customer-print-pages" id="customer-print-pages">
          {printPages.map((page, index) => (
            <Fragment key={`page-${index}`}>
              <div className="customer-print-sheet">
                <div className="customer-print-grid">
                  {page.map((customer) => {
                    const card = cardById.get(customer.id);
                    return card ? (
                      <CustomerCard
                        customer={card}
                        key={`front-${customer.id}`}
                      />
                    ) : null;
                  })}
                </div>
              </div>
              {includeBack && (
                <div className="customer-print-sheet">
                  <div className="customer-print-grid">
                    {backSideOrder(page).map((customer) => {
                      const card = cardById.get(customer.id);
                      return card ? (
                        <CustomerCard
                          customer={card}
                          face="back"
                          key={`back-${customer.id}`}
                        />
                      ) : null;
                    })}
                  </div>
                </div>
              )}
            </Fragment>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
