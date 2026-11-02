import QRCode from "qrcode";
import {
  ArrowLeft,
  CalendarDays,
  KeyRound,
  LoaderCircle,
  Pencil,
  Printer,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  CustomerCardPrint,
  type PrintableCustomerCard,
} from "../components/CustomerCardPrint";
import { TimerWidget } from "../components/TimerWidget";
import { CustomerFeedbackDialog } from "../components/CustomerFeedbackDialog";
import { CustomerPaymentDialog } from "./CustomerCheckoutPage";
import { z } from "zod";
import { useAuth } from "../hooks/useAuth";
import { useBranding } from "../hooks/useBranding";
import { waitForPrintAssets } from "../lib/print";
import {
  getCustomer,
  getCustomerQrToken,
  getCustomerVisits,
  getStudentTypeName,
  reissueQrToken,
  setCustomerStatus,
  softDeleteCustomer,
  type Customer,
  type CustomerStatus,
} from "../services/customers";
import { logCustomerCardPrint } from "../services/customerCards";
import { setCustomerLoyaltyPin } from "../services/customerLoyalty";

const loyaltyPinSchema = z.object({
  pin: z.string().regex(/^[0-9]{6,12}$/),
  confirmation: z.string().regex(/^[0-9]{6,12}$/),
}).refine((value) => value.pin === value.confirmation, {
  path: ["confirmation"],
});

type Visit = { id: number; checked_in_at: string };
type CustomerAction = "block" | "unblock" | "expire" | "reissue" | "delete";
type ConfirmAction = CustomerAction | null;

function customerErrorKey(cause: unknown): string {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "42501"
  ) {
    return "customers.errors.permission";
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
  return "customers.errors.action";
}

function formatDate(
  value: string | null,
  language: string,
  includeTime = false,
): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
  }).format(new Date(value));
}

