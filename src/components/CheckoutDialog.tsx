import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useBranding } from "../hooks/useBranding";
import {
  checkoutVisit,
  type CheckoutTicket,
  type PosReceipt,
} from "../services/pointOfSale";

type Props = {
  checkinId: number;
  onClose: () => void;
  onComplete: (ticket: CheckoutTicket) => void;
};

function getErrorKey(cause: unknown): string {
  const message =
    cause && typeof cause === "object" && "message" in cause
      ? String(cause.message).toLowerCase()
      : cause instanceof Error
        ? cause.message.toLowerCase()
        : "";
  if (message.includes("orders must be served")) return "checkout.errors.ordersNotServed";
  if (message.includes("open shift required")) return "checkout.errors.openShiftRequired";
  if (message.includes("currency mismatch")) return "checkout.errors.currencyMismatch";
  if (message.includes("not allowed")) return "checkout.errors.permission";
  if (message.includes("visit not found")) return "checkout.errors.visitClosed";
  return "checkout.errors.failed";
}

export function CheckoutDialog({ checkinId, onClose, onComplete }: Props) {
  const { i18n, t } = useTranslation();
  const { settings: branding } = useBranding();
  const [paymentMethod, setPaymentMethod] = useState<PosReceipt["payment_method"]>("cash");
  const [ticket, setTicket] = useState<CheckoutTicket | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locale = i18n.language.startsWith("ar") ? "ar-EG" : i18n.language;

  useEffect(() => () => {
    document.body.classList.remove("printing-order-ticket");
  }, []);

  const formatMoney = (amount: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" })
      .format(new Date(value));

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await checkoutVisit(checkinId, paymentMethod);
      setTicket(result);
      onComplete(result);
    } catch (cause) {
      setError(t(getErrorKey(cause)));
    } finally {
      setBusy(false);
    }
  };

  const printTicket = () => {
    const cleanup = () => {
      document.body.classList.remove("printing-order-ticket");
      window.removeEventListener("afterprint", cleanup);
    };
    document.body.classList.add("printing-order-ticket");
    window.addEventListener("afterprint", cleanup);
    window.print();
  };

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/60 p-4 print:hidden"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) onClose();
        }}
      >
        <section
          aria-labelledby="checkout-dialog-title"
          aria-modal="true"
          className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900 sm:p-6"
          role="dialog"
        >
          <h2 className="text-xl font-bold text-ink dark:text-white" id="checkout-dialog-title">
            {t(ticket ? "checkout.ticketReady" : "checkout.title")}
          </h2>
          {ticket ? (
            <>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {t("checkout.success", { ticket: ticket.ticket_no })}
              </p>
              <p className="mt-3 text-2xl font-bold text-ink dark:text-white">
                {formatMoney(ticket.total, ticket.currency)}
              </p>
              <div className="mt-5 flex flex-wrap justify-end gap-3">
                <button
                  className="min-h-11 rounded-xl border border-slate-300 px-4 font-semibold dark:border-slate-700"
                  onClick={onClose}
                  type="button"
                >
                  {t("checkout.close")}
                </button>
                <button
                  className="min-h-11 rounded-xl bg-brand px-4 font-semibold text-white"
                  onClick={printTicket}
                  type="button"
                >
                  {t("checkout.print")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {t("checkout.description")}
              </p>
              <label className="mt-4 block text-sm font-medium">
                <span className="mb-1 block">{t("checkout.paymentMethod")}</span>
                <select
                  className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-ink dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  onChange={(event) => setPaymentMethod(event.target.value as PosReceipt["payment_method"])}
                  value={paymentMethod}
                >
                  <option value="cash">{t("pos.payment.cash")}</option>
                  <option value="card">{t("pos.payment.card")}</option>
                  <option value="other">{t("pos.payment.other")}</option>
                </select>
              </label>
              {error && (
                <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
                  {error}
                </p>
              )}
              <div className="mt-5 flex flex-wrap justify-end gap-3">
                <button
                  className="min-h-11 rounded-xl border border-slate-300 px-4 font-semibold dark:border-slate-700"
                  disabled={busy}
                  onClick={onClose}
                  type="button"
                >
                  {t("checkout.cancel")}
                </button>
                <button
                  className="min-h-11 rounded-xl bg-brand px-4 font-semibold text-white disabled:opacity-60"
                  disabled={busy}
                  onClick={() => void submit()}
                  type="button"
                >
                  {t(busy ? "checkout.processing" : "checkout.payAndCheckOut")}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
      {ticket && (
        <div className="order-ticket" dir={i18n.dir()}>
          <header className="ticket-brand">
            {branding.logoUrl && <img alt="" className="ticket-logo" src={branding.logoUrl} />}
            <p className="ticket-brand-name">{branding.workspaceName}</p>
            <p className="ticket-subtitle">{t("checkout.ticketTitle")}</p>
          </header>
          <section className="ticket-order-heading">
            <p className="ticket-order-number">{ticket.ticket_no}</p>
            <p className="ticket-order-date">{formatDate(ticket.issued_at)}</p>
            <p className="ticket-order-status">{t(`pos.payment.${ticket.payment_method}`)}</p>
          </section>
          <section className="ticket-customer">
            <p><strong>{t("checkout.customer")}:</strong> {ticket.customer_name}</p>
            <p><strong>{t("checkout.customerCode")}:</strong> {ticket.customer_code}</p>
          </section>
          <section className="ticket-items">
            <h2>{t("checkout.items")}</h2>
            {ticket.items.map((item, index) => (
              <div className="ticket-item" key={`${item.kind}-${index}`}>
                <p className="ticket-item-main">
                  <span>
                    {item.kind === "order_item"
                      ? i18n.language.startsWith("ar") ? item.name_ar : item.name_en
                      : t(`checkout.itemTypes.${item.kind}`)}
                    {item.order_number ? ` · ${t("ordersBoard.orderNumber", { number: item.order_number })}` : ""}
                  </span>
                  <strong>× {item.quantity}</strong>
                </p>
                <p className="ticket-item-note">{formatMoney(item.line_total, ticket.currency)}</p>
              </div>
            ))}
          </section>
          <section className="ticket-totals">
            <p className="ticket-grand-total">
              <strong>{t("checkout.totalPaid")}</strong>
              <strong>{formatMoney(ticket.total, ticket.currency)}</strong>
            </p>
          </section>
          <footer className="ticket-footer">{t("checkout.thanks")}</footer>
        </div>
      )}
    </>,
    document.body,
  );
}
