import {
  ArrowDown,
  ArrowUp,
  Check,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Utensils,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useAuth } from "../hooks/useAuth";
import {
  getMenuImageUrl,
  listAdminMenu,
  removeMenuImage,
  saveMenuCategory,
  saveMenuItem,
  setMenuCategoryOrder,
  updateMenuItemAvailability,
  uploadMenuImage,
  type AdminMenuCategory,
  type AdminMenuItem,
} from "../services/menuAdmin";

type CategoryDraft = {
  id: string | null;
  name_en: string;
  name_ar: string;
  active: boolean;
};

type ItemDraft = {
  id: string | null;
  category_id: string;
  name_en: string;
  name_ar: string;
  description: string;
  price: string;
  qualifies_for_time: boolean;
  available: boolean;
  active: boolean;
  image_path: string | null;
};

const categorySchema = z.object({
  name_en: z.string().trim().min(1).max(80),
  name_ar: z.string().trim().min(1).max(80),
});

const itemSchema = z.object({
  category_id: z.string().uuid(),
  name_en: z.string().trim().min(1).max(100),
  name_ar: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500),
  price: z.coerce.number().finite().min(0).max(1_000_000),
  qualifies_for_time: z.boolean(),
  available: z.boolean(),
  active: z.boolean(),
});

const inputClass =
  "mt-1.5 min-w-0 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white";
const secondaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800";
const primaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50";

function blankCategory(): CategoryDraft {
  return { id: null, name_en: "", name_ar: "", active: true };
}

function blankItem(categoryId = ""): ItemDraft {
  return {
    id: null,
    category_id: categoryId,
    name_en: "",
    name_ar: "",
    description: "",
    price: "0",
    qualifies_for_time: false,
    available: true,
    active: true,
    image_path: null,
  };
}

function getErrorKey(cause: unknown): string {
  if (cause instanceof Error && cause.message.startsWith("menuAdmin.errors.")) {
    return cause.message;
  }
  if (cause && typeof cause === "object" && "code" in cause) {
    if (cause.code === "42501") return "menuAdmin.errors.permission";
    if (cause.code === "23505") return "menuAdmin.errors.duplicate";
  }
  return "menuAdmin.errors.action";
}

