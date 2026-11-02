import { z } from "zod";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, CheckCircle2, LoaderCircle, Printer, X } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import {
  collectCustomerPayment,
  getCustomerPaymentContext,
  listCustomerPaymentItems,
  waiveCustomerFee,
  type CustomerPaymentMethod,
  type CustomerPaymentReceipt,
  type DueCustomerFee,
  type PaymentCustomer,
  type UnpaidOrder,
} from "../services/customerPayments";
import { getReceiptDisplaySettings, type ReceiptDisplaySettings } from "../services/settings";
import { CheckoutDialog } from "../components/CheckoutDialog";
import { ReceiptPrint } from "../components/ReceiptPrint";
import type { CheckoutTicket } from "../services/pointOfSale";

type PaymentLine =
  | { kind: "order"; id: string; label: string; amount: number }
  | { kind: "fee"; id: string; label: string; amount: number };

type Props = {
  customerId: string;
  onClose?: () => void;
};

const paymentSchema = z.object({
  orderIds: z.array(z.string().uuid()),
  feeIds: z.array(z.string().uuid()),
  method: z.enum(["cash", "card", "wallet", "other"]),
  amountReceived: z.number().finite().min(0).max(99_999_999.99).nullable(),
  note: z.string().max(300),
}).superRefine((value, context) => {
  if (value.orderIds.length + value.feeIds.length === 0) {
    context.addIssue({ code: "custom", path: ["orderIds"], message: "noItems" });
  }
  if (value.method === "cash" && value.amountReceived === null) {
    context.addIssue({ code: "custom", path: ["amountReceived"], message: "cashAmount" });
  }
});

const waiveSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

function paymentErrorKey(cause: unknown): string {
  const message =
    cause && typeof cause === "object" && "message" in cause
      ? String(cause.message).toLowerCase()
      : cause instanceof Error
        ? cause.message.toLowerCase()
        : "";
  if (message.includes("not payable") || message.includes("already paid")) {
    return "customerCheckout.errors.itemsChanged";
  }
  if (message.includes("open a shift") || message.includes("shift required")) {
    return "customerCheckout.errors.openShift";
  }
  if (message.includes("not allowed")) return "customerCheckout.errors.permission";
  if (message.includes("reason required")) return "customerCheckout.errors.reasonRequired";
  if (message.includes("fee not found") || message.includes("not due")) {
    return "customerCheckout.errors.feeChanged";
  }
  if (message.includes("amount received is less")) return "customerCheckout.errors.cashAmount";
  if (message.includes("nothing to pay")) return "customerCheckout.errors.noItems";
  return "customerCheckout.errors.payment";
}

