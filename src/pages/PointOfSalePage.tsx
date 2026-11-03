import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { z } from "zod";
import { useAuth } from "../hooks/useAuth";
import {
  getBusinessDate,
  getShiftScheduleData,
  type ShiftAssignment,
} from "../services/shifts";
import {
  cancelPosOrder,
  closePosShift,
  completePosOrder,
  createPosOrder,
  getCurrentPosShift,
  getPosSettings,
  listOpenPosOrders,
  listOpenPosVisits,
  listPosProducts,
  listTimerFees,
  listVisitFees,
  openPosShift,
  payTimerFee,
  payVisitFee,
  setPosOrderStatus,
  waiveTimerFee,
  waiveVisitFee,
  type PosProduct,
  type PosReceipt,
  type PosSettings,
  type PosShift,
  type VisitFee,
} from "../services/pointOfSale";

type Tab = "orders" | "fees";
type CartLine = { productId: string; quantity: string };

const orderSchema = z.object({
  checkinId: z.coerce.number().int().positive(),
  quantities: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.coerce.number().int().min(1).max(50),
  })).min(1).max(50),
});

const cashSchema = z.coerce.number().finite().min(0).max(100_000_000);

const inputClass =
  "min-w-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white";
const buttonClass =
  "rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function errorKey(cause: unknown): string {
  const message = isRecord(cause) && typeof cause.message === "string"
    ? cause.message.toLowerCase()
    : cause instanceof Error
      ? cause.message.toLowerCase()
      : "";
  if (typeof cause === "string" && cause.startsWith("pos.errors.")) return cause;
  if (message.includes("shift has pending orders or fees")) return "pos.errors.shiftHasPending";
  if (message.includes("order must be served")) return "pos.errors.orderMustBeServed";
  if (message.includes("invalid order status transition")) return "pos.errors.invalidStatusTransition";
  if (message.includes("active menu item")) return "pos.errors.menuItemUnavailable";
  if (message.includes("shift already open")) return "pos.errors.shiftAlreadyOpen";
  if (message.includes("choose assigned shift")) return "pos.errors.chooseScheduledShift";
  if (message.includes("shift is not assigned")) return "pos.errors.shiftNotAssigned";
  if (message.includes("open shift required")) return "pos.errors.openShiftRequired";
  if (message.includes("currency cannot be changed while a shift is open")) {
    return "pos.errors.currencyLockedByShift";
  }
  if (message.includes("discount")) return "pos.errors.discount";
  if (message.includes("reason")) return "pos.errors.reason";
  if (message.includes("receipt already voided")) return "pos.errors.receiptAlreadyVoided";
  if (message.includes("unpaid active fee")) return "pos.errors.feeUnavailable";
  return "pos.errors.requestFailed";
}

