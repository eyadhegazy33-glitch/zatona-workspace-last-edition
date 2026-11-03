import { z } from "zod";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  AlertTriangle,
  Boxes,
  CalendarDays,
  Clock3,
  Download,
  Printer,
  ReceiptText,
  ShoppingBasket,
  UsersRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "../hooks/useAuth";
import { getSupabaseClient } from "../lib/supabase";
import { addCalendarDays, formatCalendarDate, getDatePartsInTimeZone, startOfDateInTimeZone } from "../lib/zonedDate";
import { formatMoney as formatCurrency } from "../lib/formatMoney";
import { getOperationalRulesSettings } from "../services/settings";
import type { ReactNode } from "react";

type Preset = "today" | "yesterday" | "last7" | "last30" | "thisMonth" | "custom";
type DateRange = { from: string; to: string };
type OccupancyRow = {
  resource_id: string;
  name: string;
  type: string;
  capacity: number;
  status: string;
  people: number;
  names: string[] | null;
};
type LowStockRow = {
  item_id: string;
  name: string;
  unit: string;
  qty: number;
  min_qty: number;
};
type HourRevenue = { hr: number; revenue: number; receipts_count: number };
type DayRevenue = { day_date: string; revenue: number; fees: number; receipts_count: number };
type TopItem = { item_name: string; qty: number; revenue: number };
type EmployeeOrders = { user_name: string; orders_count: number; total: number };
type OccupancyHour = { hr: number; people: number | null };
type DashboardData = {
  summary: {
    revenue: number;
    revenue_orders: number;
    revenue_fees: number;
    receipts_count: number;
    voided_count: number;
    orders_count: number;
    inside_now: number;
    overdue_now: number;
    open_incidents: number;
    open_alerts: number;
    low_stock: number;
    occupancy: {
      seats_total: number;
      seats_used: number;
      rooms_total: number;
      rooms_used: number;
      tables_total: number;
      tables_used: number;
    };
    resources_in_maintenance: number;
  } | null;
  occupancy: OccupancyRow[];
  revenueByHour: HourRevenue[];
  revenueByDay: DayRevenue[];
  topItems: TopItem[];
  ordersPerUser: EmployeeOrders[];
  occupancyByHour: OccupancyHour[];
  lowStock: LowStockRow[];
};

const emptyData: DashboardData = {
  summary: null,
  occupancy: [],
  revenueByHour: [],
  revenueByDay: [],
  topItems: [],
  ordersPerUser: [],
  occupancyByHour: [],
  lowStock: [],
};

const summarySchema = z.object({
  revenue: z.number(),
  revenue_orders: z.number(),
  revenue_fees: z.number(),
  receipts_count: z.number(),
  voided_count: z.number(),
  orders_count: z.number(),
  inside_now: z.number(),
  overdue_now: z.number(),
  open_incidents: z.number(),
  open_alerts: z.number(),
  low_stock: z.number(),
  occupancy: z.object({
    seats_total: z.number(),
    seats_used: z.number(),
    rooms_total: z.number(),
    rooms_used: z.number(),
    tables_total: z.number(),
    tables_used: z.number(),
  }),
  resources_in_maintenance: z.number(),
});

const chartColor = "#16a34a";
const gridColor = "#cbd5e1";
const axisColor = "#64748b";

function rangeForPreset(preset: Preset, timeZone: string, custom: DateRange): DateRange {
  if (preset === "custom") return custom;
  const today = formatCalendarDate(getDatePartsInTimeZone(new Date(), timeZone));
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") {
    const yesterday = addCalendarDays(today, -1);
    return { from: yesterday, to: yesterday };
  }
  if (preset === "last7") return { from: addCalendarDays(today, -6), to: today };
  if (preset === "last30") return { from: addCalendarDays(today, -29), to: today };
  const [year, month] = today.split("-");
  return { from: `${year}-${month}-01`, to: today };
}

function rangeTimestamps(range: DateRange, timeZone: string): { from: string; to: string } {
  if (!range.from || !range.to || range.from > range.to) throw new Error("invalid_date_range");
  return {
    from: startOfDateInTimeZone(range.from, timeZone).toISOString(),
    to: startOfDateInTimeZone(addCalendarDays(range.to, 1), timeZone).toISOString(),
  };
}

