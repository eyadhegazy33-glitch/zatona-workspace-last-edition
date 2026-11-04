import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle, Plus, Search, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  deleteInventoryRecipe,
  getInventoryRecipeCatalog,
  saveInventoryRecipe,
  setInventoryRecipeRequirement,
  type InventoryRecipeCatalog,
  type RecipeUnit,
} from "../services/inventoryRecipes";

type IngredientDraft = {
  itemId: string;
  quantity: string;
  unit: RecipeUnit;
};

const units: RecipeUnit[] = ["ml", "L", "g", "kg", "piece"];

const recipeSchema = z.object({
  instructions: z.string().trim().max(2000),
  ingredients: z.array(z.object({
    itemId: z.string().uuid(),
    quantity: z.string().trim().min(1),
    unit: z.enum(["ml", "L", "g", "kg", "piece"]),
  })).min(1).max(50),
}).superRefine((value, context) => {
  const seen = new Set<string>();
  value.ingredients.forEach((ingredient, index) => {
    const quantity = Number(ingredient.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 ||
      Math.abs(quantity * 10000 - Math.round(quantity * 10000)) > 1e-7) {
      context.addIssue({
        code: "custom",
        path: ["ingredients", index, "quantity"],
        message: "invalid quantity",
      });
    }
    if (seen.has(ingredient.itemId)) {
      context.addIssue({
        code: "custom",
        path: ["ingredients", index, "itemId"],
        message: "duplicate item",
      });
    }
    seen.add(ingredient.itemId);
  });
});

function dimension(unit: string): string | null {
  const normalized = unit.trim().toLowerCase();
  if (normalized === "ml" || ["l", "liter", "liters"].includes(normalized)) return "volume";
  if (["g", "kg"].includes(normalized)) return "mass";
  if ([
    "piece", "pieces", "pc", "pcs", "cup", "cups", "lid", "lids",
    "unit", "units", "bottle", "bottles",
  ].includes(normalized)) return "piece";
  return null;
}

function recipeUnitForInventory(unit: string): RecipeUnit {
  const normalized = unit.trim().toLowerCase();
  if (normalized === "ml") return "ml";
  if (["l", "liter", "liters"].includes(normalized)) return "L";
  if (normalized === "g") return "g";
  if (normalized === "kg") return "kg";
  return "piece";
}

function defaultRecipeQuantity(unit: string): string {
  const normalized = unit.trim().toLowerCase();
  return ["l", "liter", "liters", "kg"].includes(normalized) ? "0.1" : "1";
}

function getErrorKey(cause: unknown): string {
  const message = cause && typeof cause === "object" && "message" in cause
    ? String(cause.message).toLowerCase()
    : "";
  if (message.includes("recipe migration required")) {
    return "inventory.recipeErrors.migrationRequired";
  }
  if (message.includes("missing recipes")) return "inventory.recipeErrors.missingRecipes";
  if (message.includes("recipe is required")) return "inventory.recipeErrors.recipeRequired";
  if (message.includes("unit does not match")) return "inventory.recipeErrors.unitMismatch";
  if (message.includes("not allowed")) return "inventory.errors.permission";
  if (message.includes("not found") || message.includes("unavailable")) {
    return "inventory.recipeErrors.itemUnavailable";
  }
  return "inventory.recipeErrors.save";
}

