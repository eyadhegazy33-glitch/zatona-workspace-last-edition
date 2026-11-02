import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
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
  deletePosMenuImage,
  getCurrentPosShift,
  getPosMenuImageUrl,
  getPosSettings,
  listPosCategories,
  listOpenPosOrders,
  listOpenPosVisits,
  listPosProducts,
  listPosReceipts,
  listTimerFees,
  listVisitFees,
  openPosShift,
  payTimerFee,
  payVisitFee,
  savePosCategory,
  savePosMenuItem,
  setPosOrderStatus,
  uploadPosMenuImage,
  updatePosSettings,
  voidPosReceipt,
  waiveTimerFee,
  waiveVisitFee,
  type PosCategory,
  type PosProduct,
  type PosReceipt,
  type PosSettings,
  type PosShift,
  type VisitFee,
} from "../services/pointOfSale";

type Tab = "orders" | "products" | "fees" | "receipts" | "settings";
type CartLine = { productId: string; quantity: string };
type ProductDraft = {
  id: string | null;
  categoryId: string;
  nameEn: string;
  nameAr: string;
  description: string;
  price: string;
  qualifiesForTime: boolean;
  available: boolean;
  active: boolean;
  imagePath: string | null;
  sort: string;
};
type CategoryDraft = {
  id: string | null;
  nameEn: string;
  nameAr: string;
  sort: string;
  active: boolean;
};

const productSchema = z.object({
  categoryId: z.string().uuid(),
  nameEn: z.string().trim().min(1).max(100),
  nameAr: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500),
  price: z.coerce.number().finite().min(0).max(1_000_000),
  qualifiesForTime: z.boolean(),
  available: z.boolean(),
  active: z.boolean(),
  sort: z.coerce.number().int().min(-100_000).max(100_000),
  imagePath: z.string().nullable(),
});
const categorySchema = z.object({
  nameEn: z.string().trim().min(1).max(80),
  nameAr: z.string().trim().min(1).max(80),
  sort: z.coerce.number().int().min(-100_000).max(100_000),
  active: z.boolean(),
});

const orderSchema = z.object({
  checkinId: z.coerce.number().int().positive(),
  quantities: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.coerce.number().int().min(1).max(50),
  })).min(1).max(50),
  discountType: z.enum(["amount", "percent"]),
  discountValue: z.coerce.number().finite().min(0).max(1_000_000),
  discountReason: z.string().trim().max(500),
}).superRefine((value, context) => {
  if (value.discountType === "percent" && value.discountValue > 100) {
    context.addIssue({
      code: "custom",
      path: ["discountValue"],
      message: "invalidDiscount",
    });
  }
  if (value.discountValue > 0 && value.discountReason.length < 3) {
    context.addIssue({
      code: "custom",
      path: ["discountReason"],
      message: "reasonRequired",
    });
  }
});

const cashSchema = z.coerce.number().finite().min(0).max(100_000_000);
const settingsSchema = z.object({
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
  visitDuration: z.coerce.number().int().min(10).max(1440),
  feeInterval: z.coerce.number().int().min(1).max(1440),
  feeAmount: z.coerce.number().finite().min(0).max(99_999_999.99),
  timezone: z.string().trim().min(1).max(100),
  taxPercent: z.coerce.number().finite().min(0).max(100),
  servicePercent: z.coerce.number().finite().min(0).max(100),
  timerWarning: z.coerce.number().int().min(0).max(1440),
  timerGrace: z.coerce.number().int().min(0).max(1440),
  timerResetOn: z.enum(["order_created", "order_paid"]),
  feeRepeats: z.boolean(),
  requireOpenShift: z.boolean(),
  receiptPrefix: z.string().max(20),
  cashDiffAlert: z.coerce.number().finite().min(0).max(99_999_999.99),
});

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

function initialProductDraft(): ProductDraft {
  return {
    id: null,
    categoryId: "",
    nameEn: "",
    nameAr: "",
    description: "",
    price: "",
    qualifiesForTime: false,
    available: true,
    active: true,
    imagePath: null,
    sort: "0",
  };
}