function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(value);
}

function relativeRangeLabel(from: string, to: string, language: string, timeZone: string): string {
  const formatDate = (value: string) => new Intl.DateTimeFormat(language, {
    timeZone,
    dateStyle: "medium",
  }).format(startOfDateInTimeZone(value, timeZone));
  return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
}

function SkeletonCard() {
  return <div aria-hidden="true" className="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />;
}

function ChartEmpty({ text }: { text: string }) {
  return <p className="flex h-64 items-center justify-center px-4 text-center text-sm text-slate-500 dark:text-slate-400">{text}</p>;
}

function ChartSkeleton() {
  return <div aria-hidden="true" className="h-64 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />;
}

function dateAxisLabel(date: string, language: string, timeZone: string): string {
  return new Intl.DateTimeFormat(language, { timeZone, month: "short", day: "numeric" })
    .format(startOfDateInTimeZone(date, timeZone));
}

export function DashboardPage() {
  const { i18n, t } = useTranslation();
  const { permissions, profile } = useAuth();
  const canViewFull = permissions.includes("dashboard.view");
  const canViewOccupancy = permissions.includes("dashboard.occupancy");
  const canViewInventory = permissions.includes("inventory.view");
  const occupancyOnly = !canViewFull && canViewOccupancy;
  const hasDashboard = canViewFull || canViewOccupancy;
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");

  const [preset, setPreset] = useState<Preset>("today");
  const [customRange, setCustomRange] = useState<DateRange>({ from: "", to: "" });
  const [timeZone, setTimeZone] = useState("Africa/Cairo");
  const [currency, setCurrency] = useState("EGP");
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [exported, setExported] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const selectedRange = useMemo(
    () => rangeForPreset(preset, timeZone, customRange),
    [customRange, preset, timeZone],
  );
  const refresh = useCallback(async (showLoading = true) => {
    if (!hasDashboard) {
      setLoading(false);
      return;
    }
    if (showLoading) setLoading(true);
    setError(false);
    try {
      const settings = await getOperationalRulesSettings();
      setTimeZone(settings.timeZone);
      setCurrency(settings.currencyCode);
      const range = rangeForPreset(preset, settings.timeZone, customRange);
      const timestamps = rangeTimestamps(range, settings.timeZone);
      const client = getSupabaseClient();
      const requests = [
        client.rpc("occupancy_now"),
        client.rpc("occupancy_by_hour", { p_day: range.to }),
      ] as const;
      const [occupancyResult, occupancyHoursResult] = await Promise.all(requests);
      if (occupancyResult.error) throw occupancyResult.error;
      if (occupancyHoursResult.error) throw occupancyHoursResult.error;
      const nextData: DashboardData = {
        ...emptyData,
        occupancy: occupancyResult.data,
        occupancyByHour: occupancyHoursResult.data,
      };

      if (canViewFull) {
        const [summaryResult, revenueHourResult, revenueDayResult, topItemsResult, employeeResult] = await Promise.all([
          client.rpc("dashboard_summary", { p_from: timestamps.from, p_to: timestamps.to }),
          client.rpc("revenue_by_hour", { p_day: range.to }),
          client.rpc("revenue_by_day", { p_from: range.from, p_to: range.to }),
          client.rpc("top_items", {
            p_from: timestamps.from,
            p_to: timestamps.to,
            p_limit: 10,
            p_language: i18n.language,
          }),
          client.rpc("orders_per_user", { p_from: timestamps.from, p_to: timestamps.to }),
        ]);
        if (summaryResult.error) throw summaryResult.error;
        if (revenueHourResult.error) throw revenueHourResult.error;
        if (revenueDayResult.error) throw revenueDayResult.error;
        if (topItemsResult.error) throw topItemsResult.error;
        if (employeeResult.error) throw employeeResult.error;
        const summary = summarySchema.parse(summaryResult.data);
        nextData.summary = summary;
        nextData.revenueByHour = revenueHourResult.data;
        nextData.revenueByDay = revenueDayResult.data;
        nextData.topItems = topItemsResult.data;
        nextData.ordersPerUser = employeeResult.data;
      }

      if (canViewInventory && !occupancyOnly) {
        const { data: lowStock, error: lowStockError } = await client.rpc("dashboard_low_stock_items");
        if (lowStockError) throw lowStockError;
        nextData.lowStock = lowStock;
      }

      setData(nextData);
      setUpdatedAt(new Date());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [canViewFull, canViewInventory, customRange, hasDashboard, i18n.language, occupancyOnly, preset]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!hasDashboard) return;
    const client = getSupabaseClient();
    let debounce: number | undefined;
    const channel: RealtimeChannel = client.channel(`dashboard-${crypto.randomUUID()}`);
    channel.on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "dashboard_refresh_signal",
    }, () => {
        window.clearTimeout(debounce);
        debounce = window.setTimeout(() => void refresh(false), 2000);
    });
    channel.subscribe();
    const timer = window.setInterval(() => void refresh(false), 60_000);
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(timer);
      void client.removeChannel(channel);
    };
  }, [hasDashboard, refresh]);

  const formatMoney = useCallback(
    (amount: number) => formatCurrency(amount, currency, i18n.language),
    [currency, i18n.language],
  );

  const occupancySummary = data.summary?.occupancy ?? {
    seats_total: data.occupancy.filter((row) => row.type === "seat" && row.status !== "maintenance").length,
    seats_used: data.occupancy.filter((row) => row.type === "seat" && row.people > 0).length,
    rooms_total: data.occupancy.filter((row) => row.type === "room" && row.status !== "maintenance").length,
    rooms_used: data.occupancy.filter((row) => row.type === "room" && row.people > 0).length,
    tables_total: data.occupancy.filter((row) => row.type === "table" && row.status !== "maintenance").length,
    tables_used: data.occupancy.filter((row) => row.type === "table" && row.people > 0).length,
  };

  const chartCard = "min-w-0 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5";
  const axisDirection = i18n.dir() === "rtl" ? "rtl" : "ltr";
  const moneyTick = (value: number) => formatMoney(value);
  const tooltipMoney = (value: unknown) => typeof value === "number"
    ? formatMoney(value)
    : typeof value === "string" ? value : "";
  const tooltipStyle = {
    backgroundColor: i18n.resolvedLanguage?.startsWith("ar") ? "#0f172a" : "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    color: i18n.resolvedLanguage?.startsWith("ar") ? "#f8fafc" : "#0f172a",
    direction: axisDirection,
  } as const;

  const openRange = () => {
    const currentRange = rangeForPreset(preset, timeZone, customRange);
    setCustomRange({ from: currentRange.from, to: currentRange.to });
    setPreset("custom");
  };

  const exportDashboard = async () => {
    setExportError(false);
    setExported(false);
    setExporting(true);
    try {
      const sheets: Array<{ name: string; headers: string[]; rows: Array<Array<string | number>> }> = [];
      if (occupancyOnly) {
        sheets.push({
          name: t("dashboard.export.occupancy"),
          headers: [
            t("dashboard.floor.resource"),
            t("dashboard.floor.type"),
            t("dashboard.floor.status"),
            t("dashboard.floor.people"),
            t("dashboard.floor.capacityLabel"),
            t("dashboard.floor.peopleNames"),
          ],
          rows: data.occupancy.map((row) => [
            row.name,
            t(`resources.types.${row.type}`, { defaultValue: row.type }),
            t(row.status === "maintenance" ? "dashboard.floor.maintenance" : row.people > 0 ? "dashboard.floor.inUse" : "dashboard.floor.free"),
            row.people,
            row.capacity,
            (row.names ?? []).join(", "),
          ]),
        });
        sheets.push({
          name: t("dashboard.export.occupancyHours"),
          headers: [t("dashboard.chart.hour"), t("dashboard.chart.people")],
          rows: data.occupancyByHour.map((row) => [row.hr, row.people ?? ""]),
        });
      } else {
        const summary = data.summary;
        if (!summary) throw new Error("Dashboard summary is unavailable.");
        sheets.push({
          name: t("dashboard.export.summary"),
          headers: [t("dashboard.export.metric"), t("dashboard.export.value")],
          rows: [
            [t("dashboard.kpis.revenue"), summary.revenue],
            [t("dashboard.kpis.orderRevenue"), summary.revenue_orders],
            [t("dashboard.kpis.feeRevenue"), summary.revenue_fees],
            [t("dashboard.kpis.receipts"), summary.receipts_count],
            [t("dashboard.kpis.orders"), summary.orders_count],
            [t("dashboard.kpis.inside"), summary.inside_now],
            [t("dashboard.kpis.overdue"), summary.overdue_now],
            [t("dashboard.kpis.incidents"), summary.open_incidents],
            [t("dashboard.kpis.alerts"), summary.open_alerts],
            [t("dashboard.kpis.lowStock"), summary.low_stock],
          ],
        });
        sheets.push({
          name: t("dashboard.export.revenueHour"),
          headers: [t("dashboard.chart.hour"), t("dashboard.chart.revenue"), t("dashboard.chart.receipts")],
          rows: data.revenueByHour.map((row) => [row.hr, row.revenue, row.receipts_count]),
        });
        sheets.push({
          name: t("dashboard.export.revenueDay"),
          headers: [t("dashboard.chart.day"), t("dashboard.chart.revenue"), t("dashboard.chart.fees"), t("dashboard.chart.receipts")],
          rows: data.revenueByDay.map((row) => [row.day_date, row.revenue, row.fees, row.receipts_count]),
        });
        sheets.push({
          name: t("dashboard.export.topItems"),
          headers: [t("dashboard.chart.item"), t("dashboard.chart.quantity"), t("dashboard.chart.revenue")],
          rows: data.topItems.map((row) => [row.item_name, row.qty, row.revenue]),
        });
        sheets.push({
          name: t("dashboard.export.occupancyHours"),
          headers: [t("dashboard.chart.hour"), t("dashboard.chart.people")],
          rows: data.occupancyByHour.map((row) => [row.hr, row.people ?? ""]),
        });
        sheets.push({
          name: t("dashboard.export.ordersEmployee"),
          headers: [t("dashboard.chart.employee"), t("dashboard.chart.orders"), t("dashboard.chart.revenue")],
          rows: data.ordersPerUser.map((row) => [row.user_name, row.orders_count, row.total]),
        });
      }
      const { writeDashboardExport } = await import("../lib/sheetjs");
      writeDashboardExport(sheets, "zatona_dashboard.xlsx");
      setExported(true);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };

  const dateRangeControls = (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between print:hidden">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
        <CalendarDays aria-hidden="true" size={17} />
        <span className="sr-only">{t("dashboard.dateFilter.label")}</span>
        <select
          className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
          onChange={(event) => {
            const value = event.target.value as Preset;
            if (value === "custom") openRange();
            else setPreset(value);
          }}
          value={preset}
        >
          {(["today", "yesterday", "last7", "last30", "thisMonth", "custom"] as const).map((value) => (
            <option key={value} value={value}>{t(`dashboard.dateFilter.${value}`)}</option>
          ))}
        </select>
      </label>
      {preset === "custom" ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-500">{t("dashboard.dateFilter.from")}<input aria-label={t("dashboard.dateFilter.from")} className="ms-2 min-h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm text-ink dark:border-slate-700 dark:bg-slate-950 dark:text-white" max={customRange.to || undefined} onChange={(event) => setCustomRange((range) => ({ ...range, from: event.target.value }))} type="date" value={customRange.from} /></label>
          <label className="text-xs text-slate-500">{t("dashboard.dateFilter.to")}<input aria-label={t("dashboard.dateFilter.to")} className="ms-2 min-h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm text-ink dark:border-slate-700 dark:bg-slate-950 dark:text-white" min={customRange.from || undefined} onChange={(event) => setCustomRange((range) => ({ ...range, to: event.target.value }))} type="date" value={customRange.to} /></label>
        </div>
      ) : <p className="text-xs text-slate-500 dark:text-slate-400">{relativeRangeLabel(selectedRange.from, selectedRange.to, i18n.language, timeZone)}</p>}
    </div>
  );

  const occupancyByHourChart = (
    <ChartCard
      title={t("dashboard.charts.occupancyByHour")}
      className={chartCard}
      loading={loading}
      isEmpty={data.occupancyByHour.every((row) => row.people === null)}
      emptyText={t("dashboard.charts.noData")}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data.occupancyByHour} margin={{ top: 8, right: 12, bottom: 8, left: 12 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
          <XAxis dataKey="hr" tick={{ fill: axisColor, fontSize: 12 }} tickFormatter={(hour: number) => `${String(hour).padStart(2, "0")}:00`} />
          <YAxis allowDecimals={false} orientation={axisDirection === "rtl" ? "right" : "left"} tick={{ fill: axisColor, fontSize: 11 }} />
          <Tooltip labelFormatter={(hour) => `${String(hour).padStart(2, "0")}:00`} contentStyle={tooltipStyle} />
          <Area connectNulls dataKey="people" fill="#93c5fd" fillOpacity={0.45} name={t("dashboard.chart.people")} stroke="#2563eb" type="monotone" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );

  if (!hasDashboard) {
    return (
      <section className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-9">
          <h1 className="text-3xl font-semibold tracking-tight text-ink dark:text-white">{t("dashboard.welcome")}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
            {name ? t("dashboard.descriptionNamed", { name }) : t("dashboard.description")}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="dashboard-print-content mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink dark:text-white">{t("dashboard.title")}</h1>
          {updatedAt && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("dashboard.updatedAt", { time: new Intl.DateTimeFormat(i18n.language, { timeStyle: "short", timeZone }).format(updatedAt) })}</p>}
          <p className="hidden text-xs text-slate-500 print:block">{relativeRangeLabel(selectedRange.from, selectedRange.to, i18n.language, timeZone)}</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <button aria-busy={exporting} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800" disabled={loading || exporting} onClick={() => void exportDashboard()} type="button"><Download aria-hidden="true" size={16} />{exporting ? t("dashboard.export.preparing") : t("dashboard.export.button")}</button>
          <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800" disabled={loading} onClick={() => setShowPrintPreview(true)} type="button"><Printer aria-hidden="true" size={16} />{t("dashboard.export.print")}</button>
        </div>
      </header>

      {dateRangeControls}
      {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">{t("dashboard.errors.load")} <button className="ms-2 font-semibold underline" onClick={() => void refresh()} type="button">{t("dashboard.actions.retry")}</button></p>}
      {exportError && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">{t("dashboard.errors.export")}</p>}
      {exported && <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" role="status">{t("dashboard.export.downloaded")}</p>}

      {!occupancyOnly && (
        <section aria-label={t("dashboard.kpis.heading")} className="mt-5">
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <SkeletonCard key={index} />)}</div>
          ) : data.summary && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard icon={<ReceiptText size={19} />} label={t("dashboard.kpis.revenue")} value={formatMoney(data.summary.revenue)} detail={t("dashboard.kpis.revenueSplit", { orders: formatMoney(data.summary.revenue_orders), fees: formatMoney(data.summary.revenue_fees) })} to={permissions.includes("receipts.view") || permissions.includes("receipts.view_own") ? "/receipts" : undefined} />
              <KpiCard icon={<ReceiptText size={19} />} label={t("dashboard.kpis.receipts")} value={formatNumber(data.summary.receipts_count, i18n.language)} to={permissions.some((permission) => ["receipts.view", "receipts.view_own"].includes(permission)) ? "/receipts" : undefined} />
              <KpiCard icon={<ShoppingBasket size={19} />} label={t("dashboard.kpis.orders")} value={formatNumber(data.summary.orders_count, i18n.language)} to={permissions.includes("orders.view") ? "/orders" : undefined} />
              <KpiCard icon={<UsersRound size={19} />} label={t("dashboard.kpis.inside")} value={formatNumber(data.summary.inside_now, i18n.language)} to={permissions.includes("timers.view") ? "/timers" : undefined} />
              <KpiCard alert={data.summary.overdue_now > 0} icon={<Clock3 size={19} />} label={t("dashboard.kpis.overdue")} value={formatNumber(data.summary.overdue_now, i18n.language)} to={permissions.includes("timers.view") ? "/timers" : undefined} />
              <KpiCard icon={<AlertTriangle size={19} />} label={t("dashboard.kpis.incidents")} value={formatNumber(data.summary.open_incidents, i18n.language)} to={permissions.some((permission) => ["incidents.view", "incidents.report", "incidents.manage"].includes(permission)) ? "/incidents" : undefined} />
              <KpiCard icon={<AlertTriangle size={19} />} label={t("dashboard.kpis.alerts")} value={formatNumber(data.summary.open_alerts, i18n.language)} to={permissions.includes("alerts.view") ? "/alerts" : undefined} />
              <KpiCard icon={<Boxes size={19} />} label={t("dashboard.kpis.lowStock")} value={formatNumber(data.summary.low_stock, i18n.language)} to={permissions.includes("inventory.view") ? "/inventory" : undefined} />
            </div>
          )}
        </section>
      )}

      <section aria-label={t("dashboard.occupancy.heading")} className="mt-5">
        <h2 className="mb-3 text-lg font-semibold text-ink dark:text-white">{t("dashboard.occupancy.heading")}</h2>
        {loading ? <div className="grid gap-3 sm:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <SkeletonCard key={index} />)}</div> : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["seats", "rooms", "tables"] as const).map((resourceType) => {
                const used = occupancySummary[`${resourceType}_used`];
                const total = occupancySummary[`${resourceType}_total`];
                const ratio = total ? Math.min(100, (used / total) * 100) : 0;
                return (
                  <article className={chartCard} key={resourceType}>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">{t(`dashboard.occupancy.${resourceType}`)}</h3>
                      <p className="text-lg font-bold tabular-nums text-ink dark:text-white">{formatNumber(used, i18n.language)} / {formatNumber(total, i18n.language)}</p>
                    </div>
                    <div aria-label={t("dashboard.occupancy.gaugeLabel", { used, total })} className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="meter" aria-valuemax={total} aria-valuemin={0} aria-valuenow={used}>
                      <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${ratio}%` }} />
                    </div>
                  </article>
                );
              })}
            </div>
            <div className={`mt-4 ${chartCard}`}>
              <h3 className="font-semibold text-ink dark:text-white">{t("dashboard.occupancy.floor")}</h3>
              {data.occupancy.length === 0 ? <ChartEmpty text={t("dashboard.occupancy.noResources")} /> : (
                <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {data.occupancy.map((resource) => {
                    const maintenance = resource.status === "maintenance";
                    const inUse = resource.people > 0;
                    return (
                      <li className={`min-h-28 rounded-xl border p-3 ${
                        maintenance
                          ? "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          : inUse
                            ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                            : "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100"
                      }`} key={resource.resource_id}>
                        <p className="text-xs font-medium opacity-75">{t(`resources.types.${resource.type}`, { defaultValue: resource.type })}</p>
                        <p className="mt-1 break-words font-semibold">{resource.name}</p>
                        <p className="mt-1 text-sm">{maintenance ? t("dashboard.floor.maintenance") : inUse ? t("dashboard.floor.peopleCount", { count: resource.people }) : t("dashboard.floor.free")}</p>
                        {!maintenance && <p className="text-xs opacity-75">{t("dashboard.floor.capacity", { count: resource.capacity })}</p>}
                        {resource.names && resource.names.length > 0 && <p className="mt-2 break-words text-xs">{resource.names.join(", ")}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </section>

      {occupancyOnly && (
        <section aria-label={t("dashboard.charts.occupancyByHour")} className="mt-5">
          {occupancyByHourChart}
        </section>
      )}

      {!occupancyOnly && (
        <section aria-label={t("dashboard.charts.heading")} className="mt-5">
          <h2 className="mb-3 text-lg font-semibold text-ink dark:text-white">{t("dashboard.charts.heading")}</h2>
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title={t("dashboard.charts.revenueByHour")} className={chartCard} loading={loading} isEmpty={data.revenueByHour.length === 0} emptyText={t("dashboard.charts.noData")}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.revenueByHour} margin={{ top: 8, right: 12, bottom: 8, left: 12 }}>
                  <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                  <XAxis dataKey="hr" tick={{ fill: axisColor, fontSize: 12 }} tickFormatter={(hour: number) => `${String(hour).padStart(2, "0")}:00`} tickLine={false} />
                  <YAxis orientation={axisDirection === "rtl" ? "right" : "left"} tick={{ fill: axisColor, fontSize: 11, direction: axisDirection }} tickFormatter={moneyTick} width={90} />
                  <Tooltip formatter={tooltipMoney} labelFormatter={(hour) => `${String(hour).padStart(2, "0")}:00`} contentStyle={tooltipStyle} />
                  <Bar dataKey="revenue" fill={chartColor} name={t("dashboard.chart.revenue")} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={t("dashboard.charts.revenueByDay")} className={chartCard} loading={loading} isEmpty={data.revenueByDay.length === 0} emptyText={t("dashboard.charts.noData")}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.revenueByDay} margin={{ top: 8, right: 12, bottom: 8, left: 12 }}>
                  <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                  <XAxis dataKey="day_date" tick={{ fill: axisColor, fontSize: 11, direction: axisDirection }} tickFormatter={(day: string) => dateAxisLabel(day, i18n.language, timeZone)} minTickGap={18} />
                  <YAxis orientation={axisDirection === "rtl" ? "right" : "left"} tick={{ fill: axisColor, fontSize: 11, direction: axisDirection }} tickFormatter={moneyTick} width={90} />
                  <Tooltip formatter={tooltipMoney} labelFormatter={(day) => dateAxisLabel(String(day), i18n.language, timeZone)} contentStyle={tooltipStyle} />
                  <Area dataKey="revenue" fill="#86efac" fillOpacity={0.45} name={t("dashboard.chart.revenue")} stroke={chartColor} type="monotone" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={t("dashboard.charts.topItems")} className={chartCard} loading={loading} isEmpty={data.topItems.length === 0} emptyText={t("dashboard.charts.noData")}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.topItems} layout="vertical" margin={{ top: 6, right: 12, bottom: 6, left: 4 }}>
                  <CartesianGrid stroke={gridColor} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fill: axisColor, fontSize: 11 }} allowDecimals={false} />
                  <YAxis dataKey="item_name" type="category" width={120} orientation={axisDirection === "rtl" ? "right" : "left"} tick={{ fill: axisColor, fontSize: 11, direction: axisDirection }} />
                  <Tooltip formatter={(value, key) => key === "revenue" ? tooltipMoney(typeof value === "number" ? value : String(value)) : value} contentStyle={tooltipStyle} />
                  <Bar dataKey="qty" fill={chartColor} name={t("dashboard.chart.quantity")} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {occupancyByHourChart}

            <ChartCard title={t("dashboard.charts.ordersPerEmployee")} className={`${chartCard} xl:col-span-2`} loading={loading} isEmpty={data.ordersPerUser.length === 0} emptyText={t("dashboard.charts.noData")}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.ordersPerUser} margin={{ top: 8, right: 12, bottom: 48, left: 12 }}>
                  <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                  <XAxis dataKey="user_name" interval={0} angle={axisDirection === "rtl" ? 20 : -20} textAnchor={axisDirection === "rtl" ? "start" : "end"} height={60} tick={{ fill: axisColor, fontSize: 11, direction: axisDirection }} />
                  <YAxis allowDecimals={false} orientation={axisDirection === "rtl" ? "right" : "left"} tick={{ fill: axisColor, fontSize: 11 }} />
                  <Tooltip formatter={(value, key) => key === "total" ? tooltipMoney(typeof value === "number" ? value : String(value)) : value} contentStyle={tooltipStyle} />
                  <Bar dataKey="orders_count" fill={chartColor} name={t("dashboard.chart.orders")} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </section>
      )}

      {canViewInventory && !occupancyOnly && (
        <section className={`mt-5 ${chartCard}`}>
          <h2 className="flex items-center gap-2 font-semibold text-ink dark:text-white"><Boxes aria-hidden="true" size={18} />{t("dashboard.lowStock.title")}</h2>
          {loading ? <div aria-hidden="true" className="mt-4 h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" /> : data.lowStock.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t("dashboard.lowStock.empty")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-200 dark:divide-slate-800">
              {data.lowStock.map((item) => <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={item.item_id}><Link className="font-medium text-brand hover:underline" to={`/inventory?item=${encodeURIComponent(item.item_id)}`}>{item.name}</Link><span className="text-sm font-semibold text-red-700 dark:text-red-300">{formatNumber(item.qty, i18n.language)} / {formatNumber(item.min_qty, i18n.language)} {item.unit}</span></li>)}
            </ul>
          )}
        </section>
      )}

      {showPrintPreview && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 p-4 print:hidden"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowPrintPreview(false);
          }}
        >
          <section
            aria-labelledby="dashboard-print-preview-title"
            aria-modal="true"
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900 sm:p-7"
            dir={i18n.dir()}
            role="dialog"
          >
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-ink dark:text-white" id="dashboard-print-preview-title">
                  {t("dashboard.export.previewTitle")}
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {relativeRangeLabel(selectedRange.from, selectedRange.to, i18n.language, timeZone)}
                </p>
              </div>
              <button
                aria-label={t("dashboard.export.closePreview")}
                className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700"
                onClick={() => setShowPrintPreview(false)}
                type="button"
              >
                {t("dashboard.export.closePreview")}
              </button>
            </header>
            {data.summary ? (
              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  [t("dashboard.kpis.revenue"), formatMoney(data.summary.revenue)],
                  [t("dashboard.kpis.orderRevenue"), formatMoney(data.summary.revenue_orders)],
                  [t("dashboard.kpis.feeRevenue"), formatMoney(data.summary.revenue_fees)],
                  [t("dashboard.kpis.receipts"), formatNumber(data.summary.receipts_count, i18n.language)],
                  [t("dashboard.kpis.orders"), formatNumber(data.summary.orders_count, i18n.language)],
                  [t("dashboard.kpis.inside"), formatNumber(data.summary.inside_now, i18n.language)],
                  [t("dashboard.kpis.overdue"), formatNumber(data.summary.overdue_now, i18n.language)],
                  [t("dashboard.kpis.incidents"), formatNumber(data.summary.open_incidents, i18n.language)],
                  [t("dashboard.kpis.alerts"), formatNumber(data.summary.open_alerts, i18n.language)],
                  [t("dashboard.kpis.lowStock"), formatNumber(data.summary.low_stock, i18n.language)],
                ].map(([label, value]) => (
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700" key={label}>
                    <dt className="text-sm text-slate-500 dark:text-slate-400">{label}</dt>
                    <dd className="mt-1 text-lg font-bold text-ink dark:text-white">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <dl className="mt-5 grid gap-3 sm:grid-cols-3">
                {[
                  [t("dashboard.occupancy.seats"), `${occupancySummary.seats_used} / ${occupancySummary.seats_total}`],
                  [t("dashboard.occupancy.rooms"), `${occupancySummary.rooms_used} / ${occupancySummary.rooms_total}`],
                  [t("dashboard.occupancy.tables"), `${occupancySummary.tables_used} / ${occupancySummary.tables_total}`],
                ].map(([label, value]) => (
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700" key={label}>
                    <dt className="text-sm text-slate-500 dark:text-slate-400">{label}</dt>
                    <dd className="mt-1 text-lg font-bold text-ink dark:text-white">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white"
                onClick={() => window.print()}
                type="button"
              >
                <Printer aria-hidden="true" size={16} />
                {t("dashboard.export.printNow")}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function KpiCard({
  icon,
  label,
  value,
  detail,
  to,
  alert = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  to?: string;
  alert?: boolean;
}) {
  const className = `block min-h-28 rounded-2xl border p-4 shadow-sm transition ${
    alert
      ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/35"
      : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
  } ${to ? "hover:border-brand hover:shadow-md" : ""}`;
  const content = (
    <>
      <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">{icon}<span>{label}</span></div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${alert ? "text-red-700 dark:text-red-300" : "text-ink dark:text-white"}`}>{value}</p>
      {detail && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{detail}</p>}
    </>
  );
  return to ? <Link className={className} to={to}>{content}</Link> : <article className={className}>{content}</article>;
}

function ChartCard({
  title,
  className,
  loading,
  isEmpty,
  emptyText,
  children,
}: {
  title: string;
  className: string;
  loading: boolean;
  isEmpty: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <article className={className}>
      <h3 className="mb-4 font-semibold text-ink dark:text-white">{title}</h3>
      {loading ? <ChartSkeleton /> : isEmpty ? <ChartEmpty text={emptyText} /> : <div className="h-64" dir="auto">{children}</div>}
    </article>
  );
}
