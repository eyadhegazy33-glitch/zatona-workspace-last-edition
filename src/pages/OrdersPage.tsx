import { AlertCircle, CalendarDays, ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import {
  cancelOrder,
  getOrderDetail,
  listOrders,
  type OrderDetail,
  type OrderStatus,
  type OrderSummary,
} from "../services/orders";

function localDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getErrorKey(cause: unknown): string {
  const message =
    cause && typeof cause === "object" && "message" in cause
      ? String(cause.message).toLowerCase()
      : "";
  if (message.includes("paid order cannot be cancelled")) {
    return "ordersList.errors.paidCannotCancel";
  }
  if (message.includes("not allowed")) return "ordersList.errors.permission";
  if (message.includes("cancellation reason")) return "ordersList.errors.reason";
  return "ordersList.errors.load";
}

const statuses: OrderStatus[] = [
  "open",
  "new",
  "preparing",
  "ready",
  "served",
  "paid",
  "cancelled",
  "voided",
];

export function OrdersPage() {
  const { i18n, t } = useTranslation();
  const { permissions } = useAuth();
  const location = useLocation();
  const routeState = location.state && typeof location.state === "object"
    ? location.state as { unpaidOnly?: unknown }
    : {};
  const startsWithUnpaidFilter = routeState.unpaidOnly === true;
  const today = useMemo(() => localDateValue(new Date()), []);
  const [from, setFrom] = useState(startsWithUnpaidFilter ? "" : today);
  const [to, setTo] = useState(startsWithUnpaidFilter ? "" : today);
  const [statusFilter, setStatusFilter] = useState("all");
  const [customerSearch, setCustomerSearch] = useState("");
  const [unpaidOnly, setUnpaidOnly] = useState(startsWithUnpaidFilter);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<OrderSummary | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);
  const canCancel = permissions.includes("orders.cancel") ||
    permissions.includes("orders.manage");
  const canCreateOrder = permissions.includes("orders.create") ||
    permissions.includes("orders.manage");
  const locale = i18n.language.startsWith("ar") ? "ar-EG" : i18n.language;

  const refresh = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      setOrders(await listOrders({
        from: from || null,
        to: to || null,
        status: statusFilter,
        search: customerSearch,
        unpaidOnly,
      }));
    } catch (cause) {
      setError(getErrorKey(cause));
    } finally {
      setLoading(false);
    }
  }, [customerSearch, from, statusFilter, to, unpaidOnly]);

  useEffect(() => {
    const timerId = window.setTimeout(() => void refresh(), 250);
    return () => window.clearTimeout(timerId);
  }, [refresh]);

  const openOrder = async (order: OrderSummary) => {
    setSelectedId((current) => current === order.id ? "" : order.id);
    if (selectedId === order.id) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetail(null);
    setError("");
    try {
      setDetail(await getOrderDetail(order.id));
    } catch (cause) {
      setError(getErrorKey(cause));
    } finally {
      setDetailLoading(false);
    }
  };

  const confirmCancel = async () => {
    const reason = cancelReason.trim();
    if (!cancelTarget || reason.length < 3 || busy) return;
    setBusy(true);
    setError("");
    try {
      await cancelOrder(cancelTarget.id, reason);
      setCancelTarget(null);
      setCancelReason("");
      setSelectedId("");
      setDetail(null);
      await refresh();
    } catch (cause) {
      setError(getErrorKey(cause));
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = (value: string) => {
    const valid = statuses.includes(value as OrderStatus) ? value : "open";
    return t(`ordersBoard.status.${valid}`);
  };

  const formatMoney = (amount: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" })
      .format(new Date(value));

  const errorMessage = error
    ? t(error)
    : "";

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-brand">{t("ordersList.eyebrow")}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink dark:text-white">{t("ordersList.title")}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreateOrder && (
            <Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90" to="/orders/new">
              {t("layout.navigation.newOrder")}
            </Link>
          )}
          <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800" to="/orders/board">
            {t("layout.navigation.ordersBoard")}
          </Link>
          <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800" to="/pos">
            {t("layout.navigation.pos")}
          </Link>
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={() => {
              setFrom(today);
              setTo(today);
            }}
            type="button"
          >
            <CalendarDays size={17} />
            {t("ordersList.today")}
          </button>
        </div>
      </header>

      {errorMessage && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert">
          <AlertCircle aria-hidden="true" className="mt-0.5 shrink-0" size={17} />
          <span>{errorMessage}</span>
        </div>
      )}

      <section aria-label={t("ordersList.filters")} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 xl:grid-cols-5">
        <label className="text-sm font-medium">
          <span className="mb-1 block">{t("ordersList.customerSearch")}</span>
          <span className="relative block">
            <Search aria-hidden="true" className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
            <input className="min-h-11 w-full rounded-xl border border-slate-300 bg-white py-2 ps-10 pe-3 text-ink dark:border-slate-700 dark:bg-slate-950 dark:text-white" onChange={(event) => setCustomerSearch(event.target.value)} placeholder={t("ordersList.searchPlaceholder")} value={customerSearch} />
          </span>
        </label>
        <details className="rounded-xl border border-slate-200 dark:border-slate-700 sm:col-span-2 xl:col-span-4">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t("ordersList.filters")}
          </summary>
          <div className="grid gap-3 border-t border-slate-200 p-3 dark:border-slate-700 sm:grid-cols-2 xl:grid-cols-4">
            <label className="text-sm font-medium">
              <span className="mb-1 block">{t("ordersList.from")}</span>
              <input className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-ink dark:border-slate-700 dark:bg-slate-950 dark:text-white" onChange={(event) => setFrom(event.target.value)} type="date" value={from} />
            </label>
            <label className="text-sm font-medium">
              <span className="mb-1 block">{t("ordersList.to")}</span>
              <input className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-ink dark:border-slate-700 dark:bg-slate-950 dark:text-white" onChange={(event) => setTo(event.target.value)} type="date" value={to} />
            </label>
            <label className="text-sm font-medium">
              <span className="mb-1 block">{t("ordersList.status")}</span>
              <select className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-ink dark:border-slate-700 dark:bg-slate-950 dark:text-white" onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
                <option value="all">{t("ordersList.allStatuses")}</option>
                {statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium dark:border-slate-700">
              <input checked={unpaidOnly} className="size-4 accent-brand" onChange={(event) => setUnpaidOnly(event.target.checked)} type="checkbox" />
              {t("ordersList.unpaidOnly")}
            </label>
          </div>
        </details>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="font-semibold text-ink dark:text-white">{t("ordersList.results")}</h2>
          <span aria-live="polite" className="text-sm text-slate-500">{orders.length}</span>
        </div>
        <div className="space-y-3 p-3 md:hidden">
          {orders.map((order) => (
            <article className="rounded-xl border border-slate-200 p-4 dark:border-slate-800" key={order.id}>
              <button
                aria-expanded={selectedId === order.id}
                className="w-full text-start"
                onClick={() => void openOrder(order)}
                type="button"
              >
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block font-bold text-ink dark:text-white">
                      {t("ordersBoard.orderNumber", { number: order.order_number })}
                    </span>
                    <span className="mt-1 block font-medium text-slate-700 dark:text-slate-200">{order.customer_name}</span>
                    <span className="block text-xs text-slate-500">{order.customer_code}</span>
                  </span>
                  <ChevronDown aria-hidden="true" className={`mt-1 shrink-0 transition ${selectedId === order.id ? "rotate-180" : ""}`} size={18} />
                </span>
                <span className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{statusLabel(order.status)}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${order.paid ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}>
                    {t(order.paid ? "ordersList.paid" : "ordersList.unpaid")}
                  </span>
                  <span className="ms-auto font-bold text-ink dark:text-white">{formatMoney(order.total, order.currency)}</span>
                </span>
                <span className="mt-2 block text-xs text-slate-500">{formatDate(order.created_at)}</span>
              </button>
            </article>
          ))}
          {!loading && orders.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">{t("ordersList.empty")}</p>
          )}
          {loading && <p className="py-8 text-center text-sm text-slate-500">{t("ordersList.loading")}</p>}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] border-collapse text-start text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 text-start">{t("ordersList.number")}</th>
                <th className="px-4 py-3 text-start">{t("ordersList.time")}</th>
                <th className="px-4 py-3 text-start">{t("ordersList.customer")}</th>
                <th className="px-4 py-3 text-start">{t("ordersList.status")}</th>
                <th className="px-4 py-3 text-start">{t("ordersList.payment")}</th>
                <th className="px-4 py-3 text-end">{t("ordersList.total")}</th>
                <th className="px-4 py-3"><span className="sr-only">{t("ordersList.details")}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {orders.map((order) => (
                <tr className="align-top" key={order.id}>
                  <td className="px-4 py-4 font-bold text-ink dark:text-white">{t("ordersBoard.orderNumber", { number: order.order_number })}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-slate-600 dark:text-slate-300">{formatDate(order.created_at)}</td>
                  <td className="px-4 py-4">
                    <p className="font-medium text-ink dark:text-white">{order.customer_name}</p>
                    <p className="text-xs text-slate-500">{order.customer_code}</p>
                  </td>
                  <td className="px-4 py-4">
                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{statusLabel(order.status)}</span>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${order.paid ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}>
                      {t(order.paid ? "ordersList.paid" : "ordersList.unpaid")}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-end font-semibold text-ink dark:text-white">{formatMoney(order.total, order.currency)}</td>
                  <td className="px-4 py-3">
                    <button aria-expanded={selectedId === order.id} aria-label={t("ordersList.openDetails", { number: order.order_number })} className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => void openOrder(order)} type="button">
                      {selectedId === order.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && orders.length === 0 && (
                <tr><td className="px-4 py-12 text-center text-slate-500" colSpan={7}>{t("ordersList.empty")}</td></tr>
              )}
              {loading && (
                <tr><td className="px-4 py-12 text-center text-slate-500" colSpan={7}>{t("ordersList.loading")}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {selectedId && (
          <section aria-label={t("ordersList.details")} className="border-t border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950 sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-ink dark:text-white">
                  {detail ? t("ordersBoard.orderNumber", { number: detail.order_number }) : t("ordersList.details")}
                </h2>
                {detail && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{detail.customer_name} · {detail.customer_code}</p>}
              </div>
              <button aria-label={t("ordersList.closeDetails")} className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800" onClick={() => { setSelectedId(""); setDetail(null); }} type="button"><X size={18} /></button>
            </div>
            {detailLoading ? (
              <p className="text-sm text-slate-500">{t("ordersList.loadingDetails")}</p>
            ) : detail ? (
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2 text-sm">
                    <span className="rounded-full bg-slate-200 px-3 py-1 font-semibold dark:bg-slate-800">{statusLabel(detail.status)}</span>
                    <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{formatMoney(detail.total, detail.currency)}</span>
                    {detail.receipt && <span className="rounded-full bg-sky-100 px-3 py-1 font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-300">{detail.receipt.receipt_no}</span>}
                  </div>
                  <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                    {detail.items.map((item, index) => (
                      <li className="flex flex-wrap items-start justify-between gap-2 p-3" key={`${item.name_en}-${index}`}>
                        <div>
                          <p className="font-semibold text-ink dark:text-white">{i18n.language.startsWith("ar") ? item.name_ar : item.name_en} × {item.quantity}</p>
                          {item.note && <p className="text-sm text-slate-500">{t("ordersBoard.note")}: {item.note}</p>}
                        </div>
                        <span className="text-sm tabular-nums text-slate-600 dark:text-slate-300">{formatMoney(item.line_total, detail.currency)}</span>
                      </li>
                    ))}
                  </ul>
                  {detail.note && <p className="rounded-xl bg-white p-3 text-sm dark:bg-slate-900"><strong>{t("ordersList.orderNote")}:</strong> {detail.note}</p>}
                  {detail.receipt && <p className="text-sm text-slate-600 dark:text-slate-300">{t("ordersList.receiptDetails", { method: t(`pos.payment.${detail.receipt.payment_method}`), time: formatDate(detail.receipt.issued_at) })}{detail.receipt.voided ? ` · ${t("ordersList.receiptVoided")}` : ""}</p>}
                  {canCancel && detail.status !== "cancelled" && detail.status !== "voided" && (
                    detail.paid ? (
                      <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                        <button className="min-h-11 rounded-xl border border-amber-500 px-4 py-2 font-semibold opacity-70" disabled type="button">{t("ordersList.cancelOrder")}</button>
                        <p className="font-semibold">{t("ordersList.paidCannotCancel")}</p>
                        <p>{t("ordersList.voidReceiptInstead")}</p>
                      </div>
                    ) : (
                      <button className="min-h-11 rounded-xl border border-red-300 px-4 py-2 font-semibold text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40" onClick={() => { setCancelTarget(detail); setCancelReason(""); }} type="button">{t("ordersList.cancelOrder")}</button>
                    )
                  )}
                </div>
                <div>
                  <h3 className="mb-3 font-semibold text-ink dark:text-white">{t("ordersList.history")}</h3>
                  {detail.history.length === 0 ? (
                    <p className="text-sm text-slate-500">{t("ordersList.noHistory")}</p>
                  ) : (
                    <ol className="space-y-3">
                      {detail.history.map((event, index) => (
                        <li className="border-s-2 border-brand ps-3" key={`${event.at}-${index}`}>
                          <p className="font-medium text-ink dark:text-white">{t(`ordersList.events.${event.action}`, { defaultValue: event.action })}</p>
                          <p className="text-xs text-slate-500">{formatDate(event.at)}{event.actor ? ` · ${event.actor}` : ""}</p>
                          {typeof event.details.reason === "string" && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t("ordersList.reason")}: {event.details.reason}</p>}
                          {typeof event.details.status === "string" && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{statusLabel(event.details.status)}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">{t("ordersList.detailsUnavailable")}</p>
            )}
          </section>
        )}
      </section>

      {cancelTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCancelTarget(null); }}>
          <section aria-labelledby="cancel-order-title" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900 sm:p-6" role="dialog">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-ink dark:text-white" id="cancel-order-title">{t("ordersList.cancelOrder")}</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t("ordersList.cancelConfirm", { number: cancelTarget.order_number })}</p>
              </div>
              <button aria-label={t("ordersList.closeDialog")} className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" disabled={busy} onClick={() => setCancelTarget(null)} type="button"><X size={18} /></button>
            </div>
            <label className="mt-4 block text-sm font-medium">
              <span className="mb-1 block">{t("ordersList.cancelReason")}</span>
              <textarea autoFocus className="min-h-28 w-full rounded-xl border border-slate-300 bg-white p-3 text-ink outline-none focus:border-brand dark:border-slate-700 dark:bg-slate-950 dark:text-white" maxLength={500} onChange={(event) => setCancelReason(event.target.value)} value={cancelReason} />
            </label>
            <div className="mt-5 flex justify-end gap-3">
              <button className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 font-semibold dark:border-slate-700" disabled={busy} onClick={() => setCancelTarget(null)} type="button">{t("ordersList.dismiss")}</button>
              <button className="min-h-11 rounded-xl bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={busy || cancelReason.trim().length < 3} onClick={() => void confirmCancel()} type="button">{busy ? t("ordersList.cancelling") : t("ordersList.confirmCancel")}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
