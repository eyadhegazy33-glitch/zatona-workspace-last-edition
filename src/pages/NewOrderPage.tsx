import { Html5Qrcode } from "html5-qrcode";
import {
  Camera,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Minus,
  Plus,
  Search,
  ShoppingCart,
  Timer,
  Utensils,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  checkInCustomerToResource,
} from "../services/resources";
import {
  createOrder,
  getOrderItemImageUrl,
  listOrderMenu,
  listOrderVisits,
  searchOrderCustomers,
  type OrderCustomerCandidate,
  type NewOrderResult,
  type OrderMenuCategory,
  type OrderMenuItem,
} from "../services/newOrders";
import type { PosVisit } from "../services/pointOfSale";
import { getSupabaseClient } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import { useBranding } from "../hooks/useBranding";
import { TimerWidget } from "../components/TimerWidget";
import { CustomerPaymentDialog } from "./CustomerCheckoutPage";
import { orderSchema } from "../lib/validationSchemas";
import { getCameraErrorDetails } from "../lib/cameraErrors";

type CartLine = {
  itemId: string;
  quantity: number;
  note: string;
};

type ScanCustomer = {
  id: string;
  code: string;
  first_name: string;
  last_name: string;
};

type OrderRouteState = {
  customerId?: string;
};

const inputClass =
  "min-w-0 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white";
const buttonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800";

function getErrorKey(cause: unknown): string {
  const message =
    cause && typeof cause === "object" && "message" in cause
      ? String(cause.message).toLowerCase()
      : cause instanceof Error
        ? cause.message.toLowerCase()
        : "";
  if (message.includes("customer not checked in")) return "ordersNew.errors.notCheckedIn";
  if (message.includes("open customer visit not found")) return "ordersNew.errors.notCheckedIn";
  if (message.includes("already checked in")) return "ordersNew.errors.alreadyCheckedIn";
  if (message.includes("customer not allowed to enter")) {
    return "ordersNew.errors.customerNotAllowed";
  }
  if (message.includes("active menu item") || message.includes("not available")) {
    return "ordersNew.errors.itemUnavailable";
  }
  if (message.includes("insufficient inventory")) {
    return "ordersNew.errors.insufficientInventory";
  }
  if (message.includes("menu item has no inventory recipe")) {
    return "ordersNew.errors.recipeMissing";
  }
  if (message.includes("discount not allowed") || message.includes("not allowed")) {
    return "ordersNew.errors.notAllowed";
  }
  if (message.includes("discount")) return "ordersNew.errors.discount";
  if (message.includes("open shift required")) return "ordersNew.errors.openShiftRequired";
  if (cause && typeof cause === "object" && "code" in cause) {
    if (cause.code === "42501") return "ordersNew.errors.notAllowed";
  }
  return "ordersNew.errors.requestFailed";
}

function getCameraErrorKey(cause: unknown): string {
  return getCameraErrorDetails(cause).key;
}

