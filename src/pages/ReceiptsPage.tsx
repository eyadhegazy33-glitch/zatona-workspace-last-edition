import { z } from "zod";
import {
  ArrowDown,
  ArrowUp,
  Download,
  LoaderCircle,
  Printer,
  ReceiptText,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ReceiptPrint } from "../components/ReceiptPrint";
import { useAuth } from "../hooks/useAuth";
import { addCalendarDays, formatCalendarDate, getDatePartsInTimeZone, startOfDateInTimeZone } from "../lib/zonedDate";
import { writeReceiptExport } from "../lib/sheetjs";
import {
  getReceiptDetail,
  listReceipts,
  voidReceipt,
  type ReceiptDetail,
  type ReceiptFilters,
  type ReceiptListItem,
  type ReceiptMethod,
  type ReceiptPage,
  type ReceiptSort,
  type ReceiptStatus,
} from "../services/receipts";
import { getReceiptDisplaySettings } from "../services/settings";

const PAGE_SIZE = 25;

const voidReasonSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

type Preset = "today" | "yesterday" | "7days" | "custom" | "all";

const initialFilters: ReceiptFilters = {
  search: "",
  from: null,
  to: null,
  method: null,
  status: null,
  minAmount: null,
  maxAmount: null,
  sort: "created_at",
  direction: "desc",
};

function dateBoundaries(preset: Preset, timeZone: string): Pick<ReceiptFilters, "from" | "to"> {
  if (preset === "all" || preset === "custom") return { from: null, to: null };
  const today = formatCalendarDate(getDatePartsInTimeZone(new Date(), timeZone));
  const from = preset === "yesterday"
    ? addCalendarDays(today, -1)
    : preset === "7days" ? addCalendarDays(today, -6) : today;
  const to = preset === "yesterday" ? today : addCalendarDays(today, 1);
  return {
    from: startOfDateInTimeZone(from, timeZone).toISOString(),
    to: startOfDateInTimeZone(to, timeZone).toISOString(),
  };
}