export function CustomerProfilePage() {
  const { i18n, t } = useTranslation();
  const { permissions } = useAuth();
  const { loading: brandingLoading } = useBranding();
  const navigate = useNavigate();
  const { customerId = "" } = useParams();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toastKey, setToastKey] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [printingCard, setPrintingCard] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [pinConfirmation, setPinConfirmation] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [printableCards, setPrintableCards] = useState<
    PrintableCustomerCard[]
  >([]);
  const printStartedRef = useRef(false);

  const canEdit = permissions.includes("customers.edit");
  const canDelete = permissions.includes("customers.delete");
  const canPrint = permissions.includes("customers.cards");
  const canManageLoyalty = permissions.includes("loyalty.manage");
  const dateLocale = i18n.language === "ar" ? "ar" : "en";

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [customerResult, visitsResult] = await Promise.all([
        getCustomer(customerId),
        getCustomerVisits(customerId),
      ]);
      setCustomer(customerResult);
      setVisits(visitsResult);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let mounted = true;
    if (!customer || !canPrint) {
      setQrDataUrl(null);
      setQrLoading(false);
      return () => {
        mounted = false;
      };
    }

    setQrDataUrl(null);
    setQrLoading(true);
    void getCustomerQrToken(customer.id)
      .then((token) =>
        QRCode.toDataURL(
          token,
          {
            errorCorrectionLevel: "M",
            margin: 4,
            width: 256,
          },
        ),
      )
      .then((dataUrl) => {
        if (mounted) setQrDataUrl(dataUrl);
      })
      .catch((cause: unknown) => {
        if (mounted) setActionError(customerErrorKey(cause));
      })
      .finally(() => {
        if (mounted) setQrLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [canPrint, customer]);

  useEffect(() => {
    if (!printableCards.length) {
      printStartedRef.current = false;
      return;
    }
    if (brandingLoading) return;
    if (printStartedRef.current) return;

    let cancelled = false;
    const clear = () => setPrintableCards([]);
    window.addEventListener("afterprint", clear, { once: true });
    const print = async () => {
      const printRoot = document.getElementById("customer-print-area");
      if (!printRoot) {
        throw new Error("Customer print root is missing.");
      }
      await waitForPrintAssets(printRoot);
      if (cancelled) return;
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() =>
          window.requestAnimationFrame(() => resolve()),
        ),
      );
      if (cancelled) return;
      printStartedRef.current = true;
      window.print();
      void logCustomerCardPrint(printableCards.length).catch(() => {
        setActionError("customerCards.errors.print");
      });
    };
    void print().catch(() => {
      if (cancelled) return;
      setActionError("customerCards.errors.qr");
      setPrintableCards([]);
    });
    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", clear);
    };
  }, [brandingLoading, printableCards]);

  const confirm = async () => {
    if (!customer || !confirmAction || actionLoading) return;
    setActionLoading(true);
    setActionError(null);
    setToastKey(null);
    try {
      if (confirmAction === "block") {
        await setCustomerStatus(customer.id, "blocked");
        setToastKey("customers.toast.blocked");
      } else if (confirmAction === "unblock") {
        await setCustomerStatus(customer.id, "active");
        setToastKey("customers.toast.unblocked");
      } else if (confirmAction === "expire") {
        await setCustomerStatus(customer.id, "expired");
        setToastKey("customers.toast.expired");
      } else if (confirmAction === "delete") {
        await softDeleteCustomer(customer.id);
        navigate("/customers", { replace: true });
        return;
      } else {
        const token = await reissueQrToken(customer.id);
        if (!token) {
          throw new Error("Missing QR token");
        }
        const qrDataUrl = await QRCode.toDataURL(
          token,
          {
            errorCorrectionLevel: "M",
            margin: 4,
            width: 256,
          },
        );
        setQrDataUrl(qrDataUrl);
        setToastKey("customers.toast.qrReissued");
      }
      setConfirmAction(null);
      if (confirmAction !== "reissue") await refresh();
    } catch (cause) {
      setActionError(customerErrorKey(cause));
    } finally {
      setActionLoading(false);
    }
  };

  const handlePinSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = loyaltyPinSchema.safeParse({
      pin: pinValue,
      confirmation: pinConfirmation,
    });
    if (!parsed.success) {
      setPinError(
        pinValue !== pinConfirmation
          ? "customerLoyalty.pin.errors.mismatch"
          : "customerLoyalty.pin.errors.invalid",
      );
      return;
    }
    if (!customer || pinSaving) return;
    setPinSaving(true);
    setPinError(null);
    try {
      await setCustomerLoyaltyPin(customer.id, parsed.data.pin);
      setPinDialogOpen(false);
      setPinValue("");
      setPinConfirmation("");
      setToastKey("customerLoyalty.pin.saved");
    } catch {
      setPinError("customerLoyalty.pin.errors.save");
    } finally {
      setPinSaving(false);
    }
  };

  const printNewCard = async () => {
    if (!customer || !canPrint || printingCard) return;
    setPrintingCard(true);
    try {
      const token = await getCustomerQrToken(customer.id);
      const qrDataUrl = await QRCode.toDataURL(
        token,
        {
          errorCorrectionLevel: "M",
          margin: 4,
          width: 256,
        },
      );
      const studentType = customer.student_type;
      setPrintableCards([
        {
          customer,
          qrDataUrl,
          studentTypeName: studentType
            ? getStudentTypeName(studentType, i18n.language)
            : "",
        },
      ]);
    } catch {
      setActionError("customers.errors.action");
    } finally {
      setPrintingCard(false);
    }
  };

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

  const statusLabel = (status: CustomerStatus) =>
    t(`customers.status.${status}`);
  const dialogTitle =
    confirmAction === "block"
      ? "customers.dialog.blockTitle"
      : confirmAction === "unblock"
        ? "customers.dialog.unblockTitle"
        : confirmAction === "expire"
          ? "customers.dialog.expireTitle"
          : confirmAction === "reissue"
            ? "customers.dialog.reissueTitle"
            : "customers.dialog.deleteTitle";
  const dialogMessage =
    confirmAction === "block"
      ? "customers.dialog.blockMessage"
      : confirmAction === "unblock"
        ? "customers.dialog.unblockMessage"
        : confirmAction === "expire"
          ? "customers.dialog.expireMessage"
          : confirmAction === "reissue"
            ? "customers.dialog.reissueMessage"
            : "customers.dialog.deleteMessage";

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
        to="/customers"
      >
        <ArrowLeft aria-hidden="true" size={17} />
        {t("customers.actions.backToList")}
      </Link>

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

      {!loadError && !customer && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-2xl font-semibold text-ink dark:text-white">
            {t("customers.errors.notFound")}
          </h1>
        </div>
      )}

      {customer && (
        <>
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight text-ink dark:text-white">
                  {customer.full_name}
                </h1>
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                    customer.status === "active"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                      : customer.status === "blocked"
                        ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                        : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                  }`}
                >
                  {statusLabel(customer.status)}
                </span>
              </div>
              <p className="mt-2 font-mono text-sm text-slate-500 dark:text-slate-400">
                {customer.code}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {permissions.includes("feedback.add") && (
                <button
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-brand/40 px-3 text-sm font-semibold text-brand"
                  onClick={() => setFeedbackDialogOpen(true)}
                  type="button"
                >
                  {t("quality.feedback.record")}
                </button>
              )}
              {canManageLoyalty && (
                <button
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-brand/40 px-3 text-sm font-semibold text-brand"
                  onClick={() => {
                    setPinError(null);
                    setPinDialogOpen(true);
                  }}
                  type="button"
                >
                  <KeyRound aria-hidden="true" size={16} />
                  {t("customerLoyalty.pin.enroll")}
                </button>
              )}
              {permissions.includes("payments.collect") && (
                <button
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-white"
                  onClick={() => setPaymentDialogOpen(true)}
                  type="button"
                >
                  {t("customerCheckout.collectPayment")}
                </button>
              )}
              {canPrint && (
                <button
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={actionLoading || printingCard || brandingLoading}
                  onClick={() => void printNewCard()}
                  type="button"
                >
                  <Printer aria-hidden="true" size={16} />
                  {printingCard || brandingLoading
                    ? t("customerCards.printing")
                    : t("customers.actions.printCard")}
                </button>
              )}
              {canEdit && (
                <Link
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                  to={`/customers/${customer.id}/edit`}
                >
                  <Pencil aria-hidden="true" size={16} />
                  {t("customers.actions.edit")}
                </Link>
              )}
              {canEdit && customer.status !== "blocked" && (
                <button
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-300 px-3 text-sm font-semibold text-amber-900 dark:border-amber-900 dark:text-amber-200"
                  onClick={() => setConfirmAction("block")}
                  type="button"
                >
                  <ShieldAlert aria-hidden="true" size={16} />
                  {t("customers.actions.block")}
                </button>
              )}
              {canEdit && customer.status === "blocked" && (
                <button
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-300 px-3 text-sm font-semibold text-emerald-900 dark:border-emerald-900 dark:text-emerald-200"
                  onClick={() => setConfirmAction("unblock")}
                  type="button"
                >
                  <ShieldCheck aria-hidden="true" size={16} />
                  {t("customers.actions.unblock")}
                </button>
              )}
              {canEdit && customer.status !== "expired" && (
                <button
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                  onClick={() => setConfirmAction("expire")}
                  type="button"
                >
                  <CalendarDays aria-hidden="true" size={16} />
                  {t("customers.actions.markExpired")}
                </button>
              )}
              {canEdit && (
                <button
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                  onClick={() => {
                    setActionError(null);
                    setConfirmAction("reissue");
                  }}
                  type="button"
                >
                  <RefreshCw aria-hidden="true" size={16} />
                  {t("customers.actions.reissueQr")}
                </button>
              )}
              {canDelete && (
                <button
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-700 dark:border-red-900 dark:text-red-300"
                  onClick={() => setConfirmAction("delete")}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={16} />
                  {t("customers.actions.delete")}
                </button>
              )}
            </div>
          </div>

          {actionError && (
            <p
              className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
              role="alert"
            >
              {t(actionError)}
            </p>
          )}
          {toastKey && (
            <p
              className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              role="status"
            >
              {t(toastKey)}
            </p>
          )}

          {permissions.includes("timers.view") && (
            <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-3 text-lg font-semibold text-ink dark:text-white">
                {t("timers.title")}
              </h2>
              <TimerWidget customerId={customer.id} enabled />
            </section>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(16rem,0.7fr)_minmax(20rem,0.8fr)]">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
              <h2 className="text-lg font-semibold text-ink dark:text-white">
                {t("customers.profile.details")}
              </h2>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                <Detail label={t("customers.fields.birthDate")} value={formatDate(customer.birth_date, dateLocale)} />
                <Detail
                  label={t("customers.fields.studentType")}
                  value={
                    customer.student_type
                      ? getStudentTypeName(
                          customer.student_type,
                          i18n.language,
                        )
                      : "—"
                  }
                />
                <Detail label={t("customers.fields.phone")} value={customer.phone ?? "—"} direction="ltr" />
                <Detail
                  label={t("customers.fields.expiry")}
                  value={
                    customer.expires_on
                      ? formatDate(customer.expires_on, dateLocale)
                      : t("customers.values.noExpiry")
                  }
                />
                <Detail label={t("customers.fields.created")} value={formatDate(customer.created_at, dateLocale)} />
                <Detail label={t("customers.fields.updated")} value={formatDate(customer.updated_at, dateLocale)} />
              </dl>
              <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {t("customers.fields.notes")}
                </h3>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
                  {customer.notes || t("customers.values.noNotes")}
                </p>
              </div>
            </section>

            {canPrint && (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
                <h2 className="text-lg font-semibold text-ink dark:text-white">
                  {t("customers.print.qrCode")}
                </h2>
                <div className="mt-4 grid min-h-48 place-items-center rounded-xl bg-slate-50 p-4 dark:bg-slate-950">
                  {qrLoading ? (
                    <LoaderCircle
                      aria-label={t("customerCards.generatingQr")}
                      className="animate-spin text-brand"
                      size={24}
                    />
                  ) : qrDataUrl ? (
                    <img
                      alt={t("customers.print.qrCode")}
                      className="size-48 rounded-lg bg-white p-2"
                      src={qrDataUrl}
                    />
                  ) : (
                    <p className="text-center text-sm text-slate-500 dark:text-slate-400">
                      {t("customerCards.qrUnavailable")}
                    </p>
                  )}
                </div>
              </section>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
              <h2 className="text-lg font-semibold text-ink dark:text-white">
                {t("customers.profile.visits")}
              </h2>
              {visits.length === 0 ? (
                <p className="mt-4 rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                  {t("customers.profile.noVisits")}
                </p>
              ) : (
                <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="min-w-full divide-y divide-slate-200 text-start text-sm dark:divide-slate-800">
                    <thead className="bg-slate-50 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-medium">
                          {t("customers.profile.visitDate")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {visits.map((visit) => (
                        <tr key={visit.id}>
                          <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                            {formatDate(visit.checked_in_at, dateLocale, true)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

        </>
      )}

      {confirmAction && customer && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !actionLoading) {
              setConfirmAction(null);
            }
          }}
        >
          <section
            aria-labelledby="customer-action-title"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"
            role="dialog"
          >
            <h2
              className="text-lg font-semibold text-ink dark:text-white"
              id="customer-action-title"
            >
              {t(dialogTitle)}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {t(dialogMessage, { name: customer.full_name })}
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                disabled={actionLoading}
                onClick={() => setConfirmAction(null)}
                type="button"
              >
                {t("customers.actions.cancel")}
              </button>
              <button
                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-60 ${
                  confirmAction === "delete"
                    ? "bg-red-700"
                    : "bg-brand"
                }`}
                disabled={actionLoading}
                onClick={() => void confirm()}
                type="button"
              >
                {actionLoading && (
                  <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />
                )}
                {t(
                  actionLoading
                    ? "customers.actions.working"
                    : "customers.actions.confirm",
                )}
              </button>
            </div>
          </section>
        </div>
      )}

      {customer && (
        <CustomerCardPrint
          cards={printableCards}
        />
      )}
      {customer && paymentDialogOpen && (
        <CustomerPaymentDialog
          customerId={customer.id}
          onClose={() => setPaymentDialogOpen(false)}
        />
      )}
      {customer && feedbackDialogOpen && (
        <CustomerFeedbackDialog
          customerId={customer.id}
          onClose={() => setFeedbackDialogOpen(false)}
        />
      )}
      {customer && pinDialogOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pinSaving) {
              setPinDialogOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="loyalty-pin-title"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"
            role="dialog"
          >
            <h2 className="text-xl font-bold text-ink dark:text-white" id="loyalty-pin-title">
              {t("customerLoyalty.pin.title")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
              {t("customerLoyalty.pin.help")}
            </p>
            <form className="mt-5 space-y-4" noValidate onSubmit={(event) => void handlePinSave(event)}>
              <label className="block text-sm font-medium" htmlFor="customer-loyalty-pin">
                {t("customerLoyalty.pin.newPin")}
                <input
                  autoComplete="new-password"
                  className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-lg tracking-[0.3em] outline-none focus:border-brand dark:border-slate-700 dark:bg-slate-950"
                  dir="ltr"
                  id="customer-loyalty-pin"
                  inputMode="numeric"
                  maxLength={12}
                  onChange={(event) => setPinValue(event.target.value)}
                  type="password"
                  value={pinValue}
                />
              </label>
              <label className="block text-sm font-medium" htmlFor="customer-loyalty-pin-confirm">
                {t("customerLoyalty.pin.confirmPin")}
                <input
                  autoComplete="new-password"
                  className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-lg tracking-[0.3em] outline-none focus:border-brand dark:border-slate-700 dark:bg-slate-950"
                  dir="ltr"
                  id="customer-loyalty-pin-confirm"
                  inputMode="numeric"
                  maxLength={12}
                  onChange={(event) => setPinConfirmation(event.target.value)}
                  type="password"
                  value={pinConfirmation}
                />
              </label>
              {pinError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300" role="alert">
                  {t(pinError)}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold dark:border-slate-700"
                  disabled={pinSaving}
                  onClick={() => setPinDialogOpen(false)}
                  type="button"
                >
                  {t("customerLoyalty.pin.cancel")}
                </button>
                <button
                  className="min-h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={pinSaving}
                  type="submit"
                >
                  {pinSaving ? t("customerLoyalty.pin.saving") : t("customerLoyalty.pin.save")}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

function Detail({
  label,
  value,
  direction,
}: {
  label: string;
  value: string;
  direction?: "ltr";
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd
        className="mt-1 break-words text-sm font-medium text-slate-800 dark:text-slate-100"
        dir={direction}
      >
        {value}
      </dd>
    </div>
  );
}