function initialCategoryDraft(): CategoryDraft {
  return { id: null, nameEn: "", nameAr: "", sort: "0", active: true };
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
  const [savedSettings, setSavedSettings] = useState<PosSettings | null>(null);
  const [shift, setShift] = useState<PosShift | null>(null);
  const [scheduleAssignments, setScheduleAssignments] = useState<ShiftAssignment[]>([]);
  const [selectedScheduleShift, setSelectedScheduleShift] = useState("");
  const [categories, setCategories] = useState<PosCategory[]>([]);
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [visits, setVisits] = useState<Awaited<ReturnType<typeof listOpenPosVisits>>>([]);
  const [orders, setOrders] = useState<Awaited<ReturnType<typeof listOpenPosOrders>>>([]);
  const [receipts, setReceipts] = useState<PosReceipt[]>([]);
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
  const [discountType, setDiscountType] = useState<"amount" | "percent">("amount");
  const [discountValue, setDiscountValue] = useState("0");
  const [discountReason, setDiscountReason] = useState("");
  const [productDraft, setProductDraft] = useState<ProductDraft>(initialProductDraft);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft>(initialCategoryDraft);
  const [menuImage, setMenuImage] = useState<File | null>(null);
  const [cancelReasons, setCancelReasons] = useState<Record<string, string>>({});
  const [voidReasons, setVoidReasons] = useState<Record<string, string>>({});
  const [waiverReasons, setWaiverReasons] = useState<Record<string, string>>({});
  const [feePaymentMethods, setFeePaymentMethods] = useState<Record<string, PosReceipt["payment_method"]>>({});
  const [orderPaymentMethods, setOrderPaymentMethods] = useState<Record<string, PosReceipt["payment_method"]>>({});

  const canManageProducts = permissions.includes("products.manage");
  const canManageMenu = canManageProducts || permissions.includes("menu.manage");
  const canManageOrders = permissions.includes("orders.manage");
  const canCreateOrders = canManageOrders || permissions.includes("orders.create");
  const canUpdateOrderStatus = canManageOrders || permissions.includes("orders.update_status");
  const canCancelOrders = canManageOrders || permissions.includes("orders.cancel");
  const canManageShifts = permissions.includes("shifts.manage");
  const canUseScheduledShifts = canManageShifts || permissions.includes("shifts.use");
  const canUseShift = !settings?.require_open_shift || Boolean(shift);
  const canDiscount = permissions.includes("discounts.apply");
  const canWaiveFees = permissions.includes("fees.manage") || permissions.includes("fees.waive");
  const canWaiveTimerFees = permissions.includes("fees.waive");
  const canViewFees =
    canManageOrders ||
    canWaiveFees ||
    permissions.includes("checkins.manage") ||
    permissions.includes("fees.view");
  const focusCustomerId =
    typeof locationState.customerId === "string" ? locationState.customerId : "";
  const canVoidReceipts = permissions.includes("receipts.void");
  const currentLocale = i18n.language === "ar" ? "ar-EG" : i18n.language;

  const refresh = useCallback(async () => {
    setError("");
    try {
      const nextSettings = await getPosSettings();
      const businessDate = getBusinessDate(nextSettings.timezone);
      const [
        shiftResponse,
        scheduleResponse,
        nextCategories,
        nextProducts,
        nextVisits,
        nextOrders,
        nextReceipts,
        nextFees,
        nextTimerFees,
      ] = await Promise.all([
        canUseScheduledShifts ? getCurrentPosShift() : Promise.resolve({ shift: null, serverNow: "" }),
        canUseScheduledShifts
          ? getShiftScheduleData(businessDate, businessDate)
          : Promise.resolve(null),
        listPosCategories(),
        listPosProducts(),
        canCreateOrders ? listOpenPosVisits() : Promise.resolve([]),
        listOpenPosOrders(),
        canManageOrders || canVoidReceipts || canManageShifts ? listPosReceipts() : Promise.resolve([]),
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
      setSavedSettings(nextSettings);
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
      setCategories(nextCategories);
      setProducts(nextProducts);
      setVisits(nextVisits);
      setOrders(nextOrders);
      setReceipts(nextReceipts);
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
    canVoidReceipts,
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

  const saveProduct = async () => {
    if (busy) return;
    const parsed = productSchema.safeParse({
      ...productDraft,
      price: productDraft.price,
      sort: productDraft.sort,
    });
    if (!parsed.success) {
      setError(t("pos.errors.productInvalid"));
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    let uploadedPath: string | null = null;
    let saved = false;
    let imageCleanupFailed = false;
    try {
      if (menuImage) {
        uploadedPath = await uploadPosMenuImage(menuImage);
      }
      const nextImagePath = uploadedPath ?? parsed.data.imagePath;
      await savePosMenuItem({
        id: productDraft.id,
        categoryId: parsed.data.categoryId,
        nameEn: parsed.data.nameEn,
        nameAr: parsed.data.nameAr,
        description: parsed.data.description,
        price: parsed.data.price,
        countsForMinimum: parsed.data.qualifiesForTime,
        available: parsed.data.available,
        active: parsed.data.active,
        imagePath: nextImagePath,
        sort: parsed.data.sort,
      });
      saved = true;
      if (productDraft.imagePath && productDraft.imagePath !== nextImagePath) {
        try {
          await deletePosMenuImage(productDraft.imagePath);
        } catch {
          imageCleanupFailed = true;
        }
      }
      setProductDraft(initialProductDraft());
      setMenuImage(null);
      setNotice(t(imageCleanupFailed
        ? "pos.messages.productSavedImageCleanup"
        : "pos.messages.productSaved"));
      await refresh();
    } catch (cause) {
      if (uploadedPath && !saved) {
        try {
          await deletePosMenuImage(uploadedPath);
        } catch {
          setError(`${t(errorKey(cause))} ${t("pos.errors.menuImageCleanup")}`);
          return;
        }
      }
      setError(t(errorKey(cause)));
    } finally {
      setBusy(false);
    }
  };

  const saveCategory = async () => {
    if (busy) return;
    const parsed = categorySchema.safeParse({
      ...categoryDraft,
      sort: categoryDraft.sort,
    });
    if (!parsed.success) {
      setError(t("pos.errors.categoryInvalid"));
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await savePosCategory({
        ...parsed.data,
        id: categoryDraft.id,
      });
      setCategoryDraft(initialCategoryDraft());
      setNotice(t("pos.messages.categorySaved"));
      await refresh();
    } catch (cause) {
      setError(t(errorKey(cause)));
    } finally {
      setBusy(false);
    }
  };

  const createOrder = async () => {
    if (busy) return;
    const parsed = orderSchema.safeParse({
      checkinId: selectedCheckin,
      quantities: cart
        .filter((line) => line.productId)
        .map((line) => ({ productId: line.productId, quantity: line.quantity })),
      discountType,
      discountValue,
      discountReason,
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
        discountType: parsed.data.discountValue > 0 ? parsed.data.discountType : null,
        discountValue: parsed.data.discountValue,
        discountReason: parsed.data.discountValue > 0
          ? parsed.data.discountReason
          : null,
      });
      setCart([{ productId: "", quantity: "1" }]);
      setDiscountValue("0");
      setDiscountReason("");
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

  const performReceiptVoid = async (receiptId: string) => {
    const reason = voidReasons[receiptId]?.trim() ?? "";
    if (reason.length < 3 || busy) {
      setError(t("pos.errors.reason"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await voidPosReceipt(receiptId, reason);
      setVoidReasons((current) => ({ ...current, [receiptId]: "" }));
      setNotice(t("pos.messages.receiptVoided"));
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

  const saveSettings = async () => {
    if (!settings || busy) return;
    const parsed = settingsSchema.safeParse({
      currency: settings.currency,
      visitDuration: settings.visit_duration_minutes,
      feeInterval: settings.fee_interval_minutes,
      feeAmount: settings.fee_amount,
      timezone: settings.timezone,
      taxPercent: settings.tax_percent,
      servicePercent: settings.service_percent,
      timerWarning: settings.timer_warning_minutes,
      timerGrace: settings.timer_grace_minutes,
      timerResetOn: settings.timer_reset_on,
      feeRepeats: settings.fee_repeats,
      requireOpenShift: settings.require_open_shift,
      receiptPrefix: settings.receipt_prefix,
      cashDiffAlert: settings.cash_diff_alert,
    });
    if (!parsed.success) {
      setError(t("pos.errors.settingsInvalid"));
      return;
    }
    if (
      savedSettings &&
      (parsed.data.visitDuration !== savedSettings.visit_duration_minutes ||
        parsed.data.feeAmount !== savedSettings.fee_amount) &&
      !window.confirm(t("pos.settings.confirmFeeOrWindow"))
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await updatePosSettings({
        currency: parsed.data.currency,
        visitDurationMinutes: parsed.data.visitDuration,
        feeIntervalMinutes: parsed.data.feeInterval,
        feeAmount: parsed.data.feeAmount,
        timezone: parsed.data.timezone,
        taxPercent: parsed.data.taxPercent,
        servicePercent: parsed.data.servicePercent,
        timerWarningMinutes: parsed.data.timerWarning,
        timerGraceMinutes: parsed.data.timerGrace,
        feeRepeats: parsed.data.feeRepeats,
        timerResetOn: parsed.data.timerResetOn,
        requireOpenShift: parsed.data.requireOpenShift,
        receiptPrefix: parsed.data.receiptPrefix,
        cashDiffAlert: parsed.data.cashDiffAlert,
      });
      setSettings(saved);
      setSavedSettings(saved);
      setNotice(t("pos.messages.settingsSaved"));
    } catch (cause) {
      setError(t(errorKey(cause)));
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ key: Tab; label: string; visible: boolean }> = [
    { key: "orders", label: t("pos.tabs.orders"), visible: true },
    { key: "products", label: t("pos.tabs.products"), visible: canManageMenu },
    { key: "fees", label: t("pos.tabs.fees"), visible: canViewFees },
    { key: "receipts", label: t("pos.tabs.receipts"), visible: canManageOrders || canVoidReceipts || canManageShifts },
    { key: "settings", label: t("pos.tabs.settings"), visible: canManageProducts },
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
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">
          {t("pos.eyebrow")}
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-ink dark:text-white">
          {t("pos.title")}
        </h1>
        <nav aria-label={t("pos.quickNavigation")} className="mt-4 flex flex-wrap gap-2">
          {canCreateOrders && (
            <Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90" to="/orders/new">
              {t("layout.navigation.newOrder")}
            </Link>
          )}
          <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800" to="/orders/board">
            {t("layout.navigation.ordersBoard")}
          </Link>
          <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800" to="/orders">
            {t("layout.navigation.ordersList")}
          </Link>
          {canUseScheduledShifts && (
            <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800" to="/shifts/current">
              {t("layout.navigation.currentShift")}
            </Link>
          )}
        </nav>
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
        {tabs.filter((item) => item.visible).map((item) => (
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

                {canDiscount && (
                  <div className="grid gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-950 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="mb-1 block">{t("pos.discountType")}</span>
                      <select
                        className={inputClass}
                        onChange={(event) => setDiscountType(event.target.value as "amount" | "percent")}
                        value={discountType}
                      >
                        <option value="amount">{t("pos.fixedAmount")}</option>
                        <option value="percent">{t("pos.percentage")}</option>
                      </select>
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block">{t("pos.discountValue")}</span>
                      <input
                        className={inputClass}
                        min="0"
                        onChange={(event) => setDiscountValue(event.target.value)}
                        step="0.01"
                        type="number"
                        value={discountValue}
                      />
                    </label>
                    {Number(discountValue) > 0 && (
                      <label className="block text-sm sm:col-span-2">
                        <span className="mb-1 block">{t("pos.reason")}</span>
                        <input
                          className={inputClass}
                          maxLength={500}
                          onChange={(event) => setDiscountReason(event.target.value)}
                          value={discountReason}
                        />
                      </label>
                    )}
                  </div>
                )}

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

          {tab === "products" && canManageMenu && (
            <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-ink dark:text-white">{t("pos.catalog.title")}</h2>

              <section className="space-y-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-950">
                <h3 className="font-semibold">{t("pos.catalog.categories")}</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="block text-sm">
                    <span className="mb-1 block">{t("pos.catalog.nameEn")}</span>
                    <input className={inputClass} maxLength={80} onChange={(event) => setCategoryDraft((current) => ({ ...current, nameEn: event.target.value }))} value={categoryDraft.nameEn} />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block">{t("pos.catalog.nameAr")}</span>
                    <input className={inputClass} dir="rtl" maxLength={80} onChange={(event) => setCategoryDraft((current) => ({ ...current, nameAr: event.target.value }))} value={categoryDraft.nameAr} />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block">{t("pos.catalog.sort")}</span>
                    <input className={inputClass} onChange={(event) => setCategoryDraft((current) => ({ ...current, sort: event.target.value }))} step="1" type="number" value={categoryDraft.sort} />
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input checked={categoryDraft.active} onChange={(event) => setCategoryDraft((current) => ({ ...current, active: event.target.checked }))} type="checkbox" />
                    {t("pos.catalog.active")}
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className={buttonClass} disabled={busy} onClick={() => void saveCategory()} type="button">
                    {categoryDraft.id ? t("pos.catalog.saveCategory") : t("pos.catalog.addCategory")}
                  </button>
                  {categoryDraft.id && (
                    <button className={secondaryButtonClass} onClick={() => setCategoryDraft(initialCategoryDraft())} type="button">
                      {t("pos.cancelDraft")}
                    </button>
                  )}
                </div>
                <ul className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <li key={category.id} className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-sm dark:border-slate-700">
                      <span>{i18n.language === "ar" ? category.name_ar : category.name_en}</span>
                      {!category.active && <span className="text-xs text-slate-500">{t("pos.catalog.inactive")}</span>}
                      <button
                        className="font-semibold text-brand"
                        onClick={() => setCategoryDraft({
                          id: category.id,
                          nameEn: category.name_en,
                          nameAr: category.name_ar,
                          sort: String(category.sort),
                          active: category.active,
                        })}
                        type="button"
                      >
                        {t("pos.catalog.edit")}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="space-y-3">
                <h3 className="font-semibold">{t("pos.catalog.items")}</h3>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <label className="block text-sm">
                    <span className="mb-1 block">{t("pos.catalog.category")}</span>
                    <select className={inputClass} onChange={(event) => setProductDraft((current) => ({ ...current, categoryId: event.target.value }))} value={productDraft.categoryId}>
                      <option value="">{t("pos.catalog.chooseCategory")}</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {i18n.language === "ar" ? category.name_ar : category.name_en}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block">{t("pos.catalog.nameEn")}</span>
                    <input className={inputClass} maxLength={100} onChange={(event) => setProductDraft((current) => ({ ...current, nameEn: event.target.value }))} value={productDraft.nameEn} />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block">{t("pos.catalog.nameAr")}</span>
                    <input className={inputClass} dir="rtl" maxLength={100} onChange={(event) => setProductDraft((current) => ({ ...current, nameAr: event.target.value }))} value={productDraft.nameAr} />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block">{t("pos.catalog.description")}</span>
                    <input className={inputClass} maxLength={500} onChange={(event) => setProductDraft((current) => ({ ...current, description: event.target.value }))} value={productDraft.description} />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block">{t("pos.catalog.price")}</span>
                    <input className={inputClass} min="0" onChange={(event) => setProductDraft((current) => ({ ...current, price: event.target.value }))} step="0.01" type="number" value={productDraft.price} />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block">{t("pos.catalog.sort")}</span>
                    <input className={inputClass} onChange={(event) => setProductDraft((current) => ({ ...current, sort: event.target.value }))} step="1" type="number" value={productDraft.sort} />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block">{t("pos.catalog.image")}</span>
                    <input accept="image/jpeg,image/png,image/webp" className={inputClass} onChange={(event) => setMenuImage(event.target.files?.[0] ?? null)} type="file" />
                    <span className="mt-1 block text-xs text-slate-500">{t("pos.catalog.imageLimit")}</span>
                  </label>
                  {productDraft.imagePath && (
                    <div className="flex items-center gap-3">
                      <img alt="" className="h-14 w-14 rounded-lg object-cover" src={getPosMenuImageUrl(productDraft.imagePath)} />
                      <button className={secondaryButtonClass} onClick={() => {
                        setProductDraft((current) => ({ ...current, imagePath: null }));
                        setMenuImage(null);
                      }} type="button">
                        {t("pos.catalog.removeImage")}
                      </button>
                    </div>
                  )}
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input checked={productDraft.qualifiesForTime} onChange={(event) => setProductDraft((current) => ({ ...current, qualifiesForTime: event.target.checked }))} type="checkbox" />
                    {t("pos.catalog.qualifiesForTime")}
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input checked={productDraft.available} onChange={(event) => setProductDraft((current) => ({ ...current, available: event.target.checked }))} type="checkbox" />
                    {t("pos.catalog.available")}
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input checked={productDraft.active} onChange={(event) => setProductDraft((current) => ({ ...current, active: event.target.checked }))} type="checkbox" />
                    {t("pos.catalog.active")}
                  </label>
                </div>
                <div className="flex gap-2">
                  <button className={buttonClass} disabled={busy || categories.length === 0} onClick={() => void saveProduct()} type="button">
                    {productDraft.id ? t("pos.catalog.save") : t("pos.catalog.add")}
                  </button>
                  {productDraft.id && (
                    <button className={secondaryButtonClass} onClick={() => {
                      setProductDraft(initialProductDraft());
                      setMenuImage(null);
                    }} type="button">
                      {t("pos.cancelDraft")}
                    </button>
                  )}
                </div>
              </section>

              <div className="overflow-x-auto">
                <table className="min-w-full text-start text-sm">
                  <thead><tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="p-2">{t("pos.catalog.category")}</th>
                    <th className="p-2">{t("pos.catalog.nameEn")}</th>
                    <th className="p-2">{t("pos.catalog.price")}</th>
                    <th className="p-2">{t("pos.catalog.qualifiesForTime")}</th>
                    <th className="p-2">{t("pos.catalog.available")}</th>
                    <th className="p-2">{t("pos.catalog.active")}</th>
                    <th className="p-2">{t("pos.actions")}</th>
                  </tr></thead>
                  <tbody>
                    {products.map((product) => (
                      <tr className="border-b border-slate-100 dark:border-slate-800" key={product.id}>
                        <td className="p-2">{i18n.language === "ar" ? product.category_name_ar : product.category_name_en}</td>
                        <td className="p-2">
                          <span className="flex items-center gap-2">
                            {product.image_path && <img alt="" className="h-8 w-8 rounded object-cover" src={getPosMenuImageUrl(product.image_path)} />}
                            {i18n.language === "ar" ? product.name_ar : product.name_en}
                          </span>
                        </td>
                        <td className="p-2">{formatMoney(product.price)}</td>
                        <td className="p-2">{product.qualifies_for_time ? t("pos.yes") : t("pos.no")}</td>
                        <td className="p-2">{product.available ? t("pos.yes") : t("pos.no")}</td>
                        <td className="p-2">{product.active ? t("pos.yes") : t("pos.no")}</td>
                        <td className="p-2">
                          <button className={secondaryButtonClass} onClick={() => {
                            setProductDraft({
                              id: product.id,
                              categoryId: product.category_id ?? "",
                              nameEn: product.name_en,
                              nameAr: product.name_ar,
                              description: product.description ?? "",
                              price: String(product.price),
                              qualifiesForTime: product.qualifies_for_time,
                              available: product.available,
                              active: product.active,
                              imagePath: product.image_path,
                              sort: String(product.sort),
                            });
                            setMenuImage(null);
                          }} type="button">
                            {t("pos.catalog.edit")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
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

          {tab === "receipts" && (
            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-ink dark:text-white">{t("pos.receipts.title")}</h2>
              {receipts.length === 0 && <p className="text-sm text-slate-500">{t("pos.receipts.empty")}</p>}
              {receipts.map((receipt) => (
                <article className="rounded-xl border border-slate-200 p-3 dark:border-slate-700" key={receipt.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{receipt.receipt_no} · {receipt.customer_name} · {receipt.customer_code}</p>
                      <p className="text-sm text-slate-600 dark:text-slate-300">{formatMoney(receipt.total, receipt.currency)} · {t(`pos.payment.${receipt.payment_method}`)}</p>
                      <p className="text-xs text-slate-500">{formatDateTime(receipt.issued_at)}</p>
                      {receipt.voided && <p className="mt-1 text-sm text-red-600">{t("pos.receipts.voided")}: {receipt.void_reason}</p>}
                    </div>
                    {canVoidReceipts && !receipt.voided && (
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="text-sm">
                          <span className="mb-1 block">{t("pos.reason")}</span>
                          <input className={inputClass} maxLength={500} onChange={(event) => setVoidReasons((current) => ({ ...current, [receipt.id]: event.target.value }))} value={voidReasons[receipt.id] ?? ""} />
                        </label>
                        <button className={secondaryButtonClass} disabled={busy} onClick={() => void performReceiptVoid(receipt.id)} type="button">{t("pos.receipts.void")}</button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </section>
          )}

          {tab === "settings" && canManageProducts && settings && (
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-ink dark:text-white">{t("pos.settings.title")}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block">{t("pos.settings.currency")}</span>
                  <input className={inputClass} maxLength={3} onChange={(event) => setSettings({ ...settings, currency: event.target.value.toUpperCase() })} value={settings.currency} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block">{t("pos.settings.visitDuration")}</span>
                  <input className={inputClass} min="10" max="1440" onChange={(event) => setSettings({ ...settings, visit_duration_minutes: Number(event.target.value) })} step="1" type="number" value={settings.visit_duration_minutes} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block">{t("pos.settings.feeInterval")}</span>
                  <input className={inputClass} min="1" onChange={(event) => setSettings({ ...settings, fee_interval_minutes: Number(event.target.value) })} step="1" type="number" value={settings.fee_interval_minutes} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block">{t("pos.settings.feeAmount")}</span>
                  <input className={inputClass} min="0" max="99999999.99" onChange={(event) => setSettings({ ...settings, fee_amount: Number(event.target.value) })} step="0.01" type="number" value={settings.fee_amount} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block">{t("pos.settings.timezone")}</span>
                  <input className={inputClass} onChange={(event) => setSettings({ ...settings, timezone: event.target.value })} value={settings.timezone} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block">{t("pos.settings.taxPercent")}</span>
                  <input className={inputClass} min="0" max="100" onChange={(event) => setSettings({ ...settings, tax_percent: Number(event.target.value) })} step="0.01" type="number" value={settings.tax_percent} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block">{t("pos.settings.servicePercent")}</span>
                  <input className={inputClass} min="0" max="100" onChange={(event) => setSettings({ ...settings, service_percent: Number(event.target.value) })} step="0.01" type="number" value={settings.service_percent} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block">{t("pos.settings.timerWarning")}</span>
                  <input className={inputClass} min="0" max="1440" onChange={(event) => setSettings({ ...settings, timer_warning_minutes: Number(event.target.value) })} step="1" type="number" value={settings.timer_warning_minutes} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block">{t("pos.settings.timerGrace")}</span>
                  <input className={inputClass} min="0" max="1440" onChange={(event) => setSettings({ ...settings, timer_grace_minutes: Number(event.target.value) })} step="1" type="number" value={settings.timer_grace_minutes} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block">{t("pos.settings.timerReset")}</span>
                  <select className={inputClass} onChange={(event) => setSettings({ ...settings, timer_reset_on: event.target.value as PosSettings["timer_reset_on"] })} value={settings.timer_reset_on}>
                    <option value="order_created">{t("pos.settings.orderCreated")}</option>
                    <option value="order_paid">{t("pos.settings.orderPaid")}</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block">{t("pos.settings.receiptPrefix")}</span>
                  <input className={inputClass} maxLength={20} onChange={(event) => setSettings({ ...settings, receipt_prefix: event.target.value })} value={settings.receipt_prefix} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block">{t("pos.settings.cashDiffAlert")}</span>
                  <input className={inputClass} min="0" max="99999999.99" onChange={(event) => setSettings({ ...settings, cash_diff_alert: Number(event.target.value) })} step="0.01" type="number" value={settings.cash_diff_alert} />
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input checked={settings.fee_repeats} onChange={(event) => setSettings({ ...settings, fee_repeats: event.target.checked })} type="checkbox" />
                  {t("pos.settings.feeRepeats")}
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input checked={settings.require_open_shift} onChange={(event) => setSettings({ ...settings, require_open_shift: event.target.checked })} type="checkbox" />
                  {t("pos.settings.requireShift")}
                </label>
              </div>
              <p className="text-sm text-slate-500">{t("pos.settings.help")}</p>
              <button className={buttonClass} disabled={busy} onClick={() => void saveSettings()} type="button">{t("pos.settings.save")}</button>
            </section>
          )}
        </>
      )}
    </section>
  );
}