function parseAmount(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ReceiptsPage() {
  const { i18n, t } = useTranslation();
  const { permissions } = useAuth();
  const canVoid = permissions.includes("receipts.void");
  const [filters, setFilters] = useState<ReceiptFilters>(() => ({
    ...initialFilters,
    ...dateBoundaries("7days", "Africa/Cairo"),
  }));
  const [preset, setPreset] = useState<Preset>("7days");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ReceiptPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [printLayout, setPrintLayout] = useState<"thermal" | "a4">("thermal");
  const [receiptSettings, setReceiptSettings] = useState<Awaited<ReturnType<typeof getReceiptDisplaySettings>> | null>(null);
  const [voidTarget, setVoidTarget] = useState<ReceiptListItem | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState("");
  const [voidBusy, setVoidBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [exportTruncated, setExportTruncated] = useState(false);
  const [exportResultCount, setExportResultCount] = useState<number | null>(null);

  const loadReceipts = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const settings = await getReceiptDisplaySettings();
      const boundaries = dateBoundaries(preset, settings.timeZone);
      const activeFilters = preset === "all" || preset === "custom"
        ? filters
        : { ...filters, ...boundaries };
      if (preset !== "all" && preset !== "custom") {
        setFilters((current) => current.from === boundaries.from && current.to === boundaries.to
          ? current
          : { ...current, ...boundaries });
      }
      const result = await listReceipts(activeFilters, page * PAGE_SIZE, PAGE_SIZE);
      setData(result);
      setReceiptSettings(settings);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [filters, page, preset]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReceipts(), 250);
    return () => window.clearTimeout(timer);
  }, [loadReceipts]);

  const formatMoney = useCallback((amount: number) => {
    const currency = receiptSettings?.currencyCode ?? "EGP";
    return new Intl.NumberFormat(i18n.language.startsWith("ar") ? "ar-EG" : i18n.language, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }, [i18n.language, receiptSettings?.currencyCode]);

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(
    i18n.language.startsWith("ar") ? "ar-EG" : i18n.language,
    { dateStyle: "medium", timeStyle: "short", timeZone: receiptSettings?.timeZone },
  ), [i18n.language, receiptSettings?.timeZone]);

  const updateDatePreset = (next: Preset) => {
    setPreset(next);
    setPage(0);
    if (next === "custom") {
      setCustomFrom("");
      setCustomTo("");
      setFilters((current) => ({ ...current, from: null, to: null }));
    } else {
      setFilters((current) => ({ ...current, ...dateBoundaries(next, receiptSettings?.timeZone ?? "Africa/Cairo") }));
    }
  };

  const updateFilter = <K extends keyof ReceiptFilters>(key: K, value: ReceiptFilters[K]) => {
    setPage(0);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const openDetail = async (receiptId: string) => {
    setDetail(null);
    setDetailError(false);
    setDetailLoading(true);
    try {
      setDetail(await getReceiptDetail(receiptId));
    } catch {
      setDetailError(true);
    } finally {
      setDetailLoading(false);
    }
  };

  const printReceipt = () => {
    document.body.classList.add(
      "printing-payment-receipt",
      printLayout === "a4" ? "receipt-layout-a4" : "receipt-layout-thermal",
    );
    const cleanup = () => {
      document.body.classList.remove(
        "printing-payment-receipt",
        "receipt-layout-a4",
        "receipt-layout-thermal",
      );
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  };

  const submitVoid = async () => {
    if (!voidTarget || voidBusy) return;
    const parsed = voidReasonSchema.safeParse({ reason: voidReason });
    if (!parsed.success) {
      setVoidError("receiptsBrowser.errors.reason");
      return;
    }
    setVoidBusy(true);
    setVoidError("");
    try {
      await voidReceipt(voidTarget.id, parsed.data.reason);
      setVoidTarget(null);
      setVoidReason("");
      await loadReceipts();
      if (detail?.id === voidTarget.id) await openDetail(voidTarget.id);
    } catch {
      setVoidError("receiptsBrowser.errors.void");
    } finally {
      setVoidBusy(false);
    }
  };

  const exportReceipts = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    setExportError(false);
    setExportTruncated(false);
    setExportResultCount(null);
    try {
      const exportFilters = preset === "all" || preset === "custom"
        ? filters
        : {
            ...filters,
            ...dateBoundaries(
              preset,
              receiptSettings?.timeZone ?? "Africa/Cairo",
            ),
          };
      const result = await listReceipts(exportFilters, 0, 5000);
      if (result.total_count === 0) {
        setExportResultCount(0);
        return;
      }
      const headers = [
        t("receiptsBrowser.number"),
        t("receiptsBrowser.date"),
        t("receiptsBrowser.customer"),
        t("receiptsBrowser.employee"),
        t("receiptsBrowser.method"),
        t("receiptsBrowser.total"),
        t("receiptsBrowser.status"),
      ];
      const rows = result.rows.map((receipt) => [
        receipt.display_number,
        dateFormatter.format(new Date(receipt.created_at)),
        `${receipt.customer_name} (${receipt.customer_code})`,
        receipt.employee_name ?? "",
        t(`receiptsBrowser.methods.${receipt.method}`),
        receipt.total,
        t(`receiptsBrowser.statuses.${receipt.status}`),
      ]);
      writeReceiptExport(headers, rows);
      setExportTruncated(result.total_count > result.rows.length);
      setExportResultCount(result.rows.length);
    } catch {
      setExportError(true);
    } finally {
      setExportBusy(false);
    }
  };

  const changeSort = (sort: ReceiptSort) => {
    setPage(0);
    setFilters((current) => ({
      ...current,
      sort,
      direction: current.sort === sort && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const totalPages = Math.max(1, Math.ceil((data?.total_count ?? 0) / PAGE_SIZE));
  const displayedRows = data?.rows ?? [];
  const receiptDetailLines = detail?.lines.map((line) => ({
    kind: line.line_type,
    id: String(line.id),
    label: line.description,
    amount: line.amount,
  })) ?? [];

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <ReceiptText aria-hidden="true" className="mt-1 text-brand" size={28} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-ink dark:text-white">
              {t("receiptsBrowser.title")}
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {t("receiptsBrowser.description")}
            </p>
          </div>
        </div>
        <button
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 font-semibold disabled:opacity-60 dark:border-slate-700"
          disabled={exportBusy || loading}
          onClick={() => void exportReceipts()}
          type="button"
        >
          {exportBusy ? <LoaderCircle className="animate-spin" size={17} /> : <Download size={17} />}
          {t(exportBusy ? "receiptsBrowser.exporting" : "receiptsBrowser.export")}
        </button>
      </header>

      <section className="grid gap-3 sm:grid-cols-3" aria-label={t("receiptsBrowser.summary")}>
        <SummaryCard label={t("receiptsBrowser.paidCount")} value={data?.paid_count ?? 0} />
        <SummaryCard label={t("receiptsBrowser.paidTotal")} value={formatMoney(data?.paid_total ?? 0)} />
        <SummaryCard label={t("receiptsBrowser.voidedCount")} value={data?.voided_count ?? 0} />
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="relative block sm:col-span-2">
            <span className="sr-only">{t("receiptsBrowser.search")}</span>
            <Search aria-hidden="true" className="absolute start-3 top-3 text-slate-400" size={18} />
            <input
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white ps-10 pe-3 text-ink dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              onChange={(event) => updateFilter("search", event.target.value)}
              placeholder={t("receiptsBrowser.searchPlaceholder")}
              value={filters.search}
            />
          </label>
          <label className="block">
            <span className="sr-only">{t("receiptsBrowser.dateRange")}</span>
            <select
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              onChange={(event) => updateDatePreset(event.target.value as Preset)}
              value={preset}
            >
              {(["today", "yesterday", "7days", "custom", "all"] as const).map((range) => (
                <option key={range} value={range}>{t(`receiptsBrowser.datePresets.${range}`)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="sr-only">{t("receiptsBrowser.method")}</span>
            <select
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              onChange={(event) => updateFilter("method", event.target.value ? event.target.value as ReceiptMethod : null)}
              value={filters.method ?? ""}
            >
              <option value="">{t("receiptsBrowser.allMethods")}</option>
              {(["cash", "card", "wallet", "other"] as const).map((method) => (
                <option key={method} value={method}>{t(`receiptsBrowser.methods.${method}`)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="sr-only">{t("receiptsBrowser.status")}</span>
            <select
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              onChange={(event) => updateFilter("status", event.target.value ? event.target.value as ReceiptStatus : null)}
              value={filters.status ?? ""}
            >
              <option value="">{t("receiptsBrowser.allStatuses")}</option>
              {(["paid", "voided"] as const).map((status) => (
                <option key={status} value={status}>{t(`receiptsBrowser.statuses.${status}`)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">{t("receiptsBrowser.minAmount")}</span>
            <input
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              inputMode="decimal"
              min="0"
              onChange={(event) => updateFilter("minAmount", parseAmount(event.target.value))}
              type="number"
              value={filters.minAmount ?? ""}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">{t("receiptsBrowser.maxAmount")}</span>
            <input
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              inputMode="decimal"
              min="0"
              onChange={(event) => updateFilter("maxAmount", parseAmount(event.target.value))}
              type="number"
              value={filters.maxAmount ?? ""}
            />
          </label>
        </div>
        {preset === "custom" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">{t("receiptsBrowser.from")}</span>
              <input
                className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                max={customTo || undefined}
                onChange={(event) => {
                  setCustomFrom(event.target.value);
                  updateFilter("from", event.target.value
                    ? startOfDateInTimeZone(event.target.value, receiptSettings?.timeZone ?? "Africa/Cairo").toISOString()
                    : null);
                }}
                type="date"
                value={customFrom}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">{t("receiptsBrowser.to")}</span>
              <input
                className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                min={customFrom || undefined}
                onChange={(event) => {
                  setCustomTo(event.target.value);
                  if (event.target.value) {
                    const exclusiveEnd = startOfDateInTimeZone(
                      addCalendarDays(event.target.value, 1),
                      receiptSettings?.timeZone ?? "Africa/Cairo",
                    );
                    updateFilter("to", exclusiveEnd.toISOString());
                  } else {
                    updateFilter("to", null);
                  }
                }}
                type="date"
                value={customTo}
              />
            </label>
          </div>
        )}
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">
          <p>{t("receiptsBrowser.errors.load")}</p>
          <button className="mt-2 font-semibold underline" onClick={() => void loadReceipts()} type="button">{t("receiptsBrowser.retry")}</button>
        </div>
      )}
      {exportError && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">
          {t("receiptsBrowser.errors.export")}
        </p>
      )}
      {exportTruncated && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="status">
          {t("receiptsBrowser.exportLimit")}
        </p>
      )}
      {exportResultCount !== null && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" role="status">
          {exportResultCount === 0
            ? t("receiptsBrowser.noReceiptsToExport")
            : t("receiptsBrowser.exportSuccess", { count: exportResultCount })}
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[850px] text-start text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600 dark:bg-slate-950 dark:text-slate-300">
            <tr>
              <SortHeader label={t("receiptsBrowser.number")} sort="number" active={filters.sort} direction={filters.direction} onSort={changeSort} />
              <SortHeader label={t("receiptsBrowser.date")} sort="created_at" active={filters.sort} direction={filters.direction} onSort={changeSort} />
              <SortHeader label={t("receiptsBrowser.customer")} sort="customer" active={filters.sort} direction={filters.direction} onSort={changeSort} />
              <SortHeader label={t("receiptsBrowser.employee")} sort="employee" active={filters.sort} direction={filters.direction} onSort={changeSort} />
              <th className="px-4 py-3 text-start">{t("receiptsBrowser.method")}</th>
              <SortHeader label={t("receiptsBrowser.total")} sort="total" active={filters.sort} direction={filters.direction} onSort={changeSort} />
              <SortHeader label={t("receiptsBrowser.status")} sort="status" active={filters.sort} direction={filters.direction} onSort={changeSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {loading ? (
              <tr><td className="p-8 text-center" colSpan={7}><LoaderCircle aria-label={t("receiptsBrowser.loading")} className="mx-auto animate-spin text-brand" /></td></tr>
            ) : displayedRows.length === 0 ? (
              <tr><td className="p-8 text-center text-slate-500" colSpan={7}>{t("receiptsBrowser.empty")}</td></tr>
            ) : displayedRows.map((receipt) => (
              <tr className="text-ink dark:text-white" key={receipt.id}>
                <td className="px-4 py-3">
                  <button className="font-semibold text-brand hover:underline" onClick={() => void openDetail(receipt.id)} type="button">
                    {receipt.display_number}
                  </button>
                </td>
                <td className="whitespace-nowrap px-4 py-3">{dateFormatter.format(new Date(receipt.created_at))}</td>
                <td className="px-4 py-3">
                  <button className="text-start hover:underline" onClick={() => void openDetail(receipt.id)} type="button">
                    <span className="block font-semibold">{receipt.customer_name}</span>
                    <span className="text-xs text-slate-500">{receipt.customer_code}</span>
                  </button>
                </td>
                <td className="px-4 py-3">{receipt.employee_name || t("receiptsBrowser.unknownEmployee")}</td>
                <td className="px-4 py-3">{t(`receiptsBrowser.methods.${receipt.method}`)}</td>
                <td className="whitespace-nowrap px-4 py-3 font-semibold">{formatMoney(receipt.total)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${receipt.status === "paid" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"}`}>
                    {t(`receiptsBrowser.statuses.${receipt.status}`)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t("receiptsBrowser.pageCount", { current: Math.min(page + 1, totalPages), total: totalPages, count: data?.total_count ?? 0 })}
        </p>
        <div className="flex gap-2">
          <button className="min-h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:opacity-50 dark:border-slate-700" disabled={page === 0 || loading} onClick={() => setPage((current) => Math.max(0, current - 1))} type="button">
            {t("receiptsBrowser.previous")}
          </button>
          <button className="min-h-10 rounded-lg border border-slate-300 px-4 font-semibold disabled:opacity-50 dark:border-slate-700" disabled={page + 1 >= totalPages || loading} onClick={() => setPage((current) => current + 1)} type="button">
            {t("receiptsBrowser.next")}
          </button>
        </div>
      </footer>

      {(detail || detailLoading || detailError) && (
        <div className="fixed inset-0 z-[110] flex justify-end bg-slate-950/50">
          <aside aria-label={t("receiptsBrowser.detailTitle")} aria-modal="true" className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl dark:bg-slate-900 sm:p-6" role="dialog">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-2xl font-bold text-ink dark:text-white">{t("receiptsBrowser.detailTitle")}</h2>
              <button aria-label={t("receiptsBrowser.close")} className="grid size-10 shrink-0 place-items-center rounded-lg border border-slate-300 dark:border-slate-700" onClick={() => setDetail(null)} type="button"><X size={18} /></button>
            </div>
            {detailLoading ? <LoaderCircle className="mx-auto mt-10 animate-spin text-brand" /> : detailError || !detail ? (
              <p className="mt-5 text-red-700 dark:text-red-300" role="alert">{t("receiptsBrowser.errors.detail")}</p>
            ) : (
              <div className="mt-5 space-y-5">
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-lg font-bold text-ink dark:text-white">{detail.display_number}</p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{dateFormatter.format(new Date(detail.created_at))}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${detail.status === "paid" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"}`}>
                      {t(`receiptsBrowser.statuses.${detail.status}`)}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <DetailValue label={t("receiptsBrowser.customer")} value={`${detail.customer_name} (${detail.customer_code})`} />
                    <DetailValue label={t("receiptsBrowser.employee")} value={detail.employee_name || t("receiptsBrowser.unknownEmployee")} />
                    <DetailValue label={t("receiptsBrowser.method")} value={t(`receiptsBrowser.methods.${detail.method}`)} />
                      <DetailValue label={t("receiptsBrowser.amountReceived")} value={detail.method === "cash" ? formatMoney(detail.amount_received ?? detail.total) : t("receiptsBrowser.none")} />
                      {detail.method === "cash" && <DetailValue label={t("receiptsBrowser.change")} value={formatMoney(Math.max(0, (detail.amount_received ?? detail.total) - detail.total))} />}
                    </dl>
                </div>
                <section>
                  <h3 className="font-bold text-ink dark:text-white">{t("receiptsBrowser.lines")}</h3>
                  <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-800">
                    {detail.lines.map((line) => (
                      <li className="flex justify-between gap-3 py-3 text-sm" key={line.id}>
                        <span>{line.description}</span><strong className="whitespace-nowrap">{formatMoney(line.amount)}</strong>
                      </li>
                    ))}
                  </ul>
                  <div className="space-y-2 border-t border-slate-200 pt-3 text-sm dark:border-slate-800">
                    <DetailMoney label={t("receiptsBrowser.subtotal")} value={formatMoney(detail.subtotal)} />
                    <DetailMoney label={t("receiptsBrowser.discount")} value={formatMoney(detail.discount)} />
                    <DetailMoney label={t("receiptsBrowser.service")} value={formatMoney(detail.service_charge)} />
                    <DetailMoney label={t("receiptsBrowser.tax")} value={formatMoney(detail.tax)} />
                    <DetailMoney label={t("receiptsBrowser.total")} value={formatMoney(detail.total)} emphasized />
                  </div>
                </section>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <DetailValue label={t("receiptsBrowser.createdBy")} value={detail.employee_name || t("receiptsBrowser.unknownEmployee")} />
                  <DetailValue label={t("receiptsBrowser.note")} value={detail.note || t("receiptsBrowser.none")} />
                  {detail.status === "voided" && (
                    <>
                      <DetailValue label={t("receiptsBrowser.voidedBy")} value={detail.voided_by_name || t("receiptsBrowser.unknownEmployee")} />
                      <DetailValue label={t("receiptsBrowser.voidedAt")} value={detail.voided_at ? dateFormatter.format(new Date(detail.voided_at)) : t("receiptsBrowser.none")} />
                      <DetailValue label={t("receiptsBrowser.voidReason")} value={detail.void_reason || t("receiptsBrowser.none")} />
                    </>
                  )}
                  {detail.shift ? (
                    <>
                      <DetailValue label={t("receiptsBrowser.shiftId")} value={detail.shift.id} />
                      <DetailValue label={t("receiptsBrowser.shiftOpened")} value={dateFormatter.format(new Date(detail.shift.opened_at))} />
                      <DetailValue label={t("receiptsBrowser.shiftClosed")} value={detail.shift.closed_at ? dateFormatter.format(new Date(detail.shift.closed_at)) : t("receiptsBrowser.shiftOpen")} />
                      <DetailValue label={t("receiptsBrowser.shiftOpeningCash")} value={formatMoney(detail.shift.opening_cash)} />
                      <DetailValue label={t("receiptsBrowser.shiftClosingCash")} value={detail.shift.closing_cash === null ? t("receiptsBrowser.shiftOpen") : formatMoney(detail.shift.closing_cash)} />
                      {detail.shift.note && <DetailValue label={t("receiptsBrowser.shiftNote")} value={detail.shift.note} />}
                    </>
                  ) : <DetailValue label={t("receiptsBrowser.shift")} value={t("receiptsBrowser.noShift")} />}
                </dl>
                <label className="block text-sm font-semibold">
                  <span className="mb-1 block">{t("receiptsBrowser.printLayout")}</span>
                  <select className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setPrintLayout(event.target.value as "thermal" | "a4")} value={printLayout}>
                    <option value="thermal">{t("receiptsBrowser.thermal")}</option>
                    <option value="a4">{t("receiptsBrowser.a4")}</option>
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  <button className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white" onClick={printReceipt} type="button"><Printer size={17} />{t("receiptsBrowser.reprint")}</button>
                  {canVoid && detail.status === "paid" && (
                    <button className="min-h-11 rounded-xl border border-red-300 px-4 font-semibold text-red-700 dark:border-red-900 dark:text-red-300" onClick={() => { setVoidTarget(detail); setVoidReason(""); setVoidError(""); }} type="button">{t("receiptsBrowser.void")}</button>
                  )}
                </div>
                {receiptSettings && (
                  <ReceiptPrint
                    cashierName={detail.employee_name ?? ""}
                    customer={{ full_name: detail.customer_name, code: detail.customer_code }}
                    discount={detail.discount}
                    dir={i18n.dir()}
                    formatMoney={formatMoney}
                    issuedAt={detail.created_at}
                    layout={printLayout}
                    lines={receiptDetailLines}
                    number={detail.display_number}
                    receipt={detail}
                    receiptSettings={receiptSettings}
                    showScreenPreview={false}
                    service={detail.service_charge}
                    subtotal={detail.subtotal}
                    tax={detail.tax}
                  />
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      {voidTarget && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/60 p-4">
          <section aria-labelledby="receipt-void-title" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900" role="alertdialog">
            <h2 className="text-xl font-bold text-ink dark:text-white" id="receipt-void-title">{t("receiptsBrowser.voidTitle")}</h2>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{t("receiptsBrowser.voidExplanation", { number: voidTarget.display_number })}</p>
            <label className="mt-4 block text-sm font-semibold">
              <span className="mb-1 block">{t("receiptsBrowser.voidReason")}</span>
              <textarea className="min-h-24 w-full rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-950" maxLength={500} onChange={(event) => setVoidReason(event.target.value)} value={voidReason} />
            </label>
            {voidError && <p className="mt-3 text-sm text-red-700 dark:text-red-300" role="alert">{t(voidError)}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button className="min-h-11 rounded-xl border border-slate-300 px-4 font-semibold dark:border-slate-700" disabled={voidBusy} onClick={() => setVoidTarget(null)} type="button">{t("receiptsBrowser.cancel")}</button>
              <button className="min-h-11 rounded-xl bg-red-700 px-4 font-semibold text-white disabled:opacity-60" disabled={voidBusy} onClick={() => void submitVoid()} type="button">{t(voidBusy ? "receiptsBrowser.voiding" : "receiptsBrowser.confirmVoid")}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink dark:text-white">{value}</p>
    </div>
  );
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words font-semibold text-ink dark:text-white">{value}</dd></div>;
}

function DetailMoney({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return <p className={`flex justify-between gap-3 ${emphasized ? "text-base font-bold text-ink dark:text-white" : "text-slate-600 dark:text-slate-300"}`}><span>{label}</span><strong>{value}</strong></p>;
}

function SortHeader({
  label,
  sort,
  active,
  direction,
  onSort,
}: {
  label: string;
  sort: ReceiptSort;
  active: ReceiptSort;
  direction: "asc" | "desc";
  onSort: (sort: ReceiptSort) => void;
}) {
  const { t } = useTranslation();
  const Icon = active === sort ? direction === "asc" ? ArrowUp : ArrowDown : null;
  return (
    <th className="px-4 py-3 text-start">
      <button aria-label={t("receiptsBrowser.sortBy", { label })} className="inline-flex items-center gap-1 font-bold" onClick={() => onSort(sort)} type="button">
        {label}{Icon && <Icon aria-hidden="true" size={14} />}
      </button>
    </th>
  );
}
