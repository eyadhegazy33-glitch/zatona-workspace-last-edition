import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useTranslation } from "react-i18next";
import { useBranding } from "../hooks/useBranding";

export type CustomerCardDetails = {
  fullName: string;
  studentType: string;
  birthDate: string;
  code: string;
  qrToken?: string;
};

type CustomerCardProps = {
  customer: CustomerCardDetails;
  face?: "front" | "back";
  qrDataUrl?: string;
};

export function CustomerCard({
  customer,
  face = "front",
  qrDataUrl,
}: CustomerCardProps) {
  const { i18n, t } = useTranslation();
  const { settings } = useBranding();
  const [qrImage, setQrImage] = useState("");
  const [qrFailed, setQrFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (face === "back") {
      setQrImage("");
      setQrFailed(false);
      return () => {
        cancelled = true;
      };
    }

    if (qrDataUrl) {
      setQrImage(qrDataUrl);
      setQrFailed(false);
      return () => {
        cancelled = true;
      };
    }

    setQrImage("");
    setQrFailed(false);
    if (!customer.qrToken) {
      setQrFailed(true);
      return () => {
        cancelled = true;
      };
    }

    void QRCode.toDataURL(customer.qrToken, {
      errorCorrectionLevel: "M",
      margin: 4,
      width: 256,
      color: { dark: "#111827", light: "#ffffff" },
    })
      .then((image) => {
        if (!cancelled) setQrImage(image);
      })
      .catch(() => {
        if (!cancelled) setQrFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [customer.qrToken, face, qrDataUrl]);

  if (face === "back") {
    return (
      <article className="customer-card customer-card-back" dir={i18n.dir()}>
        <header className="flex items-center gap-2 border-b border-white/30 pb-2">
          {settings.logoUrl ? (
            <img
              alt=""
              className="size-8 rounded-full bg-white object-contain p-1"
              src={settings.logoUrl}
            />
          ) : (
            <span className="grid size-8 place-items-center rounded-full bg-white/15 text-xs font-bold">
              {settings.workspaceName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="truncate text-sm font-semibold">
            {settings.workspaceName}
          </span>
        </header>
        <div className="mt-3 flex flex-1 flex-col justify-between text-xs leading-relaxed">
          <p>{t("customerCards.back.rules")}</p>
          <p>
            {t("customerCards.back.phone")}:{" "}
            {t("customerCards.back.phoneNotSet")}
          </p>
        </div>
      </article>
    );
  }

  const nameFontSize = Math.max(
    6.5,
    Math.min(20, 700 / Math.max(1, customer.fullName.length)),
  );
  const displayedQr = qrDataUrl || qrImage;

  return (
    <article className="customer-card customer-card-front" dir={i18n.dir()}>
      <div className="customer-card-content">
        <div className="flex min-w-0 items-center gap-2">
          {settings.logoUrl ? (
            <img
              alt=""
              className="size-8 shrink-0 rounded-full bg-white object-contain p-1"
              src={settings.logoUrl}
            />
          ) : (
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15 text-xs font-bold">
              {settings.workspaceName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="truncate text-sm font-semibold">
            {settings.workspaceName}
          </span>
        </div>
        <div className="flex min-h-0 flex-1 items-center gap-2" dir="ltr">
          <div className="min-w-0 flex-1">
            <p
              className="customer-card-name"
              dir="auto"
              style={{ fontSize: `${nameFontSize}px` }}
            >
              {customer.fullName}
            </p>
            <p className="mt-1 truncate text-xs opacity-85">
              {customer.studentType}
            </p>
            <p className="mt-2 text-[10px] opacity-80">
              {t("customerCards.fields.birthDate")}
            </p>
            <p className="text-xs font-medium">{customer.birthDate}</p>
            <p className="mt-1 font-mono text-xs tracking-wider">
              {customer.code}
            </p>
          </div>
          <div className="customer-card-qr shrink-0">
            {displayedQr ? (
              <img
                alt={t("customerCards.qrAlt")}
                className="size-full"
                src={displayedQr}
              />
            ) : (
              <span
                className="px-1 text-center text-[9px] text-slate-700"
                role={qrFailed ? "alert" : "status"}
              >
                {qrFailed
                  ? t("customerCards.qrUnavailable")
                  : t("customerCards.generatingQr")}
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
