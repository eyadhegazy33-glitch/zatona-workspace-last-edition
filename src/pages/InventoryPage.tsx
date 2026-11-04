import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  Check,
  CircleHelp,
  History,
  LoaderCircle,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";
import { InventoryRecipesTab } from "../components/InventoryRecipesTab";
import { SearchFilterBar } from "../components/SearchFilterBar";
import { useAuth } from "../hooks/useAuth";
import { getSupabaseClient } from "../lib/supabase";

type InventoryItem = {
  id: string;
  name: string;
  unit: string;
  qty: number;
  min_qty: number;
  active: boolean;
  created_at: string;
};

type InventoryMovement = {
  id: number;
  created_at: string;
  change: number;
  qty_before: number;
  qty_after: number;
  reason: string;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  order_id: string | null;
};

type ItemForm = {
  id: string | null;
  name: string;
  unit: string;
  minQty: string;
  quantityToAdd: string;
  quantityReason: string;
  active: boolean;
};

type AdjustmentForm = {
  item: InventoryItem;
  change: string;
  reason: string;
  notes: string;
};

const itemSchema = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(100),
  unit: z.string().trim().min(1).max(30),
  minQty: z.coerce.number().finite().min(0).max(9999999999.99)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8),
  active: z.boolean(),
});

const itemQuantitySchema = z.object({
  quantity: z.coerce.number().finite().min(0).max(9999999999.99)
    .refine((value) => Math.abs(value * 10000 - Math.round(value * 10000)) < 1e-7),
  reason: z.string().trim().max(500),
});

const adjustmentSchema = z.object({
  change: z.coerce.number().finite().min(-9999999999.99).max(9999999999.99)
    .refine((value) => value !== 0 && Math.abs(value * 10000 - Math.round(value * 10000)) < 1e-7),
  reason: z.string().trim().min(3).max(500),
  notes: z.string().trim().max(500),
});

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message).toLowerCase();
  }
  return "";
}

