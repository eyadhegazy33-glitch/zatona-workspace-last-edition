import { z } from "zod";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  MapPin,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { getSupabaseClient } from "../lib/supabase";
import { writeBookingExport } from "../lib/sheetjs";
import {
  checkInBooking,
  createBooking,
  getBookingSettings,
  getBookingErrorMessage,
  listBookingResources,
  listBookings,
  searchBookingCustomers,
  setBookingStatus,
  updateBooking,
  type Booking,
  type BookingCustomer,
  type BookingResource,
  type BookingStatus,
} from "../services/bookings";

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 24;
const HOUR_COUNT = DAY_END_HOUR - DAY_START_HOUR;

const bookingSchema = z.object({
  customerId: z.string().uuid(),
  resourceId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  starts: z.string().regex(/^\d{2}:\d{2}$/),
  ends: z.string().regex(/^\d{2}:\d{2}$/),
  people: z.coerce.number().int().min(1).max(200),
  notes: z.string().max(500),
  deposit: z.coerce.number().finite().min(0).max(9999999999.99)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8),
});

const cancelSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

type BookingForm = {
  customerId: string;
  resourceId: string;
  date: string;
  starts: string;
  ends: string;
  people: string;
  notes: string;
  deposit: string;
};

type DateRange = { from: string; to: string };
type DateView = "day" | "week";

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function localDateTime(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

function timeInMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function toLocalRange(date: string): DateRange {
  const from = startOfLocalDay(date);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function weekRange(date: string): DateRange {
  const from = startOfLocalDay(date);
  const mondayOffset = (from.getDay() + 6) % 7;
  from.setDate(from.getDate() - mondayOffset);
  const to = new Date(from);
  to.setDate(to.getDate() + 7);
  return { from: from.toISOString(), to: to.toISOString() };
}

function weekStartDate(date: string): Date {
  const from = startOfLocalDay(date);
  from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
  return from;
}

function localDateRange(fromValue: string, toValue: string): DateRange {
  const from = startOfLocalDay(fromValue);
  const to = startOfLocalDay(toValue);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function bookingLocalDate(booking: Booking): string {
  return localDateKey(new Date(booking.starts_at));
}

function bookingStatusColor(status: BookingStatus): string {
  switch (status) {
    case "pending":
      return "border-amber-400 bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100";
    case "confirmed":
      return "border-sky-400 bg-sky-100 text-sky-950 dark:bg-sky-950 dark:text-sky-100";
    case "checked_in":
      return "border-emerald-500 bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100";
    case "completed":
      return "border-slate-400 bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100";
    case "cancelled":
      return "border-red-300 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200";
    case "no_show":
      return "border-purple-400 bg-purple-100 text-purple-950 dark:bg-purple-950 dark:text-purple-100";
  }
}

export function BookingsPage() {
  const { i18n, t } = useTranslation();
  const { permissions } = useAuth();
  const location = useLocation();
  const isList = location.pathname.endsWith("/list");
  const canManage = permissions.includes("bookings.manage");
  const today = localDateKey(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [dateView, setDateView] = useState<DateView>("day");
  const [resources, setResources] = useState<BookingResource[]>([]);
  const [currencyCode, setCurrencyCode] = useState("EGP");
  const [timeZone, setTimeZone] = useState("Africa/Cairo");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [resourcesError, setResourcesError] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const [form, setForm] = useState<BookingForm | null>(null);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [customers, setCustomers] = useState<BookingCustomer[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<BookingCustomer | null>(null);
  const [customerSearchError, setCustomerSearchError] = useState(false);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showCancelReason, setShowCancelReason] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [checkInResult, setCheckInResult] = useState<{ id: number; at: string } | null>(null);
  const [warningOccupied, setWarningOccupied] = useState(false);
  const [highlightedBookingId, setHighlightedBookingId] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [filterFrom, setFilterFrom] = useState(today);
  const [filterTo, setFilterTo] = useState(today);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterResource, setFilterResource] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [exportError, setExportError] = useState(false);
  const formDate = form?.date;
  const formStarts = form?.starts;
  const formResourceId = form?.resourceId;

  const activeResourceId = selectedResourceId || resources[0]?.id || "";
  const firstAvailableResourceId =
    resources.find((resource) => resource.status === "available")?.id ?? "";

  const refreshBookings = useCallback(async () => {
    if (isList && (!filterFrom || !filterTo || filterFrom > filterTo)) {
      setBookings([]);
      setLoadError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const range = isList
        ? localDateRange(filterFrom, filterTo)
        : dateView === "week"
          ? weekRange(selectedDate)
          : toLocalRange(selectedDate);
      const result = await listBookings({
        ...range,
        resourceId: isList ? filterResource || null : null,
        status: isList && filterStatus
          ? filterStatus as BookingStatus
          : null,
        search: isList ? filterSearch : "",
      });
      setBookings(result);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [
    dateView,
    filterFrom,
    filterResource,
    filterSearch,
    filterStatus,
    filterTo,
    isList,
    selectedDate,
  ]);

  useEffect(() => {
    let active = true;
    void listBookingResources()
      .then((resourceRows) => {
        if (!active) return;
        setResources(resourceRows);
        const firstAvailable = resourceRows.find(
          (resource) => resource.status === "available",
        );
        if (firstAvailable) {
          setSelectedResourceId((current) => current || firstAvailable.id);
          setForm((current) => current && !current.resourceId
            ? { ...current, resourceId: firstAvailable.id }
            : current);
        }
      })
      .catch(() => {
        if (active) setResourcesError(true);
      })
      .finally(() => {
        if (active) setResourcesLoading(false);
      });
    void getBookingSettings()
      .then((settings) => {
        if (!active) return;
        setCurrencyCode(settings.currencyCode);
        setTimeZone(settings.timeZone);
      })
      .catch(() => {
        if (active) setSettingsError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!formDate || !formStarts || !formResourceId) {
      setWarningOccupied(false);
      return;
    }
    const resource = resources.find((item) => item.id === formResourceId);
    const starts = localDateTime(formDate, formStarts).getTime();
    setWarningOccupied(Boolean(
      resource?.occupied &&
      starts >= now.getTime() &&
      starts <= now.getTime() + 60 * 60 * 1000,
    ));
  }, [formDate, formResourceId, formStarts, now, resources]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshBookings(), 200);
    return () => window.clearTimeout(timer);
  }, [refreshBookings]);

  useEffect(() => {
    const client = getSupabaseClient();
    let debounce: number | undefined;
    const channel = client
      .channel(`bookings-${crypto.randomUUID()}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "bookings",
      }, () => {
        window.clearTimeout(debounce);
        debounce = window.setTimeout(() => void refreshBookings(), 1200);
      })
      .subscribe();
    return () => {
      window.clearTimeout(debounce);
      void client.removeChannel(channel);
    };
  }, [refreshBookings]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!form || customerQuery.trim().length < 2) {
      setCustomers([]);
      setCustomerSearchError(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void searchBookingCustomers(customerQuery)
        .then((result) => {
          if (active) {
            setCustomers(result);
            setCustomerSearchError(false);
          }
        })
        .catch(() => {
          if (active) {
            setCustomers([]);
            setCustomerSearchError(true);
          }
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [customerQuery, form]);

  const formatDate = useCallback((date: Date, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(i18n.language, { ...options, timeZone }).format(date), [i18n.language, timeZone]);
  const formatTime = useCallback((value: string | Date) =>
    new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit", timeZone })
      .format(typeof value === "string" ? new Date(value) : value), [i18n.language, timeZone]);
  const formatMoney = useCallback((value: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(value), [currencyCode, i18n.language]);

  const resourcesByType = useMemo(() => ({
    room: resources.filter((resource) => resource.type === "room"),
    table: resources.filter((resource) => resource.type === "table"),
    seat: resources.filter((resource) => resource.type === "seat"),
  }), [resources]);

  const openCreate = (
    date = selectedDate,
    resourceId = firstAvailableResourceId || activeResourceId,
    starts?: string,
  ) => {
    let bookingDate = date;
    let bookingStarts = starts ?? "09:00";
    if (!starts && date === today) {
      const nextHour = new Date();
      const nextStartHour = nextHour.getHours() + 1;
      if (nextStartHour >= DAY_END_HOUR - 1) {
        nextHour.setDate(nextHour.getDate() + 1);
        bookingDate = localDateKey(nextHour);
        bookingStarts = "09:00";
      } else {
        bookingStarts = `${String(nextStartHour).padStart(2, "0")}:00`;
      }
    }
    const selectedResourceIdForForm = resources.some(
      (resource) => resource.id === resourceId && resource.status === "available",
    )
      ? resourceId
      : firstAvailableResourceId;
    const start = localDateTime(bookingDate, bookingStarts);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    setForm({
      customerId: "",
      resourceId: selectedResourceIdForForm,
      date: bookingDate,
      starts: bookingStarts,
      ends: `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`,
      people: "1",
      notes: "",
      deposit: "0",
    });
    setEditingBooking(null);
    setSelectedCustomer(null);
    setCustomerQuery("");
    setCustomers([]);
    setFormError("");
  };

  const openEdit = (booking: Booking) => {
    setSelectedBooking(null);
    setForm({
      customerId: booking.customer_id,
      resourceId: booking.resource_id ?? "",
      date: localDateKey(new Date(booking.starts_at)),
      starts: `${String(new Date(booking.starts_at).getHours()).padStart(2, "0")}:${String(new Date(booking.starts_at).getMinutes()).padStart(2, "0")}`,
      ends: `${String(new Date(booking.ends_at).getHours()).padStart(2, "0")}:${String(new Date(booking.ends_at).getMinutes()).padStart(2, "0")}`,
      people: String(booking.people),
      notes: booking.notes ?? "",
      deposit: String(booking.deposit),
    });
    setEditingBooking(booking);
    setSelectedCustomer({
      id: booking.customer_id,
      code: booking.customer_code,
      first_name: booking.customer_name.split(" ")[0] ?? "",
      last_name: booking.customer_name.split(" ").slice(1).join(" "),
    });
    setCustomerQuery("");
    setFormError("");
  };

  const closeForm = () => {
    if (saving) return;
    setForm(null);
    setEditingBooking(null);
    setFormError("");
    setWarningOccupied(false);
  };

  const submitBooking = async () => {
    if (!form || saving) return;
    const parsed = bookingSchema.safeParse({
      ...form,
      people: form.people,
      deposit: form.deposit,
    });
    if (!parsed.success) {
      setFormError("bookings.errors.invalidForm");
      return;
    }
    const start = localDateTime(parsed.data.date, parsed.data.starts);
    const end = localDateTime(parsed.data.date, parsed.data.ends);
    const startMinutes = timeInMinutes(parsed.data.starts);
    const endMinutes = timeInMinutes(parsed.data.ends);
    const durationMinutes = endMinutes - startMinutes;
    const resource = resources.find((item) => item.id === parsed.data.resourceId);
    if (start.getTime() < Date.now()) {
      setFormError("bookings.errors.past");
      return;
    }
    if (!resource || resource.status !== "available") {
      setFormError("bookings.errors.resourceUnavailable");
      return;
    }
    if (
      !Number.isFinite(startMinutes) ||
      !Number.isFinite(endMinutes) ||
      startMinutes < 0 ||
      startMinutes >= 24 * 60 ||
      endMinutes < 0 ||
      endMinutes >= 24 * 60 ||
      durationMinutes <= 0 ||
      durationMinutes > 4 * 60
    ) {
      setFormError("bookings.errors.invalidTime");
      return;
    }
    if (parsed.data.people > resource.capacity) {
      setFormError("bookings.errors.capacity");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const input = {
        customerId: parsed.data.customerId,
        resourceId: parsed.data.resourceId,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        people: parsed.data.people,
        notes: parsed.data.notes,
        deposit: parsed.data.deposit,
      };
      if (editingBooking) await updateBooking(editingBooking.id, input);
      else await createBooking(input);
      setForm(null);
      setEditingBooking(null);
      await refreshBookings();
    } catch (error) {
      const message = getBookingErrorMessage(error);
      if (message.includes("slot_taken")) {
        const conflict = bookings.find((booking) =>
          booking.resource_id === parsed.data.resourceId &&
          booking.status !== "cancelled" &&
          booking.status !== "completed" &&
          booking.status !== "no_show" &&
          Date.parse(booking.starts_at) < end.getTime() &&
          Date.parse(booking.ends_at) > start.getTime());
        setHighlightedBookingId(conflict?.id ?? "");
        setFormError("bookings.errors.slotTaken");
      } else if (message.includes("customer not allowed")) {
        setFormError("bookings.errors.customerNotAllowed");
      } else if (message.includes("resource not available")) {
        setFormError("bookings.errors.resourceUnavailable");
      } else if (message.includes("too many people")) {
        setFormError("bookings.errors.capacity");
      } else if (message.includes("not allowed")) {
        setFormError("bookings.errors.permission");
      } else if (message.includes("outside the allowed time window")) {
        setFormError("bookings.errors.timeWindow");
      } else if (message.includes("invalid booking details")) {
        setFormError(start.getTime() < Date.now()
          ? "bookings.errors.past"
          : "bookings.errors.invalidDetails");
      } else if (message.includes("booking cannot be edited")) {
        setFormError("bookings.errors.cannotEdit");
      } else {
        setFormError("bookings.errors.save");
      }
    } finally {
      setSaving(false);
    }
  };

  const runStatusAction = async (
    status: BookingStatus,
    reason?: string,
  ) => {
    if (!selectedBooking || statusBusy) return;
    if (status === "cancelled") {
      const parsed = cancelSchema.safeParse({ reason });
      if (!parsed.success) {
        setStatusError("bookings.errors.cancelReason");
        return;
      }
      reason = parsed.data.reason;
    }
    setStatusBusy(true);
    setStatusError("");
    try {
      await setBookingStatus(selectedBooking.id, status, reason);
      setShowCancelReason(false);
      setCancelReason("");
      await refreshBookings();
      setSelectedBooking({ ...selectedBooking, status, cancel_reason: reason ?? selectedBooking.cancel_reason });
    } catch {
      setStatusError("bookings.errors.status");
    } finally {
      setStatusBusy(false);
    }
  };

  const runCheckIn = async () => {
    if (!selectedBooking || statusBusy) return;
    setStatusBusy(true);
    setStatusError("");
    try {
      const result = await checkInBooking(selectedBooking.id);
      setCheckInResult({ id: result.id, at: result.checked_in_at });
      setSelectedBooking({ ...selectedBooking, status: "checked_in" });
      await refreshBookings();
    } catch (error) {
      const message = getBookingErrorMessage(error);
      setStatusError(message.includes("not within the booking time")
        ? "bookings.errors.checkInWindow"
        : message.includes("already checked in")
          ? "bookings.errors.alreadyCheckedIn"
          : "bookings.errors.checkIn");
    } finally {
      setStatusBusy(false);
    }
  };

  const moveDate = (direction: -1 | 1) => {
    const date = startOfLocalDay(selectedDate);
    date.setDate(date.getDate() + direction * (dateView === "week" ? 7 : 1));
    setSelectedDate(localDateKey(date));
  };

  const handleEmptySlot = (
    event: MouseEvent<HTMLDivElement>,
    resourceId: string,
  ) => {
    if (!canManage || (event.target as HTMLElement).closest("[data-booking]")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(0.999, (event.clientX - rect.left) / rect.width));
    const minute = Math.round((DAY_START_HOUR * 60 + fraction * HOUR_COUNT * 60) / 30) * 30;
    const hour = Math.min(23, Math.floor(minute / 60));
    const starts = `${String(hour).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    openCreate(selectedDate, resourceId, starts);
  };

  const renderBookingBlock = (booking: Booking, timeline = false) => {
    const leftTime = new Date(booking.starts_at);
    const rightTime = new Date(booking.ends_at);
    const startMinutes = Math.max(DAY_START_HOUR * 60, leftTime.getHours() * 60 + leftTime.getMinutes());
    const endMinutes = Math.min(DAY_END_HOUR * 60, rightTime.getHours() * 60 + rightTime.getMinutes());
    const left = ((startMinutes - DAY_START_HOUR * 60) / (HOUR_COUNT * 60)) * 100;
    const width = Math.max(1.5, ((endMinutes - startMinutes) / (HOUR_COUNT * 60)) * 100);
    const details = (
      <>
        <span className="block truncate font-semibold">{booking.customer_name}</span>
        <span className="block truncate text-[11px]">
          {formatTime(booking.starts_at)}–{formatTime(booking.ends_at)} · {booking.people}
        </span>
      </>
    );
    if (!timeline) {
      return (
        <button
          className={`w-full rounded-lg border-s-4 p-3 text-start text-sm ${bookingStatusColor(booking.status)} ${highlightedBookingId === booking.id ? "ring-2 ring-red-600" : ""}`}
          key={booking.id}
          onClick={() => { setSelectedBooking(booking); setStatusError(""); setCheckInResult(null); }}
          type="button"
        >
          <span className="flex items-center justify-between gap-3">
            <span className="min-w-0">{details}</span>
            <span className="shrink-0 rounded-full bg-white/70 px-2 py-1 text-xs dark:bg-black/20">{t(`bookings.status.${booking.status}`)}</span>
          </span>
          <span className="mt-1 flex items-center gap-1 text-xs"><MapPin size={13} />{booking.resource_name ?? t("bookings.deletedResource")} · {booking.customer_code}</span>
        </button>
      );
    }
    return (
      <button
        className={`absolute top-2 z-10 h-16 overflow-hidden rounded-md border-s-4 px-2 py-1 text-start text-[11px] shadow-sm ${bookingStatusColor(booking.status)} ${highlightedBookingId === booking.id ? "z-20 ring-2 ring-red-600" : ""}`}
        data-booking
        key={booking.id}
        onClick={(event) => {
          event.stopPropagation();
          setSelectedBooking(booking);
          setStatusError("");
          setCheckInResult(null);
        }}
        style={{ left: `${left}%`, width: `${width}%` }}
        title={`${booking.customer_name} · ${formatTime(booking.starts_at)}–${formatTime(booking.ends_at)}`}
        type="button"
      >
        {details}
      </button>
    );
  };

  const currentTimelinePosition = (() => {
    if (selectedDate !== today) return null;
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes < DAY_START_HOUR * 60 || minutes > DAY_END_HOUR * 60) return null;
    return ((minutes - DAY_START_HOUR * 60) / (HOUR_COUNT * 60)) * 100;
  })();

  const renderResourceCalendar = (resource: BookingResource) => (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] border-b border-slate-200 dark:border-slate-800" key={resource.id}>
      <div className="flex flex-col justify-center border-e border-slate-200 p-3 dark:border-slate-800">
        <span className="font-semibold">{resource.name}</span>
        <span className="text-xs text-slate-500">{t(`bookings.resourceTypes.${resource.type}`)} · {resource.capacity}</span>
      </div>
      <div
        aria-label={t("bookings.createInSlot", { resource: resource.name })}
        className={`relative h-20 ${canManage ? "cursor-crosshair" : ""}`}
        onClick={(event) => handleEmptySlot(event, resource.id)}
        onKeyDown={(event) => {
          if (canManage && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            openCreate(selectedDate, resource.id);
          }
        }}
        role={canManage ? "button" : undefined}
        style={{ backgroundImage: "linear-gradient(to right, rgb(148 163 184 / 25%) 1px, transparent 1px)", backgroundSize: `${100 / HOUR_COUNT}% 100%` }}
        tabIndex={canManage ? 0 : undefined}
      >
        {currentTimelinePosition !== null && (
          <span className="pointer-events-none absolute inset-y-0 z-[5] w-px bg-red-600" style={{ left: `${currentTimelinePosition}%` }}>
            <span className="absolute -top-1 -translate-x-1/2 rounded bg-red-600 px-1 text-[9px] text-white">{t("bookings.now")}</span>
          </span>
        )}
        {bookings.filter((booking) => booking.resource_id === resource.id).map((booking) => renderBookingBlock(booking, true))}
      </div>
    </div>
  );

  const weekDays = useMemo(() => {
    const start = weekStartDate(selectedDate);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(day.getDate() + index);
      return day;
    });
  }, [selectedDate]);

  const selectedResource = resources.find((resource) => resource.id === (isList ? filterResource : selectedResourceId));

  const exportBookings = () => {
    setExportError(false);
    try {
      writeBookingExport(
        [
          t("bookings.exportHeaders.customer"),
          t("bookings.exportHeaders.code"),
          t("bookings.exportHeaders.resource"),
          t("bookings.exportHeaders.type"),
          t("bookings.exportHeaders.date"),
          t("bookings.exportHeaders.starts"),
          t("bookings.exportHeaders.ends"),
          t("bookings.exportHeaders.people"),
          t("bookings.exportHeaders.deposit"),
          t("bookings.exportHeaders.status"),
          t("bookings.exportHeaders.notes"),
        ],
        bookings.map((booking) => [
          booking.customer_name,
          booking.customer_code,
          booking.resource_name ?? t("bookings.deletedResource"),
          booking.resource_type
            ? t(`bookings.resourceTypes.${booking.resource_type}`)
            : "",
          formatDate(new Date(booking.starts_at), { dateStyle: "short" }),
          formatTime(booking.starts_at),
          formatTime(booking.ends_at),
          booking.people,
          booking.deposit,
          t(`bookings.status.${booking.status}`),
          booking.notes ?? "",
        ]),
      );
    } catch {
      setExportError(true);
    }
  };

  const modalBackdrop = (content: ReactNode, onClose: () => void) => (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-3 sm:p-6"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      {content}
    </div>
  );

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-7 sm:px-6 lg:px-8" dir={i18n.dir()}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-brand"><CalendarDays size={18} />{t("bookings.eyebrow")}</p>
          <h1 className="mt-1 text-3xl font-bold text-ink dark:text-white">{t("bookings.title")}</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t(isList ? "bookings.listDescription" : "bookings.description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && <button className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white" onClick={() => openCreate()} type="button"><Plus size={17} />{t("bookings.newBooking")}</button>}
          {isList && <button className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white" onClick={exportBookings} type="button"><Download size={17} />{t("bookings.export")}</button>}
        </div>
      </header>

      <nav aria-label={t("bookings.navigation")} className="flex gap-2 border-b border-slate-200 dark:border-slate-800">
        <Link className={`px-3 py-2 text-sm font-semibold ${!isList ? "border-b-2 border-brand text-brand" : "text-slate-500"}`} to="/bookings">{t("bookings.calendar")}</Link>
        <Link className={`px-3 py-2 text-sm font-semibold ${isList ? "border-b-2 border-brand text-brand" : "text-slate-500"}`} to="/bookings/list">{t("bookings.list")}</Link>
      </nav>

      {loadError && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">{t("bookings.errors.load")}</p>}
      {resourcesError && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">{t("bookings.errors.resources")}</p>}
      {settingsError && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="alert">{t("bookings.errors.settings")}</p>}
      {isList && (!filterFrom || !filterTo || filterFrom > filterTo) && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="alert">{t("bookings.errors.invalidRange")}</p>}
      {exportError && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">{t("bookings.errors.export")}</p>}

      {isList ? (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-sm"><span className="mb-1 block font-medium">{t("bookings.from")}</span><input className="min-h-10 w-full rounded-lg border border-slate-300 bg-transparent px-3 dark:border-slate-700" onChange={(event) => setFilterFrom(event.target.value)} type="date" value={filterFrom} /></label>
            <label className="text-sm"><span className="mb-1 block font-medium">{t("bookings.to")}</span><input className="min-h-10 w-full rounded-lg border border-slate-300 bg-transparent px-3 dark:border-slate-700" onChange={(event) => setFilterTo(event.target.value)} type="date" value={filterTo} /></label>
            <label className="text-sm"><span className="mb-1 block font-medium">{t("bookings.status.label")}</span><select className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900" onChange={(event) => setFilterStatus(event.target.value)} value={filterStatus}><option value="">{t("bookings.status.all")}</option>{(["pending", "confirmed", "checked_in", "completed", "cancelled", "no_show"] as const).map((status) => <option key={status} value={status}>{t(`bookings.status.${status}`)}</option>)}</select></label>
            <label className="text-sm"><span className="mb-1 block font-medium">{t("bookings.resource")}</span><select className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900" onChange={(event) => setFilterResource(event.target.value)} value={filterResource}><option value="">{t("bookings.allResources")}</option>{resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>
            <label className="text-sm"><span className="mb-1 block font-medium">{t("bookings.search")}</span><span className="relative block"><Search className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input className="min-h-10 w-full rounded-lg border border-slate-300 bg-transparent ps-9 pe-3 dark:border-slate-700" onChange={(event) => setFilterSearch(event.target.value)} placeholder={t("bookings.searchPlaceholder")} value={filterSearch} /></span></label>
          </div>
          {loading ? <div className="grid min-h-40 place-items-center"><LoaderCircle className="animate-spin text-brand" size={28} /></div> : bookings.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">{t("bookings.empty")}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead><tr className="border-b border-slate-200 text-start text-slate-500 dark:border-slate-800"><th className="p-3 text-start">{t("bookings.customer")}</th><th className="p-3 text-start">{t("bookings.resource")}</th><th className="p-3 text-start">{t("bookings.dateTime")}</th><th className="p-3 text-end">{t("bookings.people")}</th><th className="p-3 text-end">{t("bookings.deposit")}</th><th className="p-3 text-start">{t("bookings.status.label")}</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{bookings.map((booking) => <tr className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 ${highlightedBookingId === booking.id ? "bg-red-50 ring-2 ring-inset ring-red-500 dark:bg-red-950/30" : ""}`} key={booking.id} onClick={() => { setSelectedBooking(booking); setStatusError(""); setCheckInResult(null); }}><td className="p-3"><span className="block font-semibold">{booking.customer_name}</span><span className="text-xs text-slate-500">{booking.customer_code}</span></td><td className="p-3">{booking.resource_name ?? t("bookings.deletedResource")}</td><td className="p-3">{formatDate(new Date(booking.starts_at), { dateStyle: "medium" })}<span className="block text-xs text-slate-500">{formatTime(booking.starts_at)}–{formatTime(booking.ends_at)}</span></td><td className="p-3 text-end">{booking.people}</td><td className="p-3 text-end">{formatMoney(booking.deposit)}</td><td className="p-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${bookingStatusColor(booking.status)}`}>{t(`bookings.status.${booking.status}`)}</span></td></tr>)}</tbody>
              </table>
            </div>
          )}
          <p className="text-end text-xs text-slate-500">{t("bookings.showingLimit", { count: bookings.length })}</p>
        </section>
      ) : (
        <>
          <section className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-end gap-2">
              <button aria-label={t("bookings.previous")} className="grid size-10 place-items-center rounded-lg border border-slate-300 dark:border-slate-700" onClick={() => moveDate(-1)} type="button"><ChevronLeft size={18} /></button>
              <button aria-label={t("bookings.next")} className="grid size-10 place-items-center rounded-lg border border-slate-300 dark:border-slate-700" onClick={() => moveDate(1)} type="button"><ChevronRight size={18} /></button>
              <button className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700" onClick={() => setSelectedDate(today)} type="button">{t("bookings.today")}</button>
              <input aria-label={t("bookings.selectDate")} className="min-h-10 rounded-lg border border-slate-300 bg-transparent px-3 text-sm dark:border-slate-700" onChange={(event) => setSelectedDate(event.target.value)} type="date" value={selectedDate} />
              <span className="px-2 pb-2 text-sm font-semibold">{dateView === "day" ? formatDate(startOfLocalDay(selectedDate), { dateStyle: "full" }) : t("bookings.weekOf", { date: formatDate(weekStartDate(selectedDate), { dateStyle: "medium" }) })}</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm"><span className="sr-only">{t("bookings.filterResource")}</span><select className="min-h-10 max-w-48 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900" onChange={(event) => setSelectedResourceId(event.target.value)} value={selectedResourceId}><option value="">{t("bookings.allResources")}</option>{resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>
              <div aria-label={t("bookings.view")} className="flex rounded-lg border border-slate-300 p-1 dark:border-slate-700" role="group">
                <button aria-pressed={dateView === "day"} className={`min-h-8 rounded px-3 text-sm ${dateView === "day" ? "bg-brand text-white" : ""}`} onClick={() => setDateView("day")} type="button">{t("bookings.day")}</button>
                <button aria-pressed={dateView === "week"} className={`min-h-8 rounded px-3 text-sm ${dateView === "week" ? "bg-brand text-white" : ""}`} onClick={() => setDateView("week")} type="button">{t("bookings.week")}</button>
              </div>
            </div>
          </section>

          {loading ? <div className="grid min-h-56 place-items-center"><LoaderCircle className="animate-spin text-brand" size={30} /></div> : dateView === "week" ? (
            <section className="space-y-3">
              {resources.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">{t("bookings.noResources")}</p> : weekDays.map((day) => {
                const key = localDateKey(day);
                const dayBookings = bookings.filter((booking) =>
                  bookingLocalDate(booking) === key &&
                  (!selectedResourceId || booking.resource_id === selectedResourceId));
                return <article className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900" key={key}><h2 className="mb-3 font-bold">{formatDate(day, { weekday: "long", year: "numeric", month: "short", day: "numeric" })} · {selectedResource?.name ?? t("bookings.allResources")}</h2>{dayBookings.length ? <div className="space-y-2">{dayBookings.map((booking) => renderBookingBlock(booking))}</div> : <p className="text-sm text-slate-500">{t("bookings.emptyDay")}</p>}</article>;
              })}
            </section>
          ) : (
            <>
              <section className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:block">
                <div className="min-w-[1180px]">
                  <div className="grid grid-cols-[8rem_minmax(0,1fr)] border-b border-slate-200 dark:border-slate-800">
                    <div className="border-e p-3 text-xs font-semibold text-slate-500 dark:border-slate-800">{t("bookings.resource")}</div>
                    <div className="relative grid h-10 pe-8" style={{ gridTemplateColumns: `repeat(${HOUR_COUNT}, minmax(0, 1fr))` }}>{Array.from({ length: HOUR_COUNT }, (_, index) => <span className="border-e border-slate-200 px-1 py-2 text-[10px] text-slate-500 dark:border-slate-800" key={index}>{String(index + DAY_START_HOUR).padStart(2, "0")}:00</span>)}<span className="absolute end-0 top-0 px-1 py-2 text-[10px] text-slate-500">24:00</span></div>
                  </div>
                  {resources.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">{t("bookings.noResources")}</p> : Object.entries(resourcesByType).map(([type, group]) => {
                    const shown = selectedResourceId ? group.filter((resource) => resource.id === selectedResourceId) : group;
                    if (!shown.length) return null;
                    return <section key={type}><h2 className="bg-slate-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-950 dark:text-slate-300">{t(`bookings.resourceTypes.${type}`)}</h2>{shown.map(renderResourceCalendar)}</section>;
                  })}
                </div>
              </section>
              <section aria-label={t("bookings.dayList")} className="space-y-3 md:hidden">
                {bookings.filter((booking) => bookingLocalDate(booking) === selectedDate && (!selectedResourceId || booking.resource_id === selectedResourceId)).length === 0
                  ? <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm dark:border-slate-700">{t("bookings.emptyDay")}</p>
                  : bookings.filter((booking) => bookingLocalDate(booking) === selectedDate && (!selectedResourceId || booking.resource_id === selectedResourceId)).map((booking) => renderBookingBlock(booking))}
              </section>
            </>
          )}
        </>
      )}

      {form && modalBackdrop(
        <section aria-labelledby="booking-form-title" aria-modal="true" className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900 sm:p-6" role="dialog">
          <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-brand">{t("bookings.eyebrow")}</p><h2 className="mt-1 text-xl font-bold" id="booking-form-title">{t(editingBooking ? "bookings.editTitle" : "bookings.createTitle")}</h2></div><button aria-label={t("bookings.close")} className="grid size-9 place-items-center rounded-lg border border-slate-300 dark:border-slate-700" onClick={closeForm} type="button"><X size={17} /></button></div>
          {formError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">{t(formError)}{formError === "bookings.errors.slotTaken" && highlightedBookingId && <button className="ms-2 font-semibold underline" onClick={() => { const conflict = bookings.find((booking) => booking.id === highlightedBookingId); if (conflict) { setForm(null); setSelectedBooking(conflict); } }} type="button">{t("bookings.viewConflict")}</button>}</div>}
          {warningOccupied && <p className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"><AlertTriangle className="mt-0.5 shrink-0" size={17} />{t("bookings.occupiedWarning")}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="relative sm:col-span-2"><label className="block text-sm font-medium"><span className="mb-1 block">{t("bookings.customer")}</span><input autoComplete="off" className="min-h-11 w-full rounded-lg border border-slate-300 bg-transparent px-3 dark:border-slate-700" onChange={(event) => { setCustomerQuery(event.target.value); setSelectedCustomer(null); setForm((current) => current && ({ ...current, customerId: "" })); }} placeholder={t("bookings.customerSearch")} value={selectedCustomer ? `${selectedCustomer.first_name} ${selectedCustomer.last_name} · ${selectedCustomer.code}` : customerQuery} /></label>
              {!selectedCustomer && customerQuery.trim().length >= 2 && <div className="absolute inset-x-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">{customerSearchError ? <p className="p-3 text-sm text-red-700">{t("bookings.errors.customerSearch")}</p> : customers.length === 0 ? <p className="p-3 text-sm text-slate-500">{t("bookings.noCustomers")}</p> : customers.map((customer) => <button className="block w-full border-b border-slate-100 p-3 text-start text-sm last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800" key={customer.id} onClick={() => { setSelectedCustomer(customer); setCustomerQuery(""); setForm((current) => current && ({ ...current, customerId: customer.id })); setCustomers([]); }} type="button"><span className="font-semibold">{customer.first_name} {customer.last_name}</span><span className="ms-2 text-slate-500">{customer.code}</span></button>)}</div>}
            </div>
            <label className="block text-sm font-medium"><span className="mb-1 block">{t("bookings.resource")}</span><select className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900" disabled={resourcesLoading} onChange={(event) => { const resource = resources.find((item) => item.id === event.target.value); setForm((current) => current && ({ ...current, resourceId: event.target.value, people: String(Math.min(Number(current.people), resource?.capacity ?? 1)) })); setWarningOccupied(Boolean(resource?.occupied && localDateTime(form.date, form.starts).getTime() >= now.getTime() && localDateTime(form.date, form.starts).getTime() <= now.getTime() + 60 * 60 * 1000)); }} value={form.resourceId} required>
              <option disabled value="">{resourcesLoading ? t("bookings.loadingResources") : resourcesError ? t("bookings.errors.resources") : resources.length ? t("bookings.selectResource") : t("bookings.noAvailableResources")}</option>
              {resources.filter((resource) => resource.status === "available" || resource.id === editingBooking?.resource_id).map((resource) => <option key={resource.id} value={resource.id}>{resource.name} · {t(`bookings.resourceTypes.${resource.type}`)} · {resource.capacity}</option>)}
            </select>
              {resources.length > 0 && !resources.some((resource) => resource.status === "available") && <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">{t("bookings.noAvailableResources")}</span>}
            </label>
            <label className="block text-sm font-medium"><span className="mb-1 block">{t("bookings.date")}</span><input className="min-h-11 w-full rounded-lg border border-slate-300 bg-transparent px-3 dark:border-slate-700" onChange={(event) => { setFormError(""); setForm((current) => current && ({ ...current, date: event.target.value })); }} type="date" value={form.date} /></label>
            <label className="block text-sm font-medium"><span className="mb-1 block">{t("bookings.starts")}</span><input className="min-h-11 w-full rounded-lg border border-slate-300 bg-transparent px-3 dark:border-slate-700" onChange={(event) => { setFormError(""); setForm((current) => current && ({ ...current, starts: event.target.value })); }} type="time" value={form.starts} /></label>
            <label className="block text-sm font-medium"><span className="mb-1 block">{t("bookings.ends")}</span><input className="min-h-11 w-full rounded-lg border border-slate-300 bg-transparent px-3 dark:border-slate-700" onChange={(event) => { setFormError(""); setForm((current) => current && ({ ...current, ends: event.target.value })); }} type="time" value={form.ends} /></label>
            <label className="block text-sm font-medium"><span className="mb-1 block">{t("bookings.people")}</span><input className="min-h-11 w-full rounded-lg border border-slate-300 bg-transparent px-3 dark:border-slate-700" max={resources.find((item) => item.id === form.resourceId)?.capacity ?? 200} min="1" onChange={(event) => setForm((current) => current && ({ ...current, people: event.target.value }))} type="number" value={form.people} /></label>
            <label className="block text-sm font-medium"><span className="mb-1 block">{t("bookings.deposit")}</span><input className="min-h-11 w-full rounded-lg border border-slate-300 bg-transparent px-3 dark:border-slate-700" min="0" onChange={(event) => setForm((current) => current && ({ ...current, deposit: event.target.value }))} step="0.01" type="number" value={form.deposit} /><span className="mt-1 block text-xs text-slate-500">{t("bookings.depositHelp")}</span></label>
            <label className="block text-sm font-medium sm:col-span-2"><span className="mb-1 block">{t("bookings.notes")}</span><textarea className="min-h-24 w-full rounded-lg border border-slate-300 bg-transparent p-3 dark:border-slate-700" maxLength={500} onChange={(event) => setForm((current) => current && ({ ...current, notes: event.target.value }))} value={form.notes} /></label>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2"><button className="min-h-10 rounded-lg border border-slate-300 px-4 font-semibold dark:border-slate-700" disabled={saving} onClick={closeForm} type="button">{t("bookings.cancel")}</button><button className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-4 font-semibold text-white disabled:opacity-50" disabled={saving} onClick={() => void submitBooking()} type="button">{saving && <LoaderCircle className="animate-spin" size={16} />}{t(editingBooking ? "bookings.saveChanges" : "bookings.createBooking")}</button></div>
        </section>,
        closeForm,
      )}

      {selectedBooking && !form && modalBackdrop(
        <section aria-labelledby="booking-details-title" aria-modal="true" className="max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900 sm:p-6" role="dialog">
          <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-brand">{t("bookings.details")}</p><h2 className="mt-1 text-xl font-bold" id="booking-details-title">{selectedBooking.customer_name}</h2></div><button aria-label={t("bookings.close")} className="grid size-9 place-items-center rounded-lg border border-slate-300 dark:border-slate-700" onClick={() => setSelectedBooking(null)} type="button"><X size={17} /></button></div>
          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${bookingStatusColor(selectedBooking.status)}`}>{t(`bookings.status.${selectedBooking.status}`)}</span>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-slate-500">{t("bookings.customer")}</dt><dd className="mt-1 font-semibold">{selectedBooking.customer_name} · {selectedBooking.customer_code}</dd></div>
            <div><dt className="text-slate-500">{t("bookings.resource")}</dt><dd className="mt-1 font-semibold">{selectedBooking.resource_name ?? t("bookings.deletedResource")}</dd></div>
            <div><dt className="text-slate-500">{t("bookings.time")}</dt><dd className="mt-1 font-semibold">{formatDate(new Date(selectedBooking.starts_at), { dateStyle: "medium" })}<br />{formatTime(selectedBooking.starts_at)}–{formatTime(selectedBooking.ends_at)}</dd></div>
            <div><dt className="text-slate-500">{t("bookings.people")}</dt><dd className="mt-1 font-semibold">{selectedBooking.people} / {selectedBooking.resource_capacity}</dd></div>
            <div><dt className="text-slate-500">{t("bookings.deposit")}</dt><dd className="mt-1 font-semibold">{formatMoney(selectedBooking.deposit)}</dd></div>
            <div className="col-span-2"><dt className="text-slate-500">{t("bookings.notes")}</dt><dd className="mt-1 whitespace-pre-wrap">{selectedBooking.notes || t("bookings.noNotes")}</dd></div>
            {selectedBooking.cancel_reason && <div className="col-span-2"><dt className="text-slate-500">{t("bookings.cancelReason")}</dt><dd className="mt-1">{selectedBooking.cancel_reason}</dd></div>}
          </dl>
          {statusError && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">{t(statusError)}</p>}
          {checkInResult && <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100" role="status"><Check className="me-1 inline" size={16} />{t("bookings.checkInSuccess", { id: checkInResult.id, time: formatTime(checkInResult.at) })}</p>}
          {showCancelReason && <label className="mt-4 block text-sm font-medium"><span className="mb-1 block">{t("bookings.cancelReasonRequired")}</span><textarea className="min-h-20 w-full rounded-lg border border-slate-300 bg-transparent p-3 dark:border-slate-700" maxLength={500} onChange={(event) => setCancelReason(event.target.value)} value={cancelReason} /></label>}
          {canManage && (
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {selectedBooking.status === "pending" && <button className="min-h-10 rounded-lg bg-emerald-700 px-3 font-semibold text-white" disabled={statusBusy} onClick={() => void runStatusAction("confirmed")} type="button">{t("bookings.actions.confirm")}</button>}
              {(selectedBooking.status === "pending" || selectedBooking.status === "confirmed") && <button className="min-h-10 rounded-lg border border-slate-300 px-3 font-semibold dark:border-slate-700" disabled={statusBusy} onClick={() => { setShowCancelReason(true); setStatusError(""); }} type="button">{t("bookings.actions.cancel")}</button>}
              {showCancelReason && <button className="min-h-10 rounded-lg bg-red-700 px-3 font-semibold text-white" disabled={statusBusy} onClick={() => void runStatusAction("cancelled", cancelReason)} type="button">{statusBusy && <LoaderCircle className="me-1 inline animate-spin" size={15} />}{t("bookings.confirmCancel")}</button>}
              {selectedBooking.status === "confirmed" && <button className="min-h-10 rounded-lg border border-purple-400 px-3 font-semibold text-purple-900 dark:text-purple-200" disabled={statusBusy} onClick={() => void runStatusAction("no_show")} type="button">{t("bookings.actions.noShow")}</button>}
              {selectedBooking.status === "confirmed" && Date.now() >= Date.parse(selectedBooking.starts_at) - 30 * 60_000 && Date.now() <= Date.parse(selectedBooking.ends_at) && <button className="min-h-10 rounded-lg bg-brand px-3 font-semibold text-white" disabled={statusBusy} onClick={() => void runCheckIn()} type="button">{statusBusy && <LoaderCircle className="me-1 inline animate-spin" size={15} />}{t("bookings.actions.checkIn")}</button>}
              {selectedBooking.status === "checked_in" && <button className="min-h-10 rounded-lg border border-slate-300 px-3 font-semibold dark:border-slate-700" disabled={statusBusy} onClick={() => void runStatusAction("completed")} type="button">{t("bookings.actions.complete")}</button>}
              {(selectedBooking.status === "pending" || selectedBooking.status === "confirmed") && <button className="min-h-10 rounded-lg border border-brand px-3 font-semibold text-brand" onClick={() => openEdit(selectedBooking)} type="button">{t("bookings.actions.edit")}</button>}
            </div>
          )}
        </section>,
        () => setSelectedBooking(null),
      )}
    </main>
  );
}
