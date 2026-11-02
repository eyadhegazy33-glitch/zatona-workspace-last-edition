import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useBranding } from "../hooks/useBranding";
import type { ReceiptDisplaySettings } from "../services/settings";

type ReceiptCustomer = {
  full_name: string;
  code: string;
};

type PrintableReceipt = {
  total: number;
  method: "cash" | "card" | "wallet" | "other";
  status: "paid" | "voided";
  amount_received: number | null;
  note: string | null;
};

type PrintableReceiptLine = {
  kind: "order" | "fee";
  id: string;
  label: string;
  amount: number;
};

type Props = {
  cashierName: string;
  customer: ReceiptCustomer;
  discount: number;
  formatMoney: (amount: number) => string;
  issuedAt: string;
  layout: "thermal" | "a4";
  lines: PrintableReceiptLine[];
  number: string;
  receipt: PrintableReceipt;
  receiptSettings: ReceiptDisplaySettings;
  service: number;
  subtotal: number;
  tax: number;
  dir: string;
  showScreenPreview?: boolean;
};

export function ReceiptPrint({
  cashierName,
  customer,
  discount,
  formatMoney,
  issuedAt,
  layout,
  lines,
  number,
  receipt,
  receiptSettings,
  service,
  subtotal,
  tax,
  dir,
  showScreenPreview = true,
}: Props) {
  const { t } = useTranslation();
  const { settings: branding } = useBranding();
  const locale = dir === "rtl" ? "ar-EG" : "en-EG";
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: receiptSettings.timeZone,
  }).format(new Date(issuedAt));
  const change = Math.max(0, (receipt.amount_received ?? 0) - receipt.total);

  const contents = (className: string) => (
    <article className={className} dir={dir} lang={dir === "rtl" ? "ar" : "en"}>
      {receipt.status === "voided" && (
        <div className="payment-receipt-voided">{t("customerCheckout.voided")}</div>
      )}
      <header className="payment-receipt-brand">
        {branding.logoUrl && (
          <img alt="" className="payment-receipt-logo" src={branding.logoUrl} />
        )}
        <h1>{branding.workspaceName}</h1>
        <p>{t("customerCheckout.receiptTitle")}</p>
      </header>
      <section className="payment-receipt-meta">
        <p><strong>{t("customerCheckout.receiptNumber")}:</strong> {number}</p>
        <p><strong>{t("customerCheckout.date")}:</strong> {date}</p>
        <p><strong>{t("customerCheckout.cashier")}:</strong> {cashierName || t("customerCheckout.unknownCashier")}</p>
        <p><strong>{t("customerCheckout.customer")}:</strong> {customer.full_name}</p>
        <p><strong>{t("customerCheckout.customerCode")}:</strong> {customer.code}</p>
      </section>
      <section className="payment-receipt-lines">
        <div className="payment-receipt-table-head">
          <span>{t("customerCheckout.description")}</span>
          <span>{t("customerCheckout.amount")}</span>
        </div>
        {lines.map((line) => (
          <div className="payment-receipt-line" key={`${line.kind}-${line.id}`}>
            <span>{line.label}</span>
            <strong>{formatMoney(line.amount)}</strong>
          </div>
        ))}
      </section>
      <section className="payment-receipt-totals">
        <p><span>{t("customerCheckout.subtotal")}</span><span>{formatMoney(subtotal)}</span></p>
        {discount > 0 && (
          <p><span>{t("customerCheckout.discount")}</span><span>−{formatMoney(discount)}</span></p>
        )}
        <p><span>{t("customerCheckout.service")}</span><span>{formatMoney(service)}</span></p>
        <p><span>{t("customerCheckout.tax")}</span><span>{formatMoney(tax)}</span></p>
        <p className="payment-receipt-total">
          <strong>{t("customerCheckout.total")}</strong>
          <strong>{formatMoney(receipt.total)}</strong>
        </p>
      </section>
      <section className="payment-receipt-payment">
        <p>
          <strong>{t("customerCheckout.paymentMethod")}:</strong>
          {t(`customerCheckout.methods.${receipt.method}`)}
        </p>
        {receipt.method === "cash" && (
          <>
            <p>
              <span>{t("customerCheckout.amountReceived")}</span>
              <span>{formatMoney(receipt.amount_received ?? receipt.total)}</span>
            </p>
            <p><span>{t("customerCheckout.changeLabel")}</span><span>{formatMoney(change)}</span></p>
          </>
        )}
      </section>
      {receipt.note && <p className="payment-receipt-note">{receipt.note}</p>}
      <footer className="payment-receipt-footer">
        {receiptSettings.footerText || t("customerCheckout.thanks")}
      </footer>
    </article>
  );

  return (
    <>
      {showScreenPreview && contents("payment-receipt-screen")}
      {createPortal(
        contents(`payment-receipt payment-receipt-${layout}`),
        document.body,
      )}
    </>
  );
}