function formatCurrency(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function CustomerCheckoutPage() {
  const { customerId = "" } = useParams();
  return <CustomerCheckoutPanel customerId={customerId} />;
}

export function CustomerPaymentDialog({
  customerId,
  onClose,
}: {
  customerId: string;
  onClose: () => void;
}) {
  return <CustomerCheckoutPanel customerId={customerId} onClose={onClose} />;
}

function CustomerCheckoutPanel({ customerId, onClose }: Props) {
  const { i18n, t } = useTranslation();
  const { permissions, profile } = useAuth();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<PaymentCustomer | null>(null);
  const [orders, setOrders] = useState<UnpaidOrder[]>([]);
  const [fees, setFees] = useState<DueCustomerFee[]>([]);
  const [receiptSettings, setReceiptSettings] = useState<ReceiptDisplaySettings | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [selectedFees, setSelectedFees] = useState<Set<string>>(new Set());
  const [paymentMethod, setPaymentMethod] = useState<CustomerPaymentMethod>("cash");
  const [amountReceived, setAmountReceived] = useState("0.00");
  const [note, setNote] = useState("");
  const [receipt, setReceipt] = useState<CustomerPaymentReceipt | null>(null);
  const [paidLines, setPaidLines] = useState<PaymentLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [loadingAction, setLoadingAction] = useState(false);
  const [waiveId, setWaiveId] = useState<string | null>(null);
  const [waiveReason, setWaiveReason] = useState("");
  const [waiveError, setWaiveError] = useState("");
  const [waiveBusy, setWaiveBusy] = useState(false);
  const [checkinId, setCheckinId] = useState<number | null>(null);
  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [checkoutDone, setCheckoutDone] = useState(false);
  const [printLayout, setPrintLayout] = useState<"thermal" | "a4">("thermal");
  const selectionInitialized = useRef(false);
  const knownOrderIds = useRef(new Set<string>());
  const knownFeeIds = useRef(new Set<string>());
  const previousTotal = useRef(0);
  const canWaive = permissions.includes("fees.waive");
  const canCheckout =
    permissions.includes("checkins.manage") && permissions.includes("orders.manage");
  const canCreateOrder =
    permissions.includes("orders.create") || permissions.includes("orders.manage");
  const locale = i18n.language.startsWith("ar") ? "ar-EG" : i18n.language;

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [customerResult, itemsResult, receiptSettingsResult] = await Promise.all([
        getCustomerPaymentContext(customerId),
        listCustomerPaymentItems(customerId),
        getReceiptDisplaySettings(),
      ]);
      setCustomer(customerResult);
      setCheckinId(customerResult.checkin_id);
      setOrders(itemsResult.orders);
      setFees(itemsResult.fees);
      setReceiptSettings(receiptSettingsResult);
      if (!selectionInitialized.current) {
        setSelectedOrders(new Set(itemsResult.orders.map((order) => order.id)));
        setSelectedFees(new Set(itemsResult.fees.map((fee) => fee.id)));
        selectionInitialized.current = true;
      } else {
        setSelectedOrders((current) =>
          new Set(itemsResult.orders
            .filter((order) => current.has(order.id) || !knownOrderIds.current.has(order.id))
            .map((order) => order.id)),
        );
        setSelectedFees((current) =>
          new Set(itemsResult.fees
            .filter((fee) => current.has(fee.id) || !knownFeeIds.current.has(fee.id))
            .map((fee) => fee.id)),
        );
      }
      knownOrderIds.current = new Set(itemsResult.orders.map((order) => order.id));
      knownFeeIds.current = new Set(itemsResult.fees.map((fee) => fee.id));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const total = useMemo(
    () =>
      orders.reduce(
        (sum, order) => sum + (selectedOrders.has(order.id) ? order.total : 0),
        0,
      ) +
      fees.reduce(
        (sum, fee) => sum + (selectedFees.has(fee.id) ? fee.amount : 0),
        0,
      ),
    [fees, orders, selectedFees, selectedOrders],
  );
  const selectedOrderRows = useMemo(
    () => orders.filter((order) => selectedOrders.has(order.id)),
    [orders, selectedOrders],
  );
  const selectedFeeRows = useMemo(
    () => fees.filter((fee) => selectedFees.has(fee.id)),
    [fees, selectedFees],
  );

  useEffect(() => {
    if (paymentMethod !== "cash") return;
    setAmountReceived((current) =>
      current === "" || Number(current) === previousTotal.current
        ? total.toFixed(2)
        : current,
    );
    previousTotal.current = total;
  }, [paymentMethod, total]);

  const toggleOrder = (orderId: string) => {
    setSelectedOrders((current) => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };
  const toggleFee = (feeId: string) => {
    setSelectedFees((current) => {
      const next = new Set(current);
      if (next.has(feeId)) next.delete(feeId);
      else next.add(feeId);
      return next;
    });
  };

  const submitPayment = async () => {
    if (loadingAction || !receiptSettings) return;
    setPaymentError("");
    const parsedAmount = paymentMethod === "cash" && amountReceived.trim()
      ? Number(amountReceived)
      : null;
    const parsed = paymentSchema.safeParse({
      orderIds: [...selectedOrders],
      feeIds: [...selectedFees],
      method: paymentMethod,
      amountReceived: parsedAmount,
      note,
    });
    if (!parsed.success) {
      setPaymentError(
        parsed.error.issues[0]?.message === "cashAmount"
          ? "customerCheckout.errors.cashAmount"
          : parsed.error.issues[0]?.message === "noItems"
            ? "customerCheckout.errors.noItems"
            : "customerCheckout.errors.payment",
      );
      return;
    }
    if (paymentMethod === "cash" && parsedAmount !== null && parsedAmount < total) {
      setPaymentError("customerCheckout.errors.cashAmount");
      return;
    }

    setLoadingAction(true);
    try {
      const lines: PaymentLine[] = [
        ...selectedOrderRows.map((order) => ({
          kind: "order" as const,
          id: order.id,
          label: `${t("customerCheckout.orderNumber", { number: order.number })} · ${order.description}`,
          amount: order.total,
        })),
        ...selectedFeeRows.map((fee) => ({
          kind: "fee" as const,
          id: fee.id,
          label: t("customerCheckout.overdueFee", { block: fee.block_number }),
          amount: fee.amount,
        })),
      ];
      const result = await collectCustomerPayment({
        customerId,
        orderIds: parsed.data.orderIds,
        feeIds: parsed.data.feeIds,
        method: parsed.data.method,
        amountReceived: parsedAmount,
        note: parsed.data.note,
      });
      setReceipt(result);
      setPaidLines(lines);
      setCheckoutDone(false);
      setPaymentError("");
    } catch (cause) {
      const key = paymentErrorKey(cause);
      setPaymentError(key);
      if (key === "customerCheckout.errors.itemsChanged") {
        try {
          await loadData();
        } catch {
          setLoadError(true);
        }
      }
    } finally {
      setLoadingAction(false);
    }
  };

  const submitWaiver = async () => {
    if (!waiveId || waiveBusy) return;
    const parsed = waiveSchema.safeParse({ reason: waiveReason });
    if (!parsed.success) {
      setWaiveError("customerCheckout.errors.reasonRequired");
      return;
    }
    setWaiveBusy(true);
    setWaiveError("");
    try {
      await waiveCustomerFee(waiveId, parsed.data.reason);
      setWaiveId(null);
      setWaiveReason("");
      await loadData();
    } catch (cause) {
      setWaiveError(paymentErrorKey(cause));
    } finally {
      setWaiveBusy(false);
    }
  };

  const printReceipt = () => {
    const className = printLayout === "a4"
      ? "printing-payment-receipt receipt-layout-a4"
      : "printing-payment-receipt receipt-layout-thermal";
    document.body.classList.add(...className.split(" "));
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

  const handleCheckoutComplete = (_ticket: CheckoutTicket) => {
    setCheckoutDialogOpen(false);
    setCheckoutDone(true);
    setCheckinId(null);
  };

  const formatMoney = (amount: number) =>
    formatCurrency(amount, receiptSettings?.currencyCode ?? "EGP", locale);
  const receiptNumber = receipt && receiptSettings
    ? `${receiptSettings.receiptPrefix}${String(receipt.number).padStart(8, "0")}`
    : "";
  const orderSubtotal = selectedOrderRows.reduce((sum, order) => sum + order.subtotal, 0);
  const discount = selectedOrderRows.reduce((sum, order) => sum + order.discount, 0);
  const service = selectedOrderRows.reduce((sum, order) => sum + order.service_charge, 0);
  const tax = selectedOrderRows.reduce((sum, order) => sum + order.tax, 0);

  const body = (
    <>
      {onClose ? (
        <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-slate-950/60 p-3 sm:p-5">
          <section
            aria-labelledby="customer-checkout-title"
            aria-modal="true"
            className="relative my-auto max-h-[95vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900 sm:p-6"
            role="dialog"
          >
            <button
              aria-label={t("customerCheckout.close")}
              className="absolute end-3 top-3 grid size-10 place-items-center rounded-lg border border-slate-300 dark:border-slate-700"
              disabled={loadingAction}
              onClick={onClose}
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
            {renderContent()}
          </section>
        </div>
      ) : (
        <main className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
          <Link className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline" to={customer ? `/customers/${customer.id}` : "/customers"}>
            <ArrowLeft aria-hidden="true" size={17} />
            {t("customerCheckout.backToCustomer")}
          </Link>
          {renderContent()}
        </main>
      )}
      {waiveId && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/60 p-4">
          <section
            aria-labelledby="waive-fee-title"
            aria-modal="true"
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"
            role="dialog"
          >
            <h2 className="text-xl font-bold text-ink dark:text-white" id="waive-fee-title">
              {t("customerCheckout.waiveFee")}
            </h2>
            <label className="mt-4 block text-sm font-medium">
              <span className="mb-1 block">{t("customerCheckout.waiveReason")}</span>
              <textarea
                className="min-h-24 w-full rounded-xl border border-slate-300 bg-white p-3 text-ink dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                maxLength={500}
                onChange={(event) => setWaiveReason(event.target.value)}
                value={waiveReason}
              />
            </label>
            {waiveError && <p className="mt-3 text-sm text-red-700 dark:text-red-300" role="alert">{t(waiveError)}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button className="min-h-11 rounded-xl border border-slate-300 px-4 font-semibold dark:border-slate-700" disabled={waiveBusy} onClick={() => setWaiveId(null)} type="button">
                {t("customerCheckout.cancel")}
              </button>
              <button className="min-h-11 rounded-xl bg-brand px-4 font-semibold text-white disabled:opacity-60" disabled={waiveBusy} onClick={() => void submitWaiver()} type="button">
                {t(waiveBusy ? "customerCheckout.waiving" : "customerCheckout.confirmWaiver")}
              </button>
            </div>
          </section>
        </div>
      )}
      {checkoutDialogOpen && checkinId !== null && (
        <CheckoutDialog
          checkinId={checkinId}
          onClose={() => setCheckoutDialogOpen(false)}
          onComplete={handleCheckoutComplete}
        />
      )}
    </>
  );

  function renderContent() {
    if (loading) {
      return <div className="grid min-h-48 place-items-center"><LoaderCircle aria-label={t("customerCheckout.loading")} className="animate-spin text-brand" size={28} /></div>;
    }
    if (loadError || !customer || !receiptSettings) {
      return (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">
          <h1 className="text-xl font-bold" id="customer-checkout-title">{t("customerCheckout.title")}</h1>
          <p className="mt-2">{t("customerCheckout.errors.load")}</p>
          <button className="mt-4 font-semibold underline" onClick={() => void loadData()} type="button">{t("customerCheckout.retry")}</button>
        </div>
      );
    }

    return (
      <>
        <header className="flex flex-wrap items-start justify-between gap-4 pe-10">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-brand">{t("customerCheckout.eyebrow")}</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink dark:text-white" id="customer-checkout-title">
              {t(receipt ? "customerCheckout.receiptReady" : "customerCheckout.title")}
            </h1>
            <p className="mt-2 text-slate-600 dark:text-slate-300">{customer.full_name} · {customer.code}</p>
          </div>
          {!receipt && (
            <button className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700" onClick={() => void loadData()} type="button">
              {t("customerCheckout.refresh")}
            </button>
          )}
        </header>

        {paymentError && (
          <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="alert">
            {t(paymentError)}
          </p>
        )}

        {receipt ? (
          <section className="space-y-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900 dark:bg-emerald-950/20 sm:p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 aria-hidden="true" className="mt-1 shrink-0 text-emerald-700 dark:text-emerald-300" size={25} />
              <div>
                <p className="font-semibold text-emerald-900 dark:text-emerald-100">{t("customerCheckout.paymentComplete")}</p>
                <p className="mt-1 font-mono text-lg font-bold text-ink dark:text-white">{receiptNumber}</p>
                <p className="mt-1 text-2xl font-bold text-ink dark:text-white">{formatMoney(receipt.total)}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {t("customerCheckout.printLayout")}
                <select
                  className="ms-2 min-h-10 rounded-lg border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-950"
                  onChange={(event) => setPrintLayout(event.target.value as "thermal" | "a4")}
                  value={printLayout}
                >
                  <option value="thermal">{t("customerCheckout.thermal")}</option>
                  <option value="a4">{t("customerCheckout.a4")}</option>
                </select>
              </label>
              <button className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white" onClick={printReceipt} type="button">
                <Printer aria-hidden="true" size={17} />
                {t("customerCheckout.print")}
              </button>
              {checkinId !== null && canCheckout && (
                <button className="min-h-11 rounded-xl border border-slate-300 px-4 font-semibold dark:border-slate-700" onClick={() => setCheckoutDialogOpen(true)} type="button">
                  {t("customerCheckout.checkOut")}
                </button>
              )}
              {canCreateOrder && (
                <button className="min-h-11 rounded-xl border border-slate-300 px-4 font-semibold dark:border-slate-700" onClick={() => navigate("/orders/new", { state: { customerId: customer.id } })} type="button">
                  {t("customerCheckout.newOrder")}
                </button>
              )}
              {onClose && (
                <button className="min-h-11 rounded-xl border border-slate-300 px-4 font-semibold dark:border-slate-700" onClick={onClose} type="button">
                  {t("customerCheckout.close")}
                </button>
              )}
            </div>
            {checkoutDone && <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200" role="status">{t("customerCheckout.checkedOut")}</p>}
            <ReceiptPrint
              cashierName={`${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim()}
              customer={customer}
              discount={discount}
              formatMoney={formatMoney}
              issuedAt={receipt.created_at}
              layout={printLayout}
              lines={paidLines}
              number={receiptNumber}
              receipt={receipt}
              receiptSettings={receiptSettings}
              service={service}
              subtotal={orderSubtotal}
              tax={tax}
              dir={i18n.dir()}
            />
          </section>
        ) : (
          <>
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-ink dark:text-white">{t("customerCheckout.unpaidItems")}</h2>
              {orders.length === 0 && fees.length === 0 ? (
                <p className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">{t("customerCheckout.empty")}</p>
              ) : (
                <div className="space-y-3">
                  {orders.map((order) => (
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900" key={order.id}>
                      <input checked={selectedOrders.has(order.id)} className="mt-1 size-5 accent-brand" onChange={() => toggleOrder(order.id)} type="checkbox" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-ink dark:text-white">{t("customerCheckout.orderNumber", { number: order.number })}</span>
                        <span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">{order.description}</span>
                        <span className="mt-1 block text-xs text-slate-500">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.created_at))}</span>
                      </span>
                      <strong className="shrink-0 text-ink dark:text-white">{formatMoney(order.total)}</strong>
                    </label>
                  ))}
                  {fees.map((fee) => (
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900" key={fee.id}>
                      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                        <input checked={selectedFees.has(fee.id)} className="mt-1 size-5 accent-brand" onChange={() => toggleFee(fee.id)} type="checkbox" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold text-ink dark:text-white">{t("customerCheckout.overdueFee", { block: fee.block_number })}</span>
                          <span className="mt-1 block text-xs text-slate-500">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(fee.created_at))}</span>
                        </span>
                        <strong className="shrink-0 text-ink dark:text-white">{formatMoney(fee.amount)}</strong>
                      </label>
                      {canWaive && (
                        <button className="min-h-9 rounded-lg border border-amber-300 px-3 text-xs font-semibold text-amber-900 dark:border-amber-900 dark:text-amber-200" onClick={() => { setWaiveId(fee.id); setWaiveReason(""); setWaiveError(""); }} type="button">
                          {t("customerCheckout.waiveFee")}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 sm:p-5">
              <div>
                <label className="block text-sm font-semibold text-ink dark:text-white">
                  <span className="mb-1 block">{t("customerCheckout.paymentMethod")}</span>
                  <select className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setPaymentMethod(event.target.value as CustomerPaymentMethod)} value={paymentMethod}>
                    <option value="cash">{t("customerCheckout.methods.cash")}</option>
                    <option value="card">{t("customerCheckout.methods.card")}</option>
                    <option value="wallet">{t("customerCheckout.methods.wallet")}</option>
                    <option value="other">{t("customerCheckout.methods.other")}</option>
                  </select>
                </label>
                {paymentMethod === "cash" && (
                  <label className="mt-4 block text-sm font-semibold text-ink dark:text-white">
                    <span className="mb-1 block">{t("customerCheckout.amountReceived")}</span>
                    <input className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" inputMode="decimal" min="0" onChange={(event) => setAmountReceived(event.target.value)} step="0.01" type="number" value={amountReceived} />
                    <span className="mt-1 block text-sm font-normal text-slate-600 dark:text-slate-300">
                      {Number(amountReceived) >= total
                        ? t("customerCheckout.change", { amount: formatMoney(Number(amountReceived) - total) })
                        : t("customerCheckout.remaining", { amount: formatMoney(total - (Number(amountReceived) || 0)) })}
                    </span>
                  </label>
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold text-ink dark:text-white">
                  <span className="mb-1 block">{t("customerCheckout.note")}</span>
                  <textarea className="min-h-24 w-full rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-950" maxLength={300} onChange={(event) => setNote(event.target.value)} value={note} />
                </label>
                <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
                  <span className="font-semibold text-ink dark:text-white">{t("customerCheckout.total")}</span>
                  <strong className="text-2xl text-ink dark:text-white">{formatMoney(total)}</strong>
                </div>
                <button className="mt-4 min-h-12 w-full rounded-xl bg-brand px-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={loadingAction || loading || (selectedOrders.size + selectedFees.size === 0) || (paymentMethod === "cash" && (!amountReceived || Number(amountReceived) < total))} onClick={() => void submitPayment()} type="button">
                  {t(loadingAction ? "customerCheckout.processing" : "customerCheckout.confirmPayment")}
                </button>
              </div>
            </section>
          </>
        )}
      </>
    );
  }

  return onClose
    ? createPortal(body, document.body)
    : body;
}