export function InventoryPage() {
  const { i18n, t } = useTranslation();
  const [searchParams] = useSearchParams();
  const requestedItemId = searchParams.get("item");
  const { permissions, profile } = useAuth();
  const isInventoryAdmin = ["Admin", "Manager", "owner"].includes(
    profile?.role?.name ?? "",
  );
  const canManage = isInventoryAdmin || permissions.includes("inventory.manage");
  const canAdjust = canManage || permissions.includes("inventory.adjust");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [activeFilter, setActiveFilter] = useState("");
  const [sort, setSort] = useState<"name" | "newest" | "oldest" | "quantity-high" | "quantity-low">("name");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [itemForm, setItemForm] = useState<ItemForm | null>(null);
  const [adjustment, setAdjustment] = useState<AdjustmentForm | null>(null);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");
  const [activeTab, setActiveTab] = useState<"stock" | "recipes">("stock");
  const selectedItemId = selectedItem?.id;
  const autoOpenedItemId = useRef<string | null>(null);

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const { data, error: resultError } = await getSupabaseClient()
        .from("inventory_items")
        .select("id,name,unit,qty,min_qty,active,created_at")
        .order("name");
      if (resultError) throw resultError;
      setItems(data);
      setSelectedItem((current) => current
        ? data.find((item) => item.id === current.id) ?? current
        : current);
    } catch {
      setError("inventory.errors.load");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const loadMovements = useCallback(async (itemId: string) => {
    setHistoryLoading(true);
    try {
      const { data, error: resultError } = await getSupabaseClient()
        .rpc("list_inventory_movements_detailed", { p_item: itemId });
      if (resultError) throw resultError;
      setFormError("");
      setMovements(data);
    } catch {
      setFormError("inventory.errors.history");
      setMovements([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!requestedItemId || items.length === 0 || autoOpenedItemId.current === requestedItemId) return;
    const item = items.find((candidate) => candidate.id === requestedItemId);
    if (!item) return;
    autoOpenedItemId.current = requestedItemId;
    setSelectedItem(item);
    void loadMovements(item.id);
  }, [items, loadMovements, requestedItemId]);

  useEffect(() => {
    const client = getSupabaseClient();
    let debounce: number | undefined;
    const channel = client
      .channel(`inventory-items-${crypto.randomUUID()}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "inventory_items",
      }, () => {
        window.clearTimeout(debounce);
        debounce = window.setTimeout(() => {
          void refresh(false);
          if (selectedItemId) void loadMovements(selectedItemId);
        }, 1000);
      })
      .subscribe();

    return () => {
      window.clearTimeout(debounce);
      void client.removeChannel(channel);
    };
  }, [loadMovements, refresh, selectedItemId]);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(i18n.language);
    const collator = new Intl.Collator(i18n.language, { sensitivity: "base" });
    return items.filter((item) => {
      const matchesQuery = !needle ||
        item.id.toLocaleLowerCase().includes(needle) ||
        item.name.toLocaleLowerCase(i18n.language).includes(needle) ||
        item.unit.toLocaleLowerCase(i18n.language).includes(needle);
      const isLow = item.qty <= item.min_qty;
      const matchesFrom = !createdFrom ||
        Date.parse(item.created_at) >= new Date(`${createdFrom}T00:00:00`).getTime();
      const endOfDay = createdTo ? new Date(`${createdTo}T00:00:00`) : null;
      endOfDay?.setDate(endOfDay.getDate() + 1);
      const matchesTo = !createdTo ||
        Date.parse(item.created_at) < (endOfDay?.getTime() ?? 0);
      return matchesQuery &&
        (!lowOnly || isLow) &&
        (!activeFilter || (activeFilter === "active" ? item.active : !item.active)) &&
        matchesFrom &&
        matchesTo;
    }).sort((left, right) => {
      if (sort === "newest" || sort === "oldest") {
        const direction = sort === "newest" ? -1 : 1;
        return direction * (Date.parse(left.created_at) - Date.parse(right.created_at));
      }
      if (sort === "quantity-high" || sort === "quantity-low") {
        const direction = sort === "quantity-high" ? -1 : 1;
        return direction * (left.qty - right.qty);
      }
      return collator.compare(left.name, right.name);
    });
  }, [activeFilter, createdFrom, createdTo, i18n.language, items, lowOnly, query, sort]);

  const formatNumber = (value: number) => new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 4,
  }).format(value);
  const formatDate = (value: string) => new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
  const inputClass = "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink dark:border-slate-700 dark:bg-slate-950 dark:text-white";

  const openNewItem = () => {
    setFormError("");
    setNotice("");
    setItemForm({
      id: null,
      name: "",
      unit: "",
      minQty: "0",
      quantityToAdd: "",
      quantityReason: "",
      active: true,
    });
  };

  const saveItem = async (adjustAfterSave = false) => {
    if (!itemForm || busy) return;
    const parsed = itemSchema.safeParse(
      adjustAfterSave ? { ...itemForm, active: true } : itemForm,
    );
    if (!parsed.success) {
      setFormError("inventory.errors.invalidItem");
      return;
    }
    const parsedQuantity = itemQuantitySchema.safeParse({
      quantity: itemForm.quantityToAdd || "0",
      reason: itemForm.quantityReason,
    });
    if (
      !parsedQuantity.success ||
      (parsedQuantity.data.quantity > 0 &&
        parsedQuantity.data.reason.trim().length < 3)
    ) {
      setFormError("inventory.errors.invalidQuantity");
      return;
    }
    setBusy(true);
    setFormError("");
    let savedItem: InventoryItem | null = null;
    try {
      const { data, error: rpcError } = await getSupabaseClient().rpc("save_inventory_item", {
        p_id: parsed.data.id,
        p_name: parsed.data.name,
        p_unit: parsed.data.unit,
        p_min_qty: parsed.data.minQty,
        p_active: parsedQuantity.data.quantity > 0 || adjustAfterSave
          ? true
          : parsed.data.active,
      });
      if (rpcError) throw rpcError;
      savedItem = data;
      if (parsedQuantity.data.quantity > 0) {
        const { error: adjustmentError } = await getSupabaseClient().rpc("adjust_stock", {
          p_item: data.id,
          p_change: parsedQuantity.data.quantity,
          p_reason: parsedQuantity.data.reason.trim(),
        });
        if (adjustmentError) throw adjustmentError;
      }
      setItemForm(null);
      if (adjustAfterSave && parsedQuantity.data.quantity === 0) {
        setNotice("");
        setAdjustment({
          item: data,
          change: "",
          reason: "",
          notes: "",
        });
      } else {
        setNotice(parsedQuantity.data.quantity > 0
          ? t("inventory.quantityAdded")
          : t(parsed.data.id ? "inventory.saved" : "inventory.created"));
      }
      await refresh(false);
    } catch (cause) {
      const message = getErrorMessage(cause);
      if (savedItem && parsedQuantity.data.quantity > 0) {
        setItemForm({
          ...itemForm,
          id: savedItem.id,
          active: savedItem.active,
          quantityToAdd: "",
          quantityReason: "",
        });
      }
      setFormError(message.includes("duplicate")
        ? "inventory.errors.duplicate"
        : message.includes("stock cannot be negative")
          ? "inventory.errors.negativeStock"
          : message.includes("not allowed")
            ? "inventory.errors.permission"
            : itemForm.quantityToAdd && Number(itemForm.quantityToAdd) > 0
              ? "inventory.errors.quantityAdd"
              : "inventory.errors.save");
    } finally {
      setBusy(false);
    }
  };

  const openAdjustment = (item: InventoryItem, reason = "", change = "") => {
    setFormError("");
    setNotice("");
    setAdjustment({ item, reason, change, notes: "" });
  };

  const adjustStock = async () => {
    if (!adjustment || busy) return;
    const parsed = adjustmentSchema.safeParse(adjustment);
    if (!parsed.success) {
      setFormError("inventory.errors.invalidAdjustment");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      const { error: rpcError } = await getSupabaseClient().rpc("adjust_stock", {
        p_item: adjustment.item.id,
        p_change: parsed.data.change,
        p_reason: parsed.data.reason,
        p_notes: parsed.data.notes || null,
      });
      if (rpcError) throw rpcError;
      setAdjustment(null);
      setNotice(t("inventory.adjusted"));
      await refresh(false);
      if (selectedItem?.id === adjustment.item.id) {
        await loadMovements(adjustment.item.id);
      }
    } catch (cause) {
      const message = getErrorMessage(cause);
      setFormError(message.includes("stock cannot be negative")
        ? "inventory.errors.negativeStock"
        : message.includes("not allowed")
          ? "inventory.errors.permission"
          : "inventory.errors.adjust");
    } finally {
      setBusy(false);
    }
  };

  const openDetails = (item: InventoryItem) => {
    setFormError("");
    setSelectedItem(item);
    if (canManage) void loadMovements(item.id);
  };

  const closeDialogs = () => {
    if (busy) return;
    setItemForm(null);
    setAdjustment(null);
    setFormError("");
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-7 sm:px-6 lg:px-8" dir={i18n.dir()}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-brand">
            <Boxes size={18} />{t("inventory.eyebrow")}
          </p>
          <h1 className="mt-1 text-3xl font-bold text-ink dark:text-white">{t("inventory.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">{t(activeTab === "recipes" ? "inventory.recipesDescription" : "inventory.description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <button
              aria-pressed={activeTab === "recipes"}
              className={`min-h-11 rounded-xl border px-4 font-semibold ${activeTab === "recipes" ? "border-brand bg-brand/10 text-brand" : "border-slate-300 dark:border-slate-700"}`}
              onClick={() => setActiveTab(activeTab === "recipes" ? "stock" : "recipes")}
              type="button"
            >
              {t(activeTab === "recipes" ? "inventory.stock" : "inventory.recipes")}
            </button>
          )}
          {canManage && activeTab === "stock" && (
            <button className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white" onClick={openNewItem} type="button">
              <Plus size={18} />{t("inventory.addItem")}
            </button>
          )}
        </div>
      </header>

      {activeTab === "recipes" && canManage ? <InventoryRecipesTab /> : <>
      {error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert"><span>{t(error)}</span><button className="font-semibold underline" onClick={() => void refresh()} type="button">{t("inventory.retry")}</button></div>}
      {notice && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" role="status">{notice}</p>}

      <section className="space-y-4">
        <SearchFilterBar
          onClear={() => {
            setQuery("");
            setLowOnly(false);
            setActiveFilter("");
            setSort("name");
            setCreatedFrom("");
            setCreatedTo("");
          }}
          onSearchChange={setQuery}
          search={query}
          searchPlaceholder={t("inventory.search")}
        >
          <label className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-medium dark:border-slate-700">
            <input checked={lowOnly} className="size-4 accent-brand" onChange={(event) => setLowOnly(event.target.checked)} type="checkbox" />
            {t("inventory.lowOnly")}
          </label>
          <label className="min-w-36">
            <span className="sr-only">{t("inventory.filterStatus")}</span>
            <select className={inputClass} onChange={(event) => setActiveFilter(event.target.value)} value={activeFilter}>
              <option value="">{t("inventory.allStatuses")}</option>
              <option value="active">{t("common.active")}</option>
              <option value="inactive">{t("inventory.inactive")}</option>
            </select>
          </label>
          <label className="min-w-36">
            <span className="sr-only">{t("common.sort")}</span>
            <select className={inputClass} onChange={(event) => setSort(event.target.value as typeof sort)} value={sort}>
              <option value="name">{t("common.sortAlphabetically")}</option>
              <option value="newest">{t("common.sortNewest")}</option>
              <option value="oldest">{t("common.sortOldest")}</option>
              <option value="quantity-high">{t("common.sortHighestQuantity")}</option>
              <option value="quantity-low">{t("common.sortLowestQuantity")}</option>
            </select>
          </label>
          <label className="min-w-36">
            <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t("common.fromDate")}</span>
            <input aria-label={t("common.fromDate")} className={inputClass} onChange={(event) => setCreatedFrom(event.target.value)} type="date" value={createdFrom} />
          </label>
          <label className="min-w-36">
            <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t("common.toDate")}</span>
            <input aria-label={t("common.toDate")} className={inputClass} onChange={(event) => setCreatedTo(event.target.value)} type="date" value={createdTo} />
          </label>
        </SearchFilterBar>

        {loading ? (
          <div className="grid min-h-48 place-items-center" role="status"><LoaderCircle className="animate-spin text-brand" size={30} /></div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
            <Boxes className="mx-auto text-slate-400" size={30} />
            <p className="mt-2 font-semibold text-ink dark:text-white">{items.length === 0 ? t("inventory.empty") : t("inventory.emptyFilter")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-start text-sm">
              <thead><tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                <th className="p-3 text-start">{t("inventory.name")}</th>
                <th className="p-3 text-start">{t("inventory.unit")}</th>
                <th className="p-3 text-end">{t("inventory.quantity")}</th>
                <th className="p-3 text-end">{t("inventory.minimum")}</th>
                <th className="p-3 text-start">{t("inventory.status")}</th>
                <th className="p-3 text-end">{t("inventory.actions")}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredItems.map((item) => {
                  const low = item.qty <= item.min_qty;
                  return (
                    <tr className={!item.active ? "opacity-60" : ""} key={item.id}>
                      <td className="p-3">
                        <button className="font-semibold text-ink underline-offset-2 hover:underline dark:text-white" onClick={() => openDetails(item)} type="button">{item.name}</button>
                        {!item.active && <span className="ms-2 text-xs text-slate-500">{t("inventory.inactive")}</span>}
                      </td>
                      <td className="p-3">{item.unit}</td>
                      <td className="p-3 text-end font-semibold tabular-nums">{formatNumber(item.qty)}</td>
                      <td className="p-3 text-end tabular-nums">{formatNumber(item.min_qty)}</td>
                      <td className="p-3"><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${low ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"}`}>{low ? <AlertTriangle size={13} /> : <Check size={13} />}{t(low ? "inventory.lowStock" : "inventory.ok")}</span></td>
                      <td className="p-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          {canManage && <button aria-label={t("inventory.editItem", { name: item.name })} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-300 px-2.5 text-xs font-semibold dark:border-slate-700" onClick={() => { setFormError("");                           setItemForm({ id: item.id, name: item.name, unit: item.unit, minQty: String(item.min_qty), quantityToAdd: "", quantityReason: "", active: item.active }); }} type="button"><Pencil size={14} />{t("inventory.edit")}</button>}
                          {canAdjust && <button className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-brand px-2.5 text-xs font-semibold text-white" onClick={() => openAdjustment(item)} type="button"><Plus size={14} />{t("inventory.adjustStock")}</button>}
                          {!canManage && canAdjust && (
                            <div aria-label={t("inventory.reportProblem")} className="flex flex-wrap justify-end gap-2" role="group">
                              <button className="min-h-9 rounded-lg border border-amber-300 px-2.5 text-xs font-semibold text-amber-900 dark:border-amber-900 dark:text-amber-200" onClick={() => openAdjustment(item, "Running low")} type="button">{t("inventory.runningLow")}</button>
                              <button className="min-h-9 rounded-lg border border-red-300 px-2.5 text-xs font-semibold text-red-800 dark:border-red-900 dark:text-red-200" onClick={() => openAdjustment(item, "Finished", item.qty > 0 ? String(-item.qty) : "")} type="button">{t("inventory.finished")}</button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(itemForm || adjustment || selectedItem) && (
        <div className="fixed inset-0 z-[70] flex justify-end bg-slate-950/50" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setSelectedItem(null); closeDialogs(); } }}>
          {selectedItem && !itemForm && !adjustment ? (
            <aside aria-label={selectedItem.name} className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl dark:bg-slate-900" role="dialog">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 dark:border-slate-800">
                <div><p className="text-sm font-semibold text-brand">{t("inventory.itemDetails")}</p><h2 className="mt-1 text-2xl font-bold text-ink dark:text-white">{selectedItem.name}</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{formatNumber(selectedItem.qty)} {selectedItem.unit} · {t("inventory.minimumShort", { amount: formatNumber(selectedItem.min_qty) })}</p></div>
                <button aria-label={t("inventory.close")} className="grid size-10 shrink-0 place-items-center rounded-lg border border-slate-300 dark:border-slate-700" onClick={() => setSelectedItem(null)} type="button"><X size={18} /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                {canManage ? (
                  <>
                    <h3 className="flex items-center gap-2 font-bold text-ink dark:text-white"><History size={17} />{t("inventory.movementHistory")}</h3>
                    {formError && <p className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert"><span>{t(formError)}</span><button className="font-semibold underline" onClick={() => void loadMovements(selectedItem.id)} type="button">{t("inventory.retry")}</button></p>}
                    {historyLoading ? <div className="grid min-h-32 place-items-center"><LoaderCircle className="animate-spin text-brand" size={25} /></div> : formError ? null : movements.length === 0 ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">{t("inventory.noMovements")}</p> : (
                      <ol className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
                        {movements.map((movement) => <li className="grid gap-1 py-4 sm:grid-cols-[1fr_auto]" key={movement.id}>
                          <div><p className="font-semibold text-ink dark:text-white">{movement.reason}</p>{movement.notes && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{movement.notes}</p>}<p className="mt-1 text-xs text-slate-500">{formatDate(movement.created_at)} · {movement.created_by_name ?? t("inventory.unknownUser")}</p></div>
                          <div className="text-start sm:text-end"><p className={`font-bold tabular-nums ${movement.change < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>{movement.change > 0 ? "+" : ""}{formatNumber(movement.change)} {selectedItem.unit}</p><p className="text-xs text-slate-500">{t("inventory.before")}: {formatNumber(movement.qty_before)} · {t("inventory.after")}: {formatNumber(movement.qty_after)}</p>{movement.order_id && <p className="text-xs font-medium text-brand">{t("inventory.relatedOrder", { id: movement.order_id })}</p>}</div>
                        </li>)}
                      </ol>
                    )}
                  </>
                ) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">{t("inventory.historyRestricted")}</p>}
              </div>
            </aside>
          ) : (
            <section aria-labelledby="inventory-dialog-title" aria-modal="true" className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900" role="dialog">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div><p className="text-sm font-semibold text-brand">{t("inventory.eyebrow")}</p><h2 className="mt-1 text-xl font-bold text-ink dark:text-white" id="inventory-dialog-title">{t(itemForm ? itemForm.id ? "inventory.editTitle" : "inventory.addTitle" : "inventory.adjustTitle")}</h2></div>
                <button aria-label={t("inventory.close")} className="grid size-9 shrink-0 place-items-center rounded-lg border border-slate-300 dark:border-slate-700" disabled={busy} onClick={closeDialogs} type="button"><X size={17} /></button>
              </div>
              {formError && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">{t(formError)}</p>}
              {itemForm ? (
                <div className="space-y-4">
                  <label className="block text-sm font-medium"><span className="mb-1 block">{t("inventory.name")}</span><input autoFocus className={inputClass} maxLength={100} onChange={(event) => setItemForm((value) => value && ({ ...value, name: event.target.value }))} value={itemForm.name} /></label>
                  <label className="block text-sm font-medium"><span className="mb-1 block">{t("inventory.unit")}</span><input className={inputClass} maxLength={30} onChange={(event) => setItemForm((value) => value && ({ ...value, unit: event.target.value }))} placeholder={t("inventory.unitPlaceholder")} value={itemForm.unit} /></label>
                  <label className="block text-sm font-medium"><span className="mb-1 block">{t("inventory.minimum")}</span><input className={inputClass} min="0" onChange={(event) => setItemForm((value) => value && ({ ...value, minQty: event.target.value }))} step="0.01" type="number" value={itemForm.minQty} /></label>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {itemForm.id
                      ? t("inventory.currentQuantity", {
                          quantity: formatNumber(items.find((item) => item.id === itemForm.id)?.qty ?? 0),
                          unit: itemForm.unit,
                        })
                      : t("inventory.newStartsAtZero")}
                  </p>
                  <label className="block text-sm font-medium">
                    <span className="mb-1 block">{t("inventory.quantityToAdd")}</span>
                    <input
                      className={inputClass}
                      min="0"
                      onChange={(event) => setItemForm((value) => value && ({
                        ...value,
                        quantityToAdd: event.target.value,
                      }))}
                      placeholder={t("inventory.quantityToAddPlaceholder")}
                      step="0.0001"
                      type="number"
                      value={itemForm.quantityToAdd}
                    />
                    <span className="mt-1 block text-xs text-slate-500">
                      {t("inventory.quantityToAddHelp")}
                    </span>
                  </label>
                  {Number(itemForm.quantityToAdd) > 0 && (
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t("inventory.reason")}</span>
                      <input
                        className={inputClass}
                        maxLength={500}
                        onChange={(event) => setItemForm((value) => value && ({
                          ...value,
                          quantityReason: event.target.value,
                        }))}
                        value={itemForm.quantityReason}
                      />
                    </label>
                  )}
                  <label className="flex min-h-10 items-center gap-2 text-sm font-medium"><input checked={itemForm.active} className="size-4 accent-brand" onChange={(event) => setItemForm((value) => value && ({ ...value, active: event.target.checked }))} type="checkbox" />{t("inventory.active")}</label>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button className="min-h-10 rounded-lg border border-slate-300 px-4 font-semibold dark:border-slate-700" disabled={busy} onClick={closeDialogs} type="button">{t("inventory.cancel")}</button>
                    <button className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-brand px-4 font-semibold text-brand disabled:opacity-50" disabled={busy} onClick={() => void saveItem(true)} type="button">
                      {busy && <LoaderCircle className="animate-spin" size={16} />}
                      {itemForm.active ? t("inventory.saveAndAdjust") : t("inventory.activateAndAdjust")}
                    </button>
                    <button className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-4 font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void saveItem()} type="button">{busy && <LoaderCircle className="animate-spin" size={16} />}{t("inventory.save")}</button>
                  </div>
                </div>
              ) : adjustment && (
                <div className="space-y-4">
                  <p className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-950"><span className="font-semibold">{adjustment.item.name}</span> · {t("inventory.currentQuantity", { quantity: formatNumber(adjustment.item.qty), unit: adjustment.item.unit })}</p>
                  <label className="block text-sm font-medium"><span className="mb-1 block">{t("inventory.changeAmount")}</span><input autoFocus className={inputClass} onChange={(event) => setAdjustment((value) => value && ({ ...value, change: event.target.value }))} placeholder={t("inventory.changePlaceholder")} step="0.0001" type="number" value={adjustment.change} /><span className="mt-1 block text-xs text-slate-500">{t("inventory.changeHelp")}</span></label>
                  <div className="flex flex-wrap gap-2">{["Delivery", "Count correction", "Damaged", "Expired", "Waste", "Used", "Running low", "Finished"].map((reason) => <button className={`min-h-9 rounded-full border px-3 text-xs font-medium ${adjustment.reason === reason ? "border-brand bg-brand/10 text-brand" : "border-slate-300 dark:border-slate-700"}`} key={reason} onClick={() => setAdjustment((value) => value && ({ ...value, reason }))} type="button">{t(`inventory.reasons.${reason}`)}</button>)}</div>
                  <label className="block text-sm font-medium"><span className="mb-1 block">{t("inventory.reason")}</span><input className={inputClass} maxLength={500} onChange={(event) => setAdjustment((value) => value && ({ ...value, reason: event.target.value }))} value={adjustment.reason} /></label>
                  <label className="block text-sm font-medium"><span className="mb-1 block">{t("inventory.adjustNotes")}</span><textarea className={`${inputClass} min-h-20 py-3`} maxLength={500} onChange={(event) => setAdjustment((value) => value && ({ ...value, notes: event.target.value }))} value={adjustment.notes} /></label>
                  <p className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"><CircleHelp className="mt-0.5 shrink-0" size={15} />{t("inventory.adjustNote")}</p>
                  <div className="flex justify-end gap-2"><button className="min-h-10 rounded-lg border border-slate-300 px-4 font-semibold dark:border-slate-700" disabled={busy} onClick={closeDialogs} type="button">{t("inventory.cancel")}</button><button className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-4 font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void adjustStock()} type="button">{busy && <LoaderCircle className="animate-spin" size={16} />}{t("inventory.recordAdjustment")}</button></div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
      </>}
    </main>
  );
}