export function InventoryRecipesTab() {
  const { i18n, t } = useTranslation();
  const [catalog, setCatalog] = useState<InventoryRecipeCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [ingredients, setIngredients] = useState<IngredientDraft[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getInventoryRecipeCatalog();
      setCatalog(result);
      return true;
    } catch (cause) {
      setError(getErrorKey(cause));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedProductId && catalog?.products.length) {
      setSelectedProductId(catalog.products[0].id);
    }
  }, [catalog, selectedProductId]);

  const selectedProduct = catalog?.products.find((item) => item.id === selectedProductId);
  useEffect(() => {
    if (!selectedProduct) return;
    setInstructions(selectedProduct.instructions);
    setIngredients(selectedProduct.ingredients.map((ingredient) => ({
      itemId: ingredient.item_id,
      quantity: String(ingredient.quantity),
      unit: ingredient.unit,
    })));
    setError("");
  }, [selectedProduct]);

  const filteredProducts = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase(i18n.language);
    return (catalog?.products ?? []).filter((product) =>
      !needle ||
      product.name_en.toLocaleLowerCase(i18n.language).includes(needle) ||
      product.name_ar.toLocaleLowerCase(i18n.language).includes(needle) ||
      product.id.toLowerCase().includes(needle),
    );
  }, [catalog, i18n.language, search]);

  const formatProductName = (nameEn: string, nameAr: string) =>
    i18n.language.startsWith("ar") ? nameAr : nameEn;
  const activeItems = catalog?.items.filter((item) => item.active) ?? [];
  const inputClass =
    "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink dark:border-slate-700 dark:bg-slate-950 dark:text-white";

  const changeIngredient = (index: number, patch: Partial<IngredientDraft>) => {
    setIngredients((current) => current.map((ingredient, currentIndex) =>
      currentIndex === index ? { ...ingredient, ...patch } : ingredient,
    ));
  };

  const addIngredient = () => {
    const item = activeItems[0];
    if (!item) return;
    setIngredients((current) => [
      ...current,
      {
        itemId: item.id,
        quantity: defaultRecipeQuantity(item.unit),
        unit: recipeUnitForInventory(item.unit),
      },
    ]);
  };

  const save = async () => {
    if (!selectedProduct || busy) return;
    const parsed = recipeSchema.safeParse({ instructions, ingredients });
    if (!parsed.success) {
      setError("inventory.recipeErrors.invalid");
      return;
    }
    const inventoryById = new Map((catalog?.items ?? []).map((item) => [item.id, item]));
    const incompatible = parsed.data.ingredients.some((ingredient) => {
      const item = inventoryById.get(ingredient.itemId);
      return !item?.active || dimension(item.unit) !== dimension(ingredient.unit);
    });
    if (incompatible) {
      setError("inventory.recipeErrors.unitMismatch");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      await saveInventoryRecipe({
        productId: selectedProduct.id,
        instructions: parsed.data.instructions,
        ingredients: parsed.data.ingredients.map((ingredient) => ({
          item_id: ingredient.itemId,
          quantity: Number(ingredient.quantity),
          unit: ingredient.unit,
        })),
      });
      if (await load()) setNotice("inventory.recipeSaved");
    } catch (cause) {
      setError(getErrorKey(cause));
    } finally {
      setBusy(false);
    }
  };

  const removeRecipe = async () => {
    if (!selectedProduct?.recipe_id || busy) return;
    if (!window.confirm(t("inventory.recipeConfirmDelete", {
      name: formatProductName(selectedProduct.name_en, selectedProduct.name_ar),
    }))) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await deleteInventoryRecipe(selectedProduct.id);
      if (await load()) setNotice("inventory.recipeDeleted");
    } catch (cause) {
      setError(getErrorKey(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggleRequirement = async (required: boolean) => {
    if (!catalog || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await setInventoryRecipeRequirement(required);
      setCatalog({ ...catalog, requireRecipe: required });
      setNotice(required
        ? "inventory.recipeRequirementEnabled"
        : "inventory.recipeRequirementDisabled");
    } catch (cause) {
      setError(getErrorKey(cause));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="grid min-h-64 place-items-center" role="status">
      <LoaderCircle aria-label={t("inventory.loading")} className="animate-spin text-brand" size={30} />
    </div>;
  }

  if (!catalog) {
    return <div className="space-y-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">
      <p>{t(error || "inventory.recipeErrors.load")}</p>
      <button className="font-semibold underline" onClick={() => void load()} type="button">
        {t("inventory.retry")}
      </button>
    </div>;
  }

  const configuredCount = catalog.products.filter((product) => product.recipe_id).length;
  const missingCount = catalog.products.filter((product) => product.active && !product.recipe_id).length;

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-ink dark:text-white">{t("inventory.recipeRequirementTitle")}</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {t("inventory.recipeCoverage", { configured: configuredCount, missing: missingCount })}
            </p>
          </div>
          <label className="inline-flex min-h-11 items-center gap-3 rounded-xl border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700">
            <input
              checked={catalog.requireRecipe}
              className="size-4 accent-brand"
              disabled={busy}
              onChange={(event) => void toggleRequirement(event.target.checked)}
              type="checkbox"
            />
            {t("inventory.requireRecipe")}
          </label>
        </div>
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t("inventory.recipeRequirementHelp")}</p>
      </div>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">{t(error)}</p>}
      {notice && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" role="status">{t(notice)}</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.5fr)]">
        <aside className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <label className="relative block">
            <span className="sr-only">{t("inventory.recipeSearch")}</span>
            <Search aria-hidden="true" className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              className={`${inputClass} ps-10`}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("inventory.recipeSearch")}
              value={search}
            />
          </label>
          <ul className="max-h-[32rem] space-y-2 overflow-y-auto">
            {filteredProducts.map((product) => (
              <li key={product.id}>
                <button
                  aria-current={selectedProductId === product.id ? "true" : undefined}
                  className={`w-full rounded-xl border p-3 text-start ${
                    selectedProductId === product.id
                      ? "border-brand bg-brand/5"
                      : "border-slate-200 dark:border-slate-800"
                  }`}
                  onClick={() => setSelectedProductId(product.id)}
                  type="button"
                >
                  <span className="block font-semibold text-ink dark:text-white">
                    {formatProductName(product.name_en, product.name_ar)}
                  </span>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    product.recipe_id
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                      : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                  }`}>
                    {t(product.recipe_id ? "inventory.recipeConfigured" : "inventory.recipeMissing")}
                  </span>
                  {!product.active && <span className="ms-2 text-xs text-slate-500">{t("inventory.inactive")}</span>}
                </button>
              </li>
            ))}
            {filteredProducts.length === 0 && (
              <li className="p-4 text-center text-sm text-slate-500">{t("inventory.recipeNoProducts")}</li>
            )}
          </ul>
        </aside>

        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5">
          {selectedProduct ? (
            <>
              <div>
                <p className="text-sm font-semibold text-brand">{t("inventory.recipeEditor")}</p>
                <h3 className="mt-1 text-xl font-bold text-ink dark:text-white">
                  {formatProductName(selectedProduct.name_en, selectedProduct.name_ar)}
                </h3>
              </div>

              {ingredients.map((ingredient, index) => {
                const inventoryItem = catalog.items.find((item) => item.id === ingredient.itemId);
                return (
                  <div className="grid gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800 sm:grid-cols-[minmax(0,1.3fr)_minmax(6rem,0.7fr)_minmax(7rem,0.6fr)_auto]" key={index}>
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t("inventory.recipeIngredient")}</span>
                      <select
                        className={inputClass}
                        onChange={(event) => {
                          const item = catalog.items.find((candidate) => candidate.id === event.target.value);
                          if (!item) return;
                          changeIngredient(index, {
                            itemId: item.id,
                            unit: recipeUnitForInventory(item.unit),
                          });
                        }}
                        value={ingredient.itemId}
                      >
                        {catalog.items.map((item) => (
                          <option disabled={!item.active} key={item.id} value={item.id}>
                            {item.name}{!item.active ? ` · ${t("inventory.inactive")}` : ""}
                          </option>
                        ))}
                      </select>
                      {inventoryItem && dimension(inventoryItem.unit) === null && (
                        <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">{t("inventory.recipeUnsupportedInventoryUnit", { unit: inventoryItem.unit })}</span>
                      )}
                    </label>
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t("inventory.recipeQuantity")}</span>
                      <input
                        className={inputClass}
                        min="0.0001"
                        onChange={(event) => changeIngredient(index, { quantity: event.target.value })}
                        step="0.0001"
                        type="number"
                        value={ingredient.quantity}
                      />
                    </label>
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t("inventory.recipeUnit")}</span>
                      <select
                        className={inputClass}
                        onChange={(event) => changeIngredient(index, { unit: event.target.value as RecipeUnit })}
                        value={ingredient.unit}
                      >
                        {units.map((unit) => <option key={unit} value={unit}>{t(`inventory.units.${unit}`)}</option>)}
                      </select>
                    </label>
                    <button
                      aria-label={t("inventory.removeRecipeIngredient")}
                      className="mt-6 grid size-10 place-items-center rounded-lg border border-red-200 text-red-700 dark:border-red-900 dark:text-red-300"
                      onClick={() => setIngredients((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={17} />
                    </button>
                  </div>
                );
              })}

              <button
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700 disabled:opacity-50"
                disabled={!activeItems.length || ingredients.length >= 50}
                onClick={addIngredient}
                type="button"
              >
                <Plus aria-hidden="true" size={16} />{t("inventory.addRecipeIngredient")}
              </button>
              <label className="block text-sm font-medium">
                <span className="mb-1 block">{t("inventory.recipeInstructions")}</span>
                <textarea
                  className={`${inputClass} min-h-24 py-3`}
                  maxLength={2000}
                  onChange={(event) => setInstructions(event.target.value)}
                  value={instructions}
                />
              </label>
              <p className="text-xs text-slate-500">{t("inventory.recipeUnitHelp")}</p>
              <div className="flex flex-wrap justify-end gap-3">
                {selectedProduct.recipe_id && (
                  <button
                    className="min-h-11 rounded-xl border border-red-300 px-4 font-semibold text-red-700 dark:border-red-900 dark:text-red-300"
                    disabled={busy}
                    onClick={() => void removeRecipe()}
                    type="button"
                  >
                    {t("inventory.deleteRecipe")}
                  </button>
                )}
                <button
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white disabled:opacity-50"
                  disabled={busy || activeItems.length === 0}
                  onClick={() => void save()}
                  type="button"
                >
                  {busy && <LoaderCircle aria-hidden="true" className="animate-spin" size={17} />}
                  {t("inventory.saveRecipe")}
                </button>
              </div>
            </>
          ) : (
            <p className="py-12 text-center text-sm text-slate-500">{t("inventory.recipeSelectProduct")}</p>
          )}
        </div>
      </div>
    </section>
  );
}