export function AdminMenuPage() {
  const { i18n, t } = useTranslation();
  const { permissions } = useAuth();
  const canManageMenu = permissions.includes("menu.manage");
  const canUpdateAvailability =
    canManageMenu || permissions.includes("menu.availability");
  const isArabic = i18n.language.startsWith("ar");
  const [categories, setCategories] = useState<AdminMenuCategory[]>([]);
  const [items, setItems] = useState<AdminMenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null);
  const [itemDraft, setItemDraft] = useState<ItemDraft | null>(null);
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [itemFormError, setItemFormError] = useState("");
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const result = await listAdminMenu();
      setCategories(result.categories);
      setItems(result.items);
    } catch (cause) {
      setError(getErrorKey(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return items;
    return items.filter((item) =>
      [
        item.name_en,
        item.name_ar,
        item.description ?? "",
        categories.find((category) => category.id === item.category_id)
          ? isArabic
            ? categories.find((category) => category.id === item.category_id)?.name_ar
            : categories.find((category) => category.id === item.category_id)?.name_en
          : "",
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(term),
    );
  }, [categories, isArabic, items, search]);

  const saveCategoryDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!categoryDraft || saving) return;
    const parsed = categorySchema.safeParse(categoryDraft);
    if (!parsed.success) {
      setError("menuAdmin.errors.categoryInvalid");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveMenuCategory({
        ...parsed.data,
        id: categoryDraft.id,
        sort: categoryDraft.id
          ? categories.find((category) => category.id === categoryDraft.id)?.sort ??
            categories.length
          : Math.max(-1, ...categories.map((category) => category.sort)) + 1,
        active: categoryDraft.active,
      });
      setCategoryDraft(null);
      setNotice(t("menuAdmin.categorySaved"));
      await refresh();
    } catch (cause) {
      setError(getErrorKey(cause));
    } finally {
      setSaving(false);
    }
  };

  const changeCategoryActive = async (category: AdminMenuCategory) => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveMenuCategory({
        id: category.id,
        name_en: category.name_en,
        name_ar: category.name_ar,
        sort: category.sort,
        active: !category.active,
      });
      setNotice(t(!category.active ? "menuAdmin.categoryShown" : "menuAdmin.categoryHidden"));
      await refresh();
    } catch (cause) {
      setError(getErrorKey(cause));
    } finally {
      setSaving(false);
    }
  };

  const moveCategory = async (index: number, offset: -1 | 1) => {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= categories.length || saving) return;
    const reordered = [...categories];
    [reordered[index], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[index],
    ];
    setSaving(true);
    setError("");
    try {
      await setMenuCategoryOrder(reordered);
      await refresh();
    } catch (cause) {
      setError(getErrorKey(cause));
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const saveItemDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!itemDraft || saving) return;
    const parsed = itemSchema.safeParse(itemDraft);
    if (!parsed.success) {
      setItemFormError("menuAdmin.errors.itemInvalid");
      return;
    }
    setSaving(true);
    setItemFormError("");
    setError("");
    let uploadedPath: string | null = null;
    let saved = false;
    try {
      if (itemFile) uploadedPath = await uploadMenuImage(itemFile);
      const nextImagePath = uploadedPath ?? itemDraft.image_path;
      await saveMenuItem({
        ...parsed.data,
        id: itemDraft.id,
        image_path: nextImagePath,
      });
      saved = true;
      const previousImage = items.find((item) => item.id === itemDraft.id)?.image_path;
      let cleanupFailed = false;
      if (previousImage && previousImage !== nextImagePath) {
        try {
          await removeMenuImage(previousImage);
        } catch {
          cleanupFailed = true;
        }
      }
      const priceChanged =
        itemDraft.id !== null &&
        Number(itemDraft.price) !==
          (items.find((item) => item.id === itemDraft.id)?.price ?? Number(itemDraft.price));
      setItemDraft(null);
      setItemFile(null);
      setNotice(
        t(
          cleanupFailed
            ? "menuAdmin.imageCleanupWarning"
            : priceChanged
              ? "menuAdmin.priceHistoryNotice"
              : "menuAdmin.itemSaved",
        ),
      );
      await refresh();
    } catch (cause) {
      if (uploadedPath && !saved) {
        try {
          await removeMenuImage(uploadedPath);
        } catch {
          setItemFormError(t("menuAdmin.errors.imageCleanup"));
          setSaving(false);
          return;
        }
      }
      setItemFormError(t(getErrorKey(cause)));
    } finally {
      setSaving(false);
    }
  };

  const toggleAvailability = async (item: AdminMenuItem) => {
    setBusyItemId(item.id);
    setError("");
    setNotice("");
    try {
      await updateMenuItemAvailability(item.id, !item.available);
      setNotice(t(item.available ? "menuAdmin.itemUnavailable" : "menuAdmin.itemAvailable"));
      await refresh();
    } catch (cause) {
      setError(getErrorKey(cause));
    } finally {
      setBusyItemId(null);
    }
  };

  const openEditItem = (item: AdminMenuItem) => {
    setItemFormError("");
    setItemFile(null);
    setItemDraft({
      id: item.id,
      category_id: item.category_id ?? "",
      name_en: item.name_en,
      name_ar: item.name_ar,
      description: item.description ?? "",
      price: String(item.price),
      qualifies_for_time: item.qualifies_for_time,
      available: item.available,
      active: item.active,
      image_path: item.image_path,
    });
  };

  const renderItem = (item: AdminMenuItem) => (
    <li className="flex flex-wrap items-center gap-3 p-4" key={item.id}>
      {item.image_path ? (
        <img alt="" className="size-14 shrink-0 rounded-xl object-cover" src={getMenuImageUrl(item.image_path)} />
      ) : (
        <div aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800">
          <Utensils size={21} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-semibold text-ink dark:text-white">{isArabic ? item.name_ar : item.name_en}</h4>
          {!item.active && <span className="text-xs text-slate-500">{t("menuAdmin.hidden")}</span>}
        </div>
        {item.description && <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{item.description}</p>}
        <p className="mt-1 font-semibold text-brand">
          {new Intl.NumberFormat(isArabic ? "ar-EG" : "en", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(item.price)}
        </p>
      </div>
      {canUpdateAvailability && (
        <button
          aria-pressed={item.available}
          className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
            item.available
              ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-300"
          }`}
          disabled={busyItemId === item.id}
          onClick={() => void toggleAvailability(item)}
          type="button"
        >
          {busyItemId === item.id ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />
          ) : item.available ? (
            <Check aria-hidden="true" size={16} />
          ) : null}
          {item.available ? t("menuAdmin.available") : t("menuAdmin.unavailable")}
        </button>
      )}
      {canManageMenu && (
        <button aria-label={`${t("menuAdmin.editItem")}: ${isArabic ? item.name_ar : item.name_en}`} className={secondaryButton} onClick={() => openEditItem(item)} type="button">
          <Pencil aria-hidden="true" size={16} />
          {t("menuAdmin.editItem")}
        </button>
      )}
    </li>
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-brand">
            {t("menuAdmin.eyebrow")}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink dark:text-white">
            {t("menuAdmin.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
            {t("menuAdmin.description")}
          </p>
        </div>
        {canManageMenu && <button
          className={primaryButton}
          disabled={!categories.some((category) => category.active)}
          onClick={() => {
            setItemFormError("");
            setItemFile(null);
            setItemDraft(blankItem(categories.find((category) => category.active)?.id));
          }}
          type="button"
        >
          <Plus aria-hidden="true" size={17} />
          {t("menuAdmin.addItem")}
        </button>}
      </header>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert">
          {t(error)}
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300" role="status">
          {notice}
        </p>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink dark:text-white">{t("menuAdmin.categories")}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t("menuAdmin.categoriesHelp")}</p>
          </div>
          {canManageMenu && (
            <button className={secondaryButton} onClick={() => setCategoryDraft(blankCategory())} type="button">
              <Plus aria-hidden="true" size={16} />
              {t("menuAdmin.addCategory")}
            </button>
          )}
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-5 text-sm text-slate-500">
            <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />
            {t("menuAdmin.loading")}
          </div>
        ) : categories.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500 dark:border-slate-700">
            {t("menuAdmin.noCategories")}
          </p>
        ) : (
          <ul className="space-y-2">
            {categories.map((category, index) => (
              <li className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800" key={category.id}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink dark:text-white">
                    {isArabic ? category.name_ar : category.name_en}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {isArabic ? category.name_en : category.name_ar}
                    {!category.active && ` · ${t("menuAdmin.hidden")}`}
                  </p>
                </div>
                {canManageMenu && (
                  <>
                    <button aria-label={t("menuAdmin.moveUp")} className={secondaryButton} disabled={saving || index === 0} onClick={() => void moveCategory(index, -1)} type="button">
                      <ArrowUp aria-hidden="true" size={16} />
                    </button>
                    <button aria-label={t("menuAdmin.moveDown")} className={secondaryButton} disabled={saving || index === categories.length - 1} onClick={() => void moveCategory(index, 1)} type="button">
                      <ArrowDown aria-hidden="true" size={16} />
                    </button>
                    <button aria-label={t("menuAdmin.renameCategory")} className={secondaryButton} onClick={() => setCategoryDraft({
                      id: category.id,
                      name_en: category.name_en,
                      name_ar: category.name_ar,
                      active: category.active,
                    })} type="button">
                      <Pencil aria-hidden="true" size={16} />
                    </button>
                    <button className={secondaryButton} disabled={saving} onClick={() => void changeCategoryActive(category)} type="button">
                      {category.active ? t("menuAdmin.hideCategory") : t("menuAdmin.showCategory")}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink dark:text-white">{t("menuAdmin.items")}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t("menuAdmin.itemsHelp")}</p>
          </div>
          <label className="relative block w-full sm:max-w-xs">
            <span className="sr-only">{t("menuAdmin.search")}</span>
            <Search aria-hidden="true" className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
            <input className={`${inputClass} mt-0 ps-10`} onChange={(event) => setSearch(event.target.value)} placeholder={t("menuAdmin.search")} value={search} />
          </label>
        </div>
        {!loading && filteredItems.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">
            {items.length ? t("menuAdmin.noSearchResults") : t("menuAdmin.noItems")}
          </p>
        )}
        {categories.map((category) => {
          const categoryItems = filteredItems.filter((item) => item.category_id === category.id);
          if (!categoryItems.length) return null;
          return (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900" key={category.id}>
              <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <h3 className="font-semibold text-ink dark:text-white">{isArabic ? category.name_ar : category.name_en}</h3>
                {!category.active && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t("menuAdmin.hidden")}</span>}
              </header>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {categoryItems.map(renderItem)}
              </ul>
            </section>
          );
        })}
        {filteredItems.some((item) => item.category_id === null) && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <header className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h3 className="font-semibold text-ink dark:text-white">{t("menuAdmin.uncategorized")}</h3>
            </header>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredItems.filter((item) => item.category_id === null).map(renderItem)}
            </ul>
          </section>
        )}
      </section>

      {canManageMenu && categoryDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setCategoryDraft(null);
        }}>
          <section aria-labelledby="menu-category-title" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900 sm:p-6" role="dialog">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-ink dark:text-white" id="menu-category-title">
                {t(categoryDraft.id ? "menuAdmin.editCategory" : "menuAdmin.addCategory")}
              </h2>
              <button aria-label={t("menuAdmin.close")} className={secondaryButton} onClick={() => setCategoryDraft(null)} type="button"><X size={17} /></button>
            </div>
            <form className="space-y-4" onSubmit={(event) => void saveCategoryDraft(event)}>
              <label className="block text-sm font-medium">{t("menuAdmin.nameEnglish")}<input autoFocus className={inputClass} maxLength={80} onChange={(event) => setCategoryDraft({ ...categoryDraft, name_en: event.target.value })} required value={categoryDraft.name_en} /></label>
              <label className="block text-sm font-medium">{t("menuAdmin.nameArabic")}<input className={inputClass} dir="rtl" maxLength={80} onChange={(event) => setCategoryDraft({ ...categoryDraft, name_ar: event.target.value })} required value={categoryDraft.name_ar} /></label>
              {error && <p className="text-sm text-red-600" role="alert">{t(error)}</p>}
              <div className="flex justify-end gap-2">
                <button className={secondaryButton} disabled={saving} onClick={() => setCategoryDraft(null)} type="button">{t("menuAdmin.cancel")}</button>
                <button className={primaryButton} disabled={saving} type="submit">{saving && <LoaderCircle className="animate-spin" size={16} />}{t("menuAdmin.save")}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {canManageMenu && itemDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) {
            setItemDraft(null);
            setItemFile(null);
          }
        }}>
          <section aria-labelledby="menu-item-title" aria-modal="true" className="my-auto w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900 sm:p-6" role="dialog">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-ink dark:text-white" id="menu-item-title">
                {t(itemDraft.id ? "menuAdmin.editItem" : "menuAdmin.addItem")}
              </h2>
              <button aria-label={t("menuAdmin.close")} className={secondaryButton} onClick={() => { setItemDraft(null); setItemFile(null); }} type="button"><X size={17} /></button>
            </div>
            <form className="space-y-4" onSubmit={(event) => void saveItemDraft(event)}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium">{t("menuAdmin.nameEnglish")}<input autoFocus className={inputClass} maxLength={100} onChange={(event) => setItemDraft({ ...itemDraft, name_en: event.target.value })} required value={itemDraft.name_en} /></label>
                <label className="block text-sm font-medium">{t("menuAdmin.nameArabic")}<input className={inputClass} dir="rtl" maxLength={100} onChange={(event) => setItemDraft({ ...itemDraft, name_ar: event.target.value })} required value={itemDraft.name_ar} /></label>
                <label className="block text-sm font-medium sm:col-span-2">{t("menuAdmin.descriptionField")}<textarea className={inputClass} maxLength={500} onChange={(event) => setItemDraft({ ...itemDraft, description: event.target.value })} rows={2} value={itemDraft.description} /></label>
                <label className="block text-sm font-medium">{t("menuAdmin.price")}<input className={inputClass} min="0" onChange={(event) => setItemDraft({ ...itemDraft, price: event.target.value })} required step="0.01" type="number" value={itemDraft.price} /></label>
                <label className="block text-sm font-medium">{t("menuAdmin.category")}<select className={inputClass} onChange={(event) => setItemDraft({ ...itemDraft, category_id: event.target.value })} required value={itemDraft.category_id}><option value="">{t("menuAdmin.chooseCategory")}</option>{categories.map((category) => <option key={category.id} value={category.id}>{isArabic ? category.name_ar : category.name_en}{!category.active ? ` (${t("menuAdmin.hidden")})` : ""}</option>)}</select></label>
                <label className="block text-sm font-medium sm:col-span-2">{t("menuAdmin.image")}<span className="mt-1.5 flex min-h-24 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"><ImagePlus aria-hidden="true" size={20} />{itemFile?.name ?? t("menuAdmin.imageHelp")}<input accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setItemFile(event.target.files?.[0] ?? null)} type="file" /></span></label>
                {itemDraft.image_path && !itemFile && <div className="flex items-center gap-3 sm:col-span-2"><img alt="" className="size-16 rounded-xl object-cover" src={getMenuImageUrl(itemDraft.image_path)} /><button className={secondaryButton} onClick={() => setItemDraft({ ...itemDraft, image_path: null })} type="button">{t("menuAdmin.removeImage")}</button></div>}
              </div>
              <div className="grid gap-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-950">
                <label className="flex items-start gap-3 text-sm"><input checked={itemDraft.available} className="mt-0.5 accent-emerald-700" onChange={(event) => setItemDraft({ ...itemDraft, available: event.target.checked })} type="checkbox" /><span><span className="font-semibold">{t("menuAdmin.availableToday")}</span><span className="mt-0.5 block text-xs text-slate-500">{t("menuAdmin.availableHelp")}</span></span></label>
                <label className="flex items-start gap-3 text-sm"><input checked={itemDraft.active} className="mt-0.5 accent-emerald-700" onChange={(event) => setItemDraft({ ...itemDraft, active: event.target.checked })} type="checkbox" /><span><span className="font-semibold">{t("menuAdmin.showOnMenu")}</span><span className="mt-0.5 block text-xs text-slate-500">{t("menuAdmin.showHelp")}</span></span></label>
                <label className="flex items-start gap-3 text-sm"><input checked={itemDraft.qualifies_for_time} className="mt-0.5 accent-emerald-700" onChange={(event) => setItemDraft({ ...itemDraft, qualifies_for_time: event.target.checked })} type="checkbox" /><span><span className="font-semibold">{t("menuAdmin.countsForMinimum")}</span><span className="mt-0.5 block text-xs text-slate-500">{t("menuAdmin.countsHelp")}</span></span></label>
              </div>
              {itemDraft.id && Number(itemDraft.price) !== (items.find((item) => item.id === itemDraft.id)?.price ?? Number(itemDraft.price)) && (
                <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-950/30 dark:text-blue-200">{t("menuAdmin.priceHistoryNotice")}</p>
              )}
              {itemFormError && <p className="text-sm text-red-600 dark:text-red-300" role="alert">{itemFormError}</p>}
              <div className="flex justify-end gap-2">
                <button className={secondaryButton} disabled={saving} onClick={() => { setItemDraft(null); setItemFile(null); }} type="button">{t("menuAdmin.cancel")}</button>
                <button className={primaryButton} disabled={saving} type="submit">{saving && <LoaderCircle className="animate-spin" size={16} />}{t("menuAdmin.save")}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