export function PointOfSalePage() {
  const { i18n, t } = useTranslation();
  const { permissions, profile } = useAuth();
  const location = useLocation();
  const locationState = isRecord(location.state) ? location.state : {};
  const [tab, setTab] = useState<Tab>(() =>
    locationState.tab === "fees" ? "fees" : "orders",
  );
  const [settings, setSettings] = useState<PosSettings | null>(null);
  const [shift, setShift] = useState<PosShift | null>(null);
  const [scheduleAssignments, setScheduleAssignments] = useState<ShiftAssignment[]>([]);
  const [selectedScheduleShift, setSelectedScheduleShift] = useState("");
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [visits, setVisits] = useState<Awaited<ReturnType<typeof listOpenPosVisits>>>([]);
  const [orders, setOrders] = useState<Awaited<ReturnType<typeof listOpenPosOrders>>>([]);
  const [fees, setFees] = useState<VisitFee[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openingCash, setOpeningCash] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [selectedCheckin, setSelectedCheckin] = useState(
    typeof locationState.checkinId === "number" ? String(locationState.checkinId) : "",
  );
  const [cart, setCart] = useState<CartLine[]>([{ productId: "", quantity: "1" }]);
  const [cancelReasons, setCancelReasons] = useState<Record<string, string>>({});
  const [waiverReasons, setWaiverReasons] = useState<Record<string, string>>({});
  const [feePaymentMethods, setFeePaymentMethods] = useState<Record<string, PosReceipt["payment_method"]>>({});
  const [orderPaymentMethods, setOrderPaymentMethods] = useState<Record<string, PosReceipt["payment_method"]>>({});

  const canManageOrders = permissions.includes("orders.manage");
  const canCreateOrders = canManageOrders || permissions.includes("orders.create");
  const canUpdateOrderStatus = canManageOrders || permissions.includes("orders.update_status");
  const canCancelOrders = canManageOrders || permissions.includes("orders.cancel");
  const canManageShifts = permissions.includes("shifts.manage");
  const canUseScheduledShifts = canManageShifts || permissions.includes("shifts.use");
  const canUseShift = !settings?.require_open_shift || Boolean(shift);
  const canWaiveFees = permissions.includes("fees.manage") || permissions.includes("fees.waive");
  const canWaiveTimerFees = permissions.includes("fees.waive");
  const canViewFees =
    canManageOrders ||
    canWaiveFees ||
    permissions.includes("checkins.manage") ||
    permissions.includes("fees.view");
  const focusCustomerId =
    typeof locationState.customerId === "string" ? locationState.customerId : "";
  const currentLocale = i18n.language === "ar" ? "ar-EG" : i18n.language;

  const refresh = useCallback(async () => {
    setError("");
    try {
      const nextSettings = await getPosSettings();
      const businessDate = getBusinessDate(nextSettings.timezone);
      const [
        shiftResponse,
        scheduleResponse,
        nextProducts,
        nextVisits,
        nextOrders,
        nextFees,
        nextTimerFees,
      ] = await Promise.all([
        canUseScheduledShifts ? getCurrentPosShift() : Promise.resolve({ shift: null, serverNow: "" }),
        canUseScheduledShifts
          ? getShiftScheduleData(businessDate, businessDate)
          : Promise.resolve(null),
        listPosProducts(),
        canCreateOrders ? listOpenPosVisits() : Promise.resolve([]),
        listOpenPosOrders(),
        canManageOrders ||
        permissions.includes("fees.manage") ||
        permissions.includes("checkins.manage")
          ? listVisitFees()
          : Promise.resolve([]),
        canManageOrders || permissions.includes("fees.view") || canWaiveTimerFees
          ? listTimerFees()
          : Promise.resolve([]),
      ]);
      setSettings(nextSettings);
      setShift(shiftResponse.shift);
      const activeScheduleIds = new Set(
        (scheduleResponse?.shifts ?? [])
          .filter((scheduledShift) => scheduledShift.active)
          .map((scheduledShift) => scheduledShift.id),
      );
      const todaysAssignments = (scheduleResponse?.assignments ?? [])
        .filter((assignment) =>
          assignment.user_id === profile?.id && activeScheduleIds.has(assignment.shift_id),
        );
      setScheduleAssignments(todaysAssignments);
      setSelectedScheduleShift((current) => {
        const openShiftScheduleId = shiftResponse.shift?.schedule_shift_id;
        if (openShiftScheduleId) return openShiftScheduleId;
        if (current && todaysAssignments.some((assignment) => assignment.shift_id === current)) {
          return current;
        }
        return todaysAssignments.length === 1 ? todaysAssignments[0].shift_id : "";
      });
      setProducts(nextProducts);
      setVisits(nextVisits);
      setOrders(nextOrders);
      setFees([...nextFees, ...nextTimerFees].sort(
        (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
      ));
    } catch (cause) {
      setError(t(errorKey(cause)));
    } finally {
      setLoading(false);
    }
  }, [
    canCreateOrders,
    canManageOrders,
    canManageShifts,
    canUseScheduledShifts,
    canWaiveFees,
    permissions,
    profile?.id,
    t,
  ]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeProducts = useMemo(
    () => products.filter((product) => product.active && product.available),
    [products],
  );
  const selectedVisit = visits.find(
    (visit) => visit.checkin_id === Number(selectedCheckin),
  );

  const formatMoney = (amount: number, currency = settings?.currency ?? "EGP") => {
    try {
      return new Intl.NumberFormat(currentLocale, {
        style: "currency",
        currency,
      }).format(amount);
    } catch (cause) {
      if (!(cause instanceof RangeError)) throw cause;
      return `${amount.toFixed(2)} ${currency}`;
    }
  };
  const formatDateTime = (value: string) =>
    new Intl.DateTimeFormat(currentLocale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: settings?.timezone ?? "Africa/Cairo",
    }).format(new Date(value));

  const createOrder = async () => {
    if (busy) return;
    const parsed = orderSchema.safeParse({
      checkinId: selectedCheckin,
      quantities: cart
        .filter((line) => line.productId)
        .map((line) => ({ productId: line.productId, quantity: line.quantity })),
    });
    if (!parsed.success || !selectedVisit) {
      setError(t("pos.errors.orderInvalid"));
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await createPosOrder({
        customerId: selectedVisit.customer_id,
        checkinId: selectedVisit.checkin_id,
        items: parsed.data.quantities.map((line) => ({
          product_id: line.productId,
          quantity: String(line.quantity),
        })),
        discountType: null,
        discountValue: 0,
        discountReason: null,
      });
      setCart([{ productId: "", quantity: "1" }]);
      setNotice(t("pos.messages.orderCreated", { number: result.order_number }));
      await refresh();
    } catch (cause) {
      setError(t(errorKey(cause)));
    } finally {
      setBusy(false);
    }
  };

  const completeExistingOrder = async (orderId: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await completePosOrder(
        orderId,
        orderPaymentMethods[orderId] ?? "cash",
      );
      setNotice(t("pos.messages.receiptIssued", { receipt: result.receipt_no }));
      await refresh();
    } catch (cause) {
      setError(t(errorKey(cause)));
    } finally {
      setBusy(false);
    }
  };

  const advanceOrder = async (
    orderId: string,
    status: "preparing" | "ready" | "served",
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await setPosOrderStatus(orderId, status);
      setNotice(t("pos.messages.orderStatusUpdated"));
      await refresh();
    } catch (cause) {
      setError(t(errorKey(cause)));
    } finally {
      setBusy(false);
    }
  };

  const cancelOrder = async (orderId: string) => {
    const reason = cancelReasons[orderId]?.trim() ?? "";
    if (reason.length < 3 || busy) {
      setError(t("pos.errors.reason"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await cancelPosOrder(orderId, reason);
      setCancelReasons((current) => ({ ...current, [orderId]: "" }));
      setNotice(t("pos.messages.orderCancelled"));
      await refresh();
    } catch (cause) {
      setError(t(errorKey(cause)));
    } finally {
      setBusy(false);
    }
  };

  const feeKey = (fee: VisitFee) => `${fee.source}:${fee.id}`;

  const performFeeWaiver = async (fee: VisitFee) => {
    const key = feeKey(fee);
    const reason = waiverReasons[key]?.trim() ?? "";
    if (reason.length < 3 || busy) {
      setError(t("pos.errors.reason"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (fee.source === "timer") {
        await waiveTimerFee(fee.id, reason);
      } else {
        await waiveVisitFee(fee.id, reason);
      }
      setWaiverReasons((current) => ({ ...current, [key]: "" }));
      setNotice(t("pos.messages.feeWaived"));
      await refresh();
    } catch (cause) {
      setError(t(errorKey(cause)));
    } finally {
      setBusy(false);
    }
  };

  const performFeePayment = async (fee: VisitFee) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const paymentMethod = feePaymentMethods[feeKey(fee)] ?? "cash";
      const result = fee.source === "timer"
        ? await payTimerFee(fee.id, paymentMethod)
        : await payVisitFee(fee.id, paymentMethod);
      setNotice(t("pos.messages.receiptIssued", { receipt: result.receipt_no }));
      await refresh();
    } catch (cause) {
      setError(t(errorKey(cause)));
    } finally {
      setBusy(false);
    }
  };

  const openShift = async () => {
    const parsed = cashSchema.safeParse(openingCash);
    if (!parsed.success || busy) {
      setError(t("pos.errors.cashInvalid"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      setShift(await openPosShift(parsed.data, selectedScheduleShift || null));
      setNotice(t("pos.messages.shiftOpened"));
      await refresh();
    } catch (cause) {
      setError(t(errorKey(cause)));
    } finally {
      setBusy(false);
    }
  };

  const closeShift = async () => {
    const parsed = cashSchema.safeParse(countedCash);
    if (!shift || !parsed.success || busy) {
      setError(t("pos.errors.cashInvalid"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const closed = await closePosShift(shift.id, parsed.data);
      setShift(null);
      setCountedCash("");
      const shiftNotice = t("pos.messages.shiftClosed", {
        expected: formatMoney(closed.expected_cash ?? 0),
        variance: formatMoney(closed.variance ?? 0),
      });
      setNotice(closed.cash_diff_alert
        ? `${shiftNotice} ${t("pos.messages.cashDifferenceAlert")}`
        : shiftNotice);
      await refresh();
    } catch (cause) {
      setError(t(errorKey(cause)));
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "orders", label: t("pos.tabs.orders") },
    ...(canViewFees ? [{ key: "fees" as const, label: t("pos.tabs.fees") }] : []),
  ];
  const displayedFees = focusCustomerId
    ? fees.filter((fee) => fee.customer_id === focusCustomerId)
    : fees;

  return (
    <section
      className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8"
      dir={i18n.dir()}
    >
      <header className="mb-6">
        <h1 className="text-3xl font-semibold text-ink dark:text-white">
          {t("pos.title")}
        </h1>
      </header>

      {error && (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" role="status">
          {notice}
        </p>
      )}

      {canUseScheduledShifts && (
      <section className={`mb-6 rounded-2xl border bg-white p-4 dark:bg-slate-900 ${shift ? "border-emerald-200 dark:border-emerald-900" : "border-amber-200 dark:border-amber-900"}`}>
        <h2 className="mb-3 text-lg font-semibold text-ink dark:text-white">{t("pos.shift.title")}</h2>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{t("pos.shift.separateHelp")}</p>
        {shift ? (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                {t("pos.shift.open")}
              </p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {t("pos.shift.openingCash")}: {formatMoney(shift.opening_cash)}
              </p>
              {shift.schedule_shift_id && (
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {t("pos.shift.scheduledAs")}: {shift.schedule_shift_name ?? scheduleAssignments.find((assignment) => assignment.shift_id === shift.schedule_shift_id)?.shift_name ?? ""}
                </p>
              )}
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("pos.shift.closeHelp")}</p>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block">{t("pos.shift.countedCash")}</span>
              <input
                className={inputClass}
                min="0"
                onChange={(event) => setCountedCash(event.target.value)}
                step="0.01"
                type="number"
                value={countedCash}
              />
            </label>
            <button className={buttonClass} disabled={busy} onClick={() => void closeShift()} type="button">
              {t("pos.shift.close")}
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 sm:items-end lg:grid-cols-[minmax(0,1fr)_minmax(180px,auto)_minmax(180px,auto)_auto]">
            <div>
              <p className="font-semibold text-ink dark:text-white">{t("pos.shift.closed")}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t("pos.shift.openHelp")}</p>
            </div>
            {scheduleAssignments.length > 0 && (
              <label className="block text-sm">
                <span className="mb-1 block">{t("pos.shift.scheduledShift")}</span>
                <select
                  className={inputClass}
                  onChange={(event) => setSelectedScheduleShift(event.target.value)}
                  value={selectedScheduleShift}
                >
                  <option value="">{t("pos.shift.chooseScheduledShift")}</option>
                  {scheduleAssignments.map((assignment) => (
                    <option key={assignment.id} value={assignment.shift_id}>
                      {assignment.shift_name} · {assignment.start_time.slice(0, 5)}–{assignment.end_time.slice(0, 5)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-sm">
              <span className="mb-1 block">{t("pos.shift.openingCash")}</span>
              <input
                className={inputClass}
                min="0"
                onChange={(event) => setOpeningCash(event.target.value)}
                placeholder={t("pos.shift.openingCashPlaceholder")}
                step="0.01"
                type="number"
                value={openingCash}
              />
            </label>
            <button className={buttonClass} disabled={busy || (scheduleAssignments.length > 1 && !selectedScheduleShift)} onClick={() => void openShift()} type="button">
              {t("pos.shift.openAction")}
            </button>
          </div>
        )}
      </section>
      )}

      <nav className="mb-5 flex flex-wrap gap-2" aria-label={t("pos.tabs.label")}>
        {tabs.map((item) => (
          <button
            aria-current={tab === item.key ? "page" : undefined}
            className={tab === item.key ? buttonClass : secondaryButtonClass}
            key={item.key}
            onClick={() => setTab(item.key)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          {t("pos.loading")}
        </div>
      ) : (
        <>
          {tab === "orders" && (
            <div className={`grid items-start gap-5 ${canCreateOrders ? "lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]" : ""}`}>
              {canCreateOrders && (
              <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="text-lg font-semibold text-ink dark:text-white">{t("pos.newOrder")}</h2>
                <label className="block text-sm">
                  <span className="mb-1 block">{t("pos.customerVisit")}</span>
                  <select
                    className={inputClass}
                    onChange={(event) => setSelectedCheckin(event.target.value)}
                    value={selectedCheckin}
                  >
                    <option value="">{t("pos.chooseVisit")}</option>
                    {visits.map((visit) => (
                      <option key={visit.checkin_id} value={visit.checkin_id}>
                        {visit.customer_name} · {visit.customer_code}
                        {visit.resource_name ? ` · ${visit.resource_name}` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="space-y-3">
                  {cart.map((line, index) => (
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]" key={index}>
                      <select
                        aria-label={t("pos.product")}
                        className={inputClass}
                        onChange={(event) => setCart((current) => current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, productId: event.target.value } : item))}
                        value={line.productId}
                      >
                        <option value="">{t("pos.chooseProduct")}</option>
                        {activeProducts.map((product) => (
                          <option key={product.id} value={product.id}>
                            {i18n.language === "ar" ? product.name_ar : product.name_en}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label={t("pos.quantity")}
                        className={inputClass}
                        min="1"
                        max="50"
                        onChange={(event) => setCart((current) => current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, quantity: event.target.value } : item))}
                        step="1"
                        type="number"
                        value={line.quantity}
                      />
                      <button
                        className={secondaryButtonClass}
                        disabled={cart.length === 1}
                        onClick={() => setCart((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        type="button"
                      >
                        {t("pos.remove")}
                      </button>
                    </div>
                  ))}
                  <button
                    className={secondaryButtonClass}
                    disabled={cart.length >= 50}
                    onClick={() => setCart((current) => [...current, { productId: "", quantity: "1" }])}
                    type="button"
                  >
                    {t("pos.addItem")}
                  </button>
                </div>

                {canCreateOrders && (
                  <button
                    className={buttonClass}
                    disabled={busy || !canUseShift || !activeProducts.length || !selectedVisit}
                    onClick={() => void createOrder()}
                    type="button"
                  >
                    {t("pos.createOrder")}
                  </button>
                )}
              </section>
              )}

              <section className={`space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 ${canCreateOrders ? "" : "lg:col-span-2"}`}>
                <h2 className="text-lg font-semibold text-ink dark:text-white">{t("pos.openOrders")}</h2>
                {orders.length === 0 && <p className="text-sm text-slate-500">{t("pos.emptyOrders")}</p>}
                {orders.map((order) => {
                  const nextStatus: "preparing" | "ready" | "served" | null =
                    order.status === "new" ? "preparing"
                      : order.status === "preparing" ? "ready"
                        : order.status === "ready" ? "served" : null;
                  return (
                    <article className="rounded-xl border border-slate-200 p-3 dark:border-slate-700" key={order.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">
                          {t("pos.orderNumber", { number: order.order_number })} · {order.customer_name} · {order.customer_code}
                        </p>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold dark:bg-slate-800">
                          {t(`pos.status.${order.status}`)}
                        </span>
                      </div>
                      <ul className="my-2 text-sm text-slate-600 dark:text-slate-300">
                        {order.items.map((item, index) => (
                          <li key={`${order.id}-${index}`}>
                            {i18n.language === "ar" ? item.name_ar : item.name_en} × {item.quantity}
                          </li>
                        ))}
                      </ul>
                      <p className="font-bold">{formatMoney(order.total, order.currency)}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {canUpdateOrderStatus && nextStatus && (
                          <button
                            className={secondaryButtonClass}
                            disabled={busy}
                            onClick={() => void advanceOrder(order.id, nextStatus)}
                            type="button"
                          >
                            {t(`pos.advance.${nextStatus}`)}
                          </button>
                        )}
                        {canManageOrders && (order.status === "served" || order.status === "open") && (
                          <>
                            <label className="text-sm">
                              <span className="mb-1 block">{t("pos.paymentMethod")}</span>
                              <select
                                className={inputClass}
                                onChange={(event) => setOrderPaymentMethods((current) => ({
                                  ...current,
                                  [order.id]: event.target.value as PosReceipt["payment_method"],
                                }))}
                                value={orderPaymentMethods[order.id] ?? "cash"}
                              >
                                <option value="cash">{t("pos.payment.cash")}</option>
                                <option value="card">{t("pos.payment.card")}</option>
                                <option value="other">{t("pos.payment.other")}</option>
                              </select>
                            </label>
                            <button
                              className={buttonClass}
                              disabled={busy || !canUseShift}
                              onClick={() => void completeExistingOrder(order.id)}
                              type="button"
                            >
                              {t("pos.completeOrder")}
                            </button>
                          </>
                        )}
                      </div>
                      {canCancelOrders && order.status !== "served" && (
                        <>
                          <label className="mt-3 block text-sm">
                            <span className="mb-1 block">{t("pos.reason")}</span>
                            <input
                              className={inputClass}
                              maxLength={500}
                              onChange={(event) => setCancelReasons((current) => ({ ...current, [order.id]: event.target.value }))}
                              value={cancelReasons[order.id] ?? ""}
                            />
                          </label>
                          <button
                            className={`${secondaryButtonClass} mt-2`}
                            disabled={busy || (cancelReasons[order.id]?.trim().length ?? 0) < 3}
                            onClick={() => void cancelOrder(order.id)}
                            type="button"
                          >
                            {t("pos.cancelOrder")}
                          </button>
                        </>
                      )}
                    </article>
                  );
                })}
              </section>
            </div>
          )}

          {tab === "fees" && (
            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-ink dark:text-white">{t("pos.fees.title")}</h2>
              {focusCustomerId && (
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                  {t("pos.fees.customerFilter")}
                </p>
              )}
              {displayedFees.length === 0 && <p className="text-sm text-slate-500">{t("pos.fees.empty")}</p>}
              {displayedFees.map((fee) => (
                <article className="grid gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700 md:grid-cols-[1fr_auto]" key={feeKey(fee)}>
                  <div>
                    <p className="font-semibold">{fee.customer_name} · {fee.customer_code}</p>
                    <p className="text-sm">{formatMoney(fee.amount, fee.currency)} · {formatDateTime(fee.created_at)}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {fee.waived ? t("pos.fees.waived") : fee.paid ? t("pos.fees.paid") : t("pos.fees.unpaid")}
                    </p>
                  </div>
                  {!fee.waived && !fee.paid && (
                    <div className="flex flex-wrap items-end gap-2">
                      {canManageOrders && (
                        <>
                          <label className="text-sm">
                            <span className="mb-1 block">{t("pos.paymentMethod")}</span>
                            <select
                              className={inputClass}
                              onChange={(event) => setFeePaymentMethods((current) => ({ ...current, [feeKey(fee)]: event.target.value as PosReceipt["payment_method"] }))}
                              value={feePaymentMethods[feeKey(fee)] ?? "cash"}
                            >
                              <option value="cash">{t("pos.payment.cash")}</option><option value="card">{t("pos.payment.card")}</option><option value="other">{t("pos.payment.other")}</option>
                            </select>
                          </label>
                          <button className={buttonClass} disabled={busy || !canUseShift} onClick={() => void performFeePayment(fee)} type="button">{t("pos.fees.collect")}</button>
                        </>
                      )}
                      {(fee.source === "timer"
                        ? canWaiveTimerFees
                        : permissions.includes("fees.manage")) && (
                        <>
                          <label className="min-w-48 flex-1 text-sm">
                            <span className="mb-1 block">{t("pos.reason")}</span>
                            <input className={inputClass} maxLength={500} onChange={(event) => setWaiverReasons((current) => ({ ...current, [feeKey(fee)]: event.target.value }))} value={waiverReasons[feeKey(fee)] ?? ""} />
                          </label>
                          <button className={secondaryButtonClass} disabled={busy} onClick={() => void performFeeWaiver(fee)} type="button">{t("pos.fees.waive")}</button>
                        </>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </section>
          )}

        </>
      )}
    </section>
  );
}