function formatClock(seconds: number): string {
  const total = Math.abs(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${rest.toString().padStart(2, "0")}`;
}

export function NewOrderPage() {
  const { i18n, t } = useTranslation();
  const { permissions } = useAuth();
  const { settings: branding } = useBranding();
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = location.state as OrderRouteState | null;
  const cameraId = "new-order-camera-reader";
  const cameraRef = useRef<Html5Qrcode | null>(null);
  const resolveScanRef = useRef<(value: string) => Promise<void>>(async () => undefined);
  const lastScannedRef = useRef({ value: "", at: 0 });
  const [categories, setCategories] = useState<OrderMenuCategory[]>([]);
  const [items, setItems] = useState<OrderMenuItem[]>([]);
  const [visits, setVisits] = useState<PosVisit[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<OrderCustomerCandidate[]>([]);
  const [notInsideCustomer, setNotInsideCustomer] = useState<ScanCustomer | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderNote, setOrderNote] = useState("");
  const [discount, setDiscount] = useState("0");
  const [discountReason, setDiscountReason] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [scanMessage, setScanMessage] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<NewOrderResult | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [currency, setCurrency] = useState("EGP");
  const [serverOffset, setServerOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const canDiscount =
    permissions.includes("orders.discount") ||
    permissions.includes("discounts.apply");
  const canViewOrders = permissions.includes("orders.view");
  const isArabic = i18n.language.startsWith("ar");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [menu, openVisits, settings] = await Promise.all([
        listOrderMenu(),
        listOrderVisits(),
        getSupabaseClient().rpc("get_pos_settings"),
      ]);
      if (settings.error) throw settings.error;
      setCategories(menu.categories);
      setItems(menu.items);
      setVisits(openVisits);
      const settingsRow = settings.data && typeof settings.data === "object"
        ? settings.data as Record<string, unknown>
        : {};
      if (typeof settingsRow.currency === "string") setCurrency(settingsRow.currency);
      if (typeof settingsRow.server_now === "string") {
        setServerOffset(Date.parse(settingsRow.server_now) - Date.now());
      }
      setSelectedCategoryId((current) =>
        current && menu.categories.some((category) => category.id === current)
          ? current
          : menu.categories[0]?.id ?? "",
      );
      if (routeState?.customerId) {
        setSelectedCustomerId(routeState.customerId);
      }
    } catch (cause) {
      setError(getErrorKey(cause));
    } finally {
      setLoading(false);
    }
  }, [routeState?.customerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const timerId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    const query = customerQuery.trim();
    if (query.length < 2) {
      setCustomerResults([]);
      return;
    }
    let active = true;
    const timeoutId = window.setTimeout(() => {
      void searchOrderCustomers(query)
        .then((result) => {
          if (active) setCustomerResults(result);
        })
        .catch((cause: unknown) => {
          if (active) setError(getErrorKey(cause));
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [customerQuery]);

  useEffect(() => {
    if (!cameraOpen) return;
    let cancelled = false;
    let activeScanner: Html5Qrcode | null = null;
    const start = async () => {
      if (!window.isSecureContext) {
        setScanMessage(t("scan.camera.secureContext"));
        setCameraOpen(false);
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setScanMessage(t("scan.camera.unsupported"));
        setCameraOpen(false);
        return;
      }

      const constraints: Array<string | MediaTrackConstraints> = [
        { facingMode: { ideal: "environment" } },
      ];
      let lastError: unknown = null;

      for (let index = 0; index < constraints.length; index += 1) {
        if (cancelled) return;
        const constraint = constraints[index];
        const scanner = new Html5Qrcode(cameraId);
        activeScanner = scanner;
        cameraRef.current = scanner;
        try {
          await scanner.start(
            constraint,
           { fps: 10, qrbox: { width: 240, height: 180 } },
            (decodedText) => {
              if (!cancelled) {
                setScanValue(decodedText);
                void resolveScanRef.current(decodedText);
              }
            },
            () => undefined,
          );
          if (cancelled && scanner.isScanning) await scanner.stop();
          return;
        } catch (cause) {
          lastError = cause;
          if (scanner.isScanning) await scanner.stop().catch(() => undefined);
          try {
            scanner.clear();
          } catch {
            // A failed camera start may leave no scanner UI to clear.
          }
          if (index === 0 && !cancelled) {
            try {
              const cameras = await Html5Qrcode.getCameras();
              const preferred = [
                ...cameras.filter((camera) => /rear|back|environment/i.test(camera.label)),
                ...cameras.filter((camera) => !/rear|back|environment/i.test(camera.label)),
              ];
              constraints.push(...preferred.map((camera) => ({
                deviceId: { exact: camera.id },
              })));
            } catch {
              // Preserve the original camera startup error if device discovery fails.
            }
          }
        }
      }

      if (!cancelled) {
        setScanMessage(t(getCameraErrorKey(lastError)));
        setCameraOpen(false);
      }
    };
    const startPromise = start();
    return () => {
      cancelled = true;
      void startPromise.finally(async () => {
        if (activeScanner) {
          if (activeScanner.isScanning) await activeScanner.stop().catch(() => undefined);
          try {
            activeScanner.clear();
          } catch {
            // The scanner container may already have been cleared during unmount.
          }
        }
      });
      cameraRef.current = null;
    };
  }, [cameraOpen, cameraId, t]);

  const selectedVisit = visits.find((visit) => visit.customer_id === selectedCustomerId);
  const activeItems = useMemo(
    () => items.filter((item) => item.active && item.category_id === selectedCategoryId),
    [items, selectedCategoryId],
  );
  const visibleItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return activeItems;
    return activeItems.filter((item) =>
      `${item.name_en} ${item.name_ar} ${item.description ?? ""}`
        .toLocaleLowerCase()
        .includes(term),
    );
  }, [activeItems, search]);
  const timerSeconds = selectedVisit
    ? Math.floor(
        (Date.parse(selectedVisit.deadline) - (now + serverOffset)) / 1000,
      )
    : null;
  const estimatedTotal = cart.reduce((total, line) => {
    const item = items.find((candidate) => candidate.id === line.itemId);
    return total + (item?.price ?? 0) * line.quantity;
  }, 0);
  const discountAmount = canDiscount
    ? Math.min(estimatedTotal, Math.max(0, Number(discount) || 0))
    : 0;
  const previewTotal = Math.max(0, estimatedTotal - discountAmount);
  const formatMoney = (amount: number, currencyCode = currency) =>
    new Intl.NumberFormat(isArabic ? "ar-EG" : "en", {
      style: "currency",
      currency: currencyCode,
    }).format(amount);

  const selectVisit = (visit: PosVisit) => {
    setSelectedCustomerId(visit.customer_id);
    setNotInsideCustomer(null);
    setScanMessage("");
    setError("");
  };

  const resolveScan = useCallback(async (value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    const previous = lastScannedRef.current;
    const currentTime = Date.now();
    if (
      previous.value.toLowerCase() === normalized.toLowerCase() &&
      currentTime - previous.at < 3000
    ) return;
    lastScannedRef.current = { value: normalized, at: currentTime };
    setScanMessage("");
    setError("");
    try {
      const { data, error: scanError } = await getSupabaseClient().rpc(
        "scan_customer",
        { p_input: normalized },
      );
      if (scanError) throw scanError;
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Customer scan response was invalid.");
      }
      const result = data as Record<string, unknown>;
      if (result.ok !== true || !result.customer || typeof result.customer !== "object") {
        setScanMessage(t(`scan.messages.${String(result.reason ?? "unknown")}`));
        return;
      }
      const customer = result.customer as Record<string, unknown>;
      if (
        typeof customer.id !== "string" ||
        typeof customer.code !== "string" ||
        typeof customer.first_name !== "string" ||
        typeof customer.last_name !== "string"
      ) {
        throw new Error("Customer scan response was invalid.");
      }
      const insideVisit = visits.find((visit) => visit.customer_id === customer.id);
      if (insideVisit) {
        selectVisit(insideVisit);
      } else {
        setSelectedCustomerId("");
        setNotInsideCustomer({
          id: customer.id,
          code: customer.code,
          first_name: customer.first_name,
          last_name: customer.last_name,
        });
        setScanMessage("");
      }
    } catch (cause) {
      setScanMessage(
        getErrorKey(cause) === "ordersNew.errors.notAllowed"
          ? t("ordersNew.errors.scannerPermission")
          : t(getErrorKey(cause)),
      );
    }
  }, [t, visits]);
  resolveScanRef.current = resolveScan;

  const addItem = (item: OrderMenuItem) => {
    if (!item.available || !item.active) return;
    setCart((current) => {
      const existing = current.find((line) => line.itemId === item.id);
      if (existing) {
        return current.map((line) =>
          line.itemId === item.id
            ? { ...line, quantity: Math.min(50, line.quantity + 1) }
            : line,
        );
      }
      return [...current, { itemId: item.id, quantity: 1, note: "" }];
    });
  };

  const checkCustomerIn = async () => {
    if (!notInsideCustomer) return;
    setBusy(true);
    setError("");
    try {
      await checkInCustomerToResource(notInsideCustomer.id, null);
      const openVisits = await listOrderVisits();
      setVisits(openVisits);
      setSelectedCustomerId(notInsideCustomer.id);
      setNotInsideCustomer(null);
      setScanMessage(t("ordersNew.customerCheckedIn"));
    } catch (cause) {
      setError(getErrorKey(cause));
    } finally {
      setBusy(false);
    }
  };

  const submitOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedVisit || busy) return;
    const parsed = orderSchema.safeParse({
      customerId: selectedVisit.customer_id,
      items: cart.map((line) => ({
        menu_item_id: line.itemId,
        quantity: line.quantity,
        note: line.note,
      })),
      note: orderNote,
      discount: canDiscount ? Number(discount) : 0,
      discountReason,
    });
    if (!parsed.success) {
      setError("ordersNew.errors.validation");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await createOrder({
        customerId: parsed.data.customerId,
        items: parsed.data.items,
        note: parsed.data.note,
        discount: parsed.data.discount,
        discountReason: parsed.data.discountReason,
      });
      setSuccess(result);
    } catch (cause) {
      setError(getErrorKey(cause));
    } finally {
      setBusy(false);
    }
  };

  const resetOrder = () => {
    setSuccess(null);
    setSelectedCustomerId("");
    setCart([]);
    setOrderNote("");
    setDiscount("0");
    setDiscountReason("");
    setCustomerQuery("");
    setNotInsideCustomer(null);
    setScanValue("");
    setScanMessage("");
    navigate("/orders/new", { replace: true, state: null });
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

  if (success) {
    const customer = visits.find((visit) => visit.customer_id === selectedCustomerId);
    const ticketDate = new Intl.DateTimeFormat(isArabic ? "ar-EG" : "en-EG", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(success.server_now));
    return (
      <>
        <div className="mx-auto w-full max-w-3xl p-4 sm:p-6 lg:p-8">
          <section className="rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm dark:border-emerald-900 dark:bg-slate-900 sm:p-8">
          <div className="flex items-start gap-4">
            <CheckCircle2 aria-hidden="true" className="mt-1 shrink-0 text-emerald-600 dark:text-emerald-400" size={32} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{t("ordersNew.successTitle")}</p>
              <h1 className="mt-1 text-3xl font-bold text-ink dark:text-white">
                {t("ordersNew.orderNumber", { number: success.order_number })}
              </h1>
              <p className="mt-2 text-slate-600 dark:text-slate-300">
                {customer?.customer_name ?? ""}
              </p>
              <p className="mt-4 text-2xl font-bold text-ink dark:text-white">
                {formatMoney(success.total, success.currency)}
              </p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {t(success.timer_restarted ? "ordersNew.timerRestarted" : "ordersNew.timerNotRestarted")}
              </p>
              <ul className="mt-5 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                {success.items.map((item, index) => (
                  <li className="flex flex-wrap justify-between gap-2 text-sm" key={`${item.name_en}-${index}`}>
                    <span>{isArabic ? item.name_ar : item.name_en} × {item.quantity}{item.note ? ` — ${item.note}` : ""}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-wrap gap-3 print:hidden">
                <button className={buttonClass} onClick={resetOrder} type="button">{t("ordersNew.newOrder")}</button>
                {permissions.includes("payments.collect") && selectedCustomerId && (
                  <button className={secondaryButton} onClick={() => setPaymentDialogOpen(true)} type="button">
                    {t("ordersNew.collectPayment")}
                  </button>
                )}
                <button className={secondaryButton} onClick={printTicket} type="button">{t("ordersNew.printTicket")}</button>
              </div>
            </div>
          </div>
          </section>
        </div>
        {createPortal(
          <div aria-hidden="true" className="order-ticket" dir={isArabic ? "rtl" : "ltr"}>
            <header className="ticket-brand">
              {branding.logoUrl && (
                <img alt="" className="ticket-logo" src={branding.logoUrl} />
              )}
              <p className="ticket-brand-name">{branding.workspaceName}</p>
              <p className="ticket-subtitle">{t("ordersNew.ticketTitle")}</p>
            </header>

            <section className="ticket-order-heading">
              <p className="ticket-order-number">
                {t("ordersNew.orderNumber", { number: success.order_number })}
              </p>
              <p className="ticket-order-date">{ticketDate}</p>
              <p className="ticket-order-status">{t("ordersNew.ticketStatus")}</p>
            </section>

            <section className="ticket-customer">
              <p><strong>{t("ordersNew.ticketCustomer")}:</strong> {customer?.customer_name}</p>
              <p><strong>{t("ordersNew.ticketCode")}:</strong> {customer?.customer_code}</p>
              {customer?.resource_name && (
                <p><strong>{t("ordersNew.ticketResource")}:</strong> {customer.resource_name}</p>
              )}
              {customer && (
                <p>
                  <strong>{t("ordersNew.ticketVisit")}:</strong>{" "}
                  {new Intl.DateTimeFormat(isArabic ? "ar-EG" : "en-EG", {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(customer.checked_in_at))}
                </p>
              )}
            </section>

            <section className="ticket-items">
              <h2>{t("ordersNew.ticketItems")}</h2>
              {success.items.map((item, index) => (
                <div className="ticket-item" key={`ticket-${index}`}>
                  <p className="ticket-item-main">
                    <span>{isArabic ? item.name_ar : item.name_en}</span>
                    <strong>× {item.quantity}</strong>
                  </p>
                  {item.note && <p className="ticket-item-note">{item.note}</p>}
                </div>
              ))}
            </section>

            {orderNote.trim() && (
              <section className="ticket-note">
                <strong>{t("ordersNew.ticketOrderNote")}:</strong> {orderNote.trim()}
              </section>
            )}
            {success.discount_total > 0 && discountReason.trim() && (
              <section className="ticket-note">
                <strong>{t("ordersNew.ticketDiscountReason")}:</strong> {discountReason.trim()}
              </section>
            )}

            <section className="ticket-totals">
              <p><span>{t("ordersNew.ticketSubtotal")}</span><span>{formatMoney(success.subtotal, success.currency)}</span></p>
              {success.discount_total > 0 && (
                <p><span>{t("ordersNew.ticketDiscount")}</span><span>−{formatMoney(success.discount_total, success.currency)}</span></p>
              )}
              <p><span>{t("ordersNew.ticketService")}</span><span>{formatMoney(success.service_amount, success.currency)}</span></p>
              <p><span>{t("ordersNew.ticketTax")}</span><span>{formatMoney(success.tax_amount, success.currency)}</span></p>
              <p className="ticket-grand-total">
                <strong>{t("ordersNew.ticketTotal")}</strong>
                <strong>{formatMoney(success.total, success.currency)}</strong>
              </p>
            </section>
            <footer className="ticket-footer">{t("ordersNew.ticketFooter")}</footer>
          </div>,
          document.body,
        )}
        {paymentDialogOpen && selectedCustomerId && (
          <CustomerPaymentDialog
            customerId={selectedCustomerId}
            onClose={() => setPaymentDialogOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-brand">{t("ordersNew.eyebrow")}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink dark:text-white">{t("ordersNew.title")}</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t("ordersNew.description")}</p>
        </div>
        {selectedVisit && (
          <div className={`flex items-center gap-2 rounded-2xl border px-4 py-3 ${
            timerSeconds !== null && timerSeconds <= 0
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
              : "border-slate-200 bg-white text-ink dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          }`}>
            <Timer aria-hidden="true" size={19} />
            <div>
              <p className="text-xs">{timerSeconds !== null && timerSeconds <= 0 ? t("ordersNew.overdue") : t("ordersNew.timeLeft")}</p>
              <p className="font-mono text-lg font-bold tabular-nums">
                {timerSeconds !== null && timerSeconds < 0 ? "+" : ""}
                {timerSeconds === null ? "--:--:--" : formatClock(timerSeconds)}
              </p>
            </div>
          </div>
        )}
        {canViewOrders && (
          <nav aria-label={t("ordersNew.quickNavigation")} className="flex flex-wrap gap-2">
            <Link className={secondaryButton} to="/orders">{t("layout.navigation.ordersList")}</Link>
            <Link className={secondaryButton} to="/orders/board">{t("layout.navigation.ordersBoard")}</Link>
            <Link className={secondaryButton} to="/pos">{t("layout.navigation.pos")}</Link>
          </nav>
        )}
      </header>

      <ol aria-label={t("ordersNew.steps.label")} className="grid gap-2 sm:grid-cols-3">
        {([
          ["customer", selectedVisit ? "complete" : "current"],
          ["menu", selectedVisit ? cart.length > 0 ? "complete" : "current" : "upcoming"],
          ["review", selectedVisit && cart.length > 0 ? "current" : "upcoming"],
        ] as const).map(([step, status], index) => (
          <li
            className={`flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold ${
              status === "complete"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
                : status === "current"
                  ? "border-brand/40 bg-brand/5 text-ink dark:text-white"
                  : "border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
            }`}
            key={step}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-base font-bold dark:bg-slate-950">
              {status === "complete" ? <CheckCircle2 aria-hidden="true" size={18} /> : index + 1}
            </span>
            {t(`ordersNew.steps.${step}`)}
          </li>
        ))}
      </ol>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert">
          <p>{t(error)}</p>
          {error === "ordersNew.errors.openShiftRequired" && canViewOrders && (
            <Link className="mt-2 inline-flex min-h-10 items-center font-semibold underline underline-offset-2" to="/pos">
              {t("ordersNew.goToShifts")}
            </Link>
          )}
        </div>
      )}
      {scanMessage && <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status">{scanMessage}</p>}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <Clock3 aria-hidden="true" className="text-brand" size={19} />
              <h2 className="text-lg font-semibold text-ink dark:text-white">{t("ordersNew.customerTitle")}</h2>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <label className="block text-sm font-medium">{t("ordersNew.searchCustomer")}
                  <div className="relative">
                    <Search aria-hidden="true" className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                    <input className={`${inputClass} ps-10`} onChange={(event) => setCustomerQuery(event.target.value)} placeholder={t("ordersNew.searchPlaceholder")} value={customerQuery} />
                  </div>
                </label>
                {customerResults.length > 0 && (
                  <ul className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-700">
                    {customerResults.map((customer) => {
                      const visit = visits.find((entry) => entry.customer_id === customer.id);
                      return (
                        <li key={customer.id}>
                          <button className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800" onClick={() => visit ? selectVisit(visit) : setNotInsideCustomer(customer)} type="button">
                            <span className="min-w-0 truncate font-medium">{customer.first_name} {customer.last_name} · {customer.code}</span>
                            <span className={`shrink-0 text-xs ${visit ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>{visit ? t("ordersNew.inside") : t("ordersNew.notCheckedIn")}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void resolveScan(scanValue); }}>
                  <label className="sr-only" htmlFor="order-customer-code">{t("ordersNew.scanCode")}</label>
                  <input autoComplete="off" className={inputClass} id="order-customer-code" onChange={(event) => setScanValue(event.target.value)} placeholder={t("ordersNew.scanCode")} value={scanValue} />
                  <button aria-label={t("ordersNew.findCustomer")} className={secondaryButton} type="submit"><Search size={17} /></button>
                  <button aria-label={t(cameraOpen ? "ordersNew.stopCamera" : "ordersNew.startCamera")} className={secondaryButton} onClick={() => setCameraOpen((open) => !open)} type="button"><Camera size={17} /></button>
                </form>
                {cameraOpen && <div className="overflow-hidden rounded-xl bg-black"><div className="min-h-48 w-full" id={cameraId} /></div>}
                {notInsideCustomer && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                    <p className="font-semibold">{t("ordersNew.customerMustBeInside", { name: `${notInsideCustomer.first_name} ${notInsideCustomer.last_name}` })}</p>
                    <button className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-amber-700 px-3 py-2 font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void checkCustomerIn()} type="button">
                      {busy && <LoaderCircle className="me-2 animate-spin" size={16} />}
                      {t("ordersNew.checkInCustomer")}
                    </button>
                  </div>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-ink dark:text-white">{t("ordersNew.insideNow")}</h3>
                {loading ? (
                  <p className="py-3 text-sm text-slate-500">{t("ordersNew.loading")}</p>
                ) : visits.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-950">{t("ordersNew.noOneInside")}</p>
                ) : (
                  <ul className="max-h-56 space-y-1 overflow-y-auto">
                    {visits.map((visit) => (
                      <li key={visit.checkin_id}>
                        <button className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-start transition hover:bg-emerald-50 dark:hover:bg-emerald-950/30 ${selectedCustomerId === visit.customer_id ? "bg-emerald-50 ring-1 ring-emerald-300 dark:bg-emerald-950/30 dark:ring-emerald-800" : "bg-slate-50 dark:bg-slate-950"}`} onClick={() => selectVisit(visit)} type="button">
                          <span className="min-w-0"><span className="block truncate text-sm font-semibold">{visit.customer_name}</span><span className="text-xs text-slate-500">{visit.customer_code}</span></span>
                          {selectedCustomerId === visit.customer_id && <CheckCircle2 className="shrink-0 text-emerald-600" size={18} />}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            {selectedVisit && (
              <>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-emerald-900 dark:text-emerald-200">{selectedVisit.customer_name}</p>
                    <p className="text-sm text-emerald-800 dark:text-emerald-300">{selectedVisit.customer_code}</p>
                  </div>
                  <button aria-label={t("ordersNew.clearCustomer")} className="rounded-lg p-2 text-emerald-800 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900" onClick={() => setSelectedCustomerId("")} type="button"><X size={17} /></button>
                </div>
                <div className="mt-3">
                  <TimerWidget
                    checkinId={selectedVisit.checkin_id}
                    enabled={permissions.includes("timers.view")}
                  />
                </div>
              </>
            )}
          </section>

          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-ink dark:text-white">{t("ordersNew.menuTitle")}</h2>
              <label className="relative block w-full sm:max-w-xs">
                <span className="sr-only">{t("ordersNew.searchMenu")}</span>
                <Search aria-hidden="true" className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                <input className={`${inputClass} ps-10`} onChange={(event) => setSearch(event.target.value)} placeholder={t("ordersNew.searchMenu")} value={search} />
              </label>
            </div>
            <div aria-label={t("ordersNew.categories")} className="mb-4 flex gap-2 overflow-x-auto pb-2" role="tablist">
              {categories.map((category) => (
                <button aria-selected={selectedCategoryId === category.id} className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-semibold transition ${selectedCategoryId === category.id ? "bg-brand text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"}`} key={category.id} onClick={() => setSelectedCategoryId(category.id)} role="tab" type="button">
                  {isArabic ? category.name_ar : category.name_en}
                </button>
              ))}
            </div>
            {loading ? (
              <p className="py-8 text-center text-sm text-slate-500">{t("ordersNew.loading")}</p>
            ) : visibleItems.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">{t("ordersNew.noItems")}</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
                {visibleItems.map((item) => (
                  <button className={`group flex min-h-44 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 text-start transition hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-md disabled:cursor-not-allowed disabled:grayscale dark:border-slate-800 ${item.available ? "bg-white dark:bg-slate-950" : "bg-slate-100 opacity-55 dark:bg-slate-800"}`} disabled={!item.available} key={item.id} onClick={() => addItem(item)} type="button">
                    {item.image_path ? <img alt="" className="h-24 w-full object-cover" src={getOrderItemImageUrl(item.image_path)} /> : <div className="flex h-24 items-center justify-center bg-slate-100 text-slate-400 dark:bg-slate-800"><Utensils aria-hidden="true" size={25} /></div>}
                    <span className="flex min-w-0 flex-1 flex-col p-3">
                      <span className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-sm font-semibold text-ink dark:text-white">{isArabic ? item.name_ar : item.name_en}</span>
                        {!item.qualifies_for_time && <span aria-label={t("ordersNew.noTimerReset")} className="shrink-0 rounded-full bg-slate-100 p-1 text-slate-500 dark:bg-slate-800" title={t("ordersNew.noTimerReset")}><Clock3 size={13} /></span>}
                      </span>
                      <span className="mt-auto pt-2 text-sm font-bold text-brand">{formatMoney(item.price)}</span>
                      {!item.available && <span className="mt-1 text-xs font-medium text-slate-500">{t("ordersNew.unavailable")}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="min-w-0">
          <form className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 xl:sticky xl:top-20" onSubmit={(event) => void submitOrder(event)}>
            <div className="flex items-center gap-2">
              <ShoppingCart aria-hidden="true" className="text-brand" size={19} />
              <h2 className="text-lg font-semibold text-ink dark:text-white">{t("ordersNew.cart")}</h2>
              <span className="ms-auto rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold dark:bg-slate-800">{cart.reduce((sum, line) => sum + line.quantity, 0)}</span>
            </div>
            {cart.length === 0 ? (
              <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-950">{t("ordersNew.emptyCart")}</p>
            ) : (
              <ul className="max-h-[36vh] space-y-3 overflow-y-auto">
                {cart.map((line) => {
                  const item = items.find((candidate) => candidate.id === line.itemId);
                  if (!item) return null;
                  return (
                    <li className="rounded-xl border border-slate-200 p-3 dark:border-slate-800" key={line.itemId}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0"><p className="truncate text-sm font-semibold">{isArabic ? item.name_ar : item.name_en}</p><p className="text-xs text-slate-500">{formatMoney(item.price)}</p></div>
                        <button aria-label={`${t("ordersNew.removeItem")}: ${isArabic ? item.name_ar : item.name_en}`} className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40" onClick={() => setCart((current) => current.filter((entry) => entry.itemId !== line.itemId))} type="button"><X size={16} /></button>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <button aria-label={t("ordersNew.decreaseQuantity")} className="size-9 rounded-lg border border-slate-300 dark:border-slate-700" onClick={() => setCart((current) => current.map((entry) => entry.itemId === line.itemId ? { ...entry, quantity: Math.max(1, entry.quantity - 1) } : entry))} type="button"><Minus className="mx-auto" size={15} /></button>
                        <span className="min-w-8 text-center font-mono font-semibold tabular-nums">{line.quantity}</span>
                        <button aria-label={t("ordersNew.increaseQuantity")} className="size-9 rounded-lg border border-slate-300 disabled:opacity-50 dark:border-slate-700" disabled={line.quantity >= 50} onClick={() => setCart((current) => current.map((entry) => entry.itemId === line.itemId ? { ...entry, quantity: Math.min(50, entry.quantity + 1) } : entry))} type="button"><Plus className="mx-auto" size={15} /></button>
                        <input aria-label={t("ordersNew.itemNote")} className={`${inputClass} py-2`} maxLength={150} onChange={(event) => setCart((current) => current.map((entry) => entry.itemId === line.itemId ? { ...entry, note: event.target.value } : entry))} placeholder={t("ordersNew.itemNote")} value={line.note} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <label className="block text-sm font-medium">{t("ordersNew.orderNote")}<textarea className={inputClass} maxLength={500} onChange={(event) => setOrderNote(event.target.value)} rows={2} value={orderNote} /></label>
            {canDiscount && (
              <div className="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-950">
                <label className="block text-sm font-medium">{t("ordersNew.discount")}<input className={inputClass} min="0" onChange={(event) => setDiscount(event.target.value)} step="0.01" type="number" value={discount} /></label>
                {Number(discount) > 0 && <label className="block text-sm font-medium">{t("ordersNew.discountReason")}<input className={inputClass} maxLength={250} minLength={3} onChange={(event) => setDiscountReason(event.target.value)} required value={discountReason} /></label>}
              </div>
            )}
            <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
              <div className="flex justify-between gap-3 text-sm"><span className="text-slate-600 dark:text-slate-400">{t("ordersNew.previewTotal")}</span><strong>{formatMoney(previewTotal)}</strong></div>
              <p className="text-xs text-slate-500">{t("ordersNew.previewDisclaimer")}</p>
            </div>
            <button className={`${buttonClass} w-full`} disabled={busy || loading || !selectedVisit || cart.length === 0} type="submit">
              {busy ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <ShoppingCart aria-hidden="true" size={17} />}
              {t("ordersNew.submit")}
            </button>
            {!selectedVisit && <p className="text-center text-xs text-slate-500">{t("ordersNew.selectCustomerFirst")}</p>}
          </form>
        </aside>
      </section>
    </div>
  );
}
