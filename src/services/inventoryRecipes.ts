import type { Json } from "../lib/database.types";
import { getSupabaseClient } from "../lib/supabase";

export type RecipeUnit = "ml" | "L" | "g" | "kg" | "piece";

export type InventoryRecipeIngredient = {
  item_id: string;
  quantity: number;
  unit: RecipeUnit;
};

export type InventoryRecipeProduct = {
  id: string;
  name_en: string;
  name_ar: string;
  active: boolean;
  recipe_id: string | null;
  instructions: string;
  ingredients: InventoryRecipeIngredient[];
};

export type RecipeInventoryItem = {
  id: string;
  name: string;
  unit: string;
  active: boolean;
};

export type InventoryRecipeCatalog = {
  products: InventoryRecipeProduct[];
  items: RecipeInventoryItem[];
  requireRecipe: boolean;
};

function throwIfSchemaUnavailable(error: { code?: string; message: string }): never {
  const message = error.message.toLowerCase();
  if (
    ["42p01", "42703", "pgrst202", "pgrst204", "pgrst205"].includes(error.code ?? "") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  ) {
    throw new Error("inventory recipe migration required");
  }
  throw error;
}

export async function getInventoryRecipeCatalog(): Promise<InventoryRecipeCatalog> {
  const client = getSupabaseClient();
  const [productsResult, itemsResult, recipesResult, ingredientsResult, requirementResult] =
    await Promise.all([
      client.from("pos_products").select("id,name_en,name_ar,active").order("name_en"),
      client.from("inventory_items").select("id,name,unit,active").order("name"),
      client.from("menu_item_recipes").select("id,product_id,instructions"),
      client
        .from("menu_item_recipe_ingredients")
        .select("recipe_id,item_id,quantity,unit"),
      client.rpc("get_inventory_recipe_requirement"),
    ]);

  if (productsResult.error) throwIfSchemaUnavailable(productsResult.error);
  if (itemsResult.error) throwIfSchemaUnavailable(itemsResult.error);
  if (recipesResult.error) throwIfSchemaUnavailable(recipesResult.error);
  if (ingredientsResult.error) throwIfSchemaUnavailable(ingredientsResult.error);
  if (requirementResult.error) throwIfSchemaUnavailable(requirementResult.error);

  const products = productsResult.data;
  const items = itemsResult.data;
  const recipes = recipesResult.data;
  const ingredients = ingredientsResult.data;
  const requireRecipe = requirementResult.data;
  if (!products || !items || !recipes || !ingredients || requireRecipe === null) {
    throw new Error("Recipe catalog response was invalid.");
  }

  const ingredientsByRecipe = new Map<string, InventoryRecipeIngredient[]>();
  for (const ingredient of ingredients) {
    const list = ingredientsByRecipe.get(ingredient.recipe_id) ?? [];
    list.push({
      item_id: ingredient.item_id,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
    });
    ingredientsByRecipe.set(ingredient.recipe_id, list);
  }

  const recipeByProduct = new Map(
    recipes.map((recipe) => [recipe.product_id, recipe]),
  );
  return {
    products: products.map((product) => {
      const recipe = recipeByProduct.get(product.id);
      return {
        ...product,
        recipe_id: recipe?.id ?? null,
        instructions: recipe?.instructions ?? "",
        ingredients: recipe ? ingredientsByRecipe.get(recipe.id) ?? [] : [],
      };
    }),
    items,
    requireRecipe,
  };
}

export async function saveInventoryRecipe(input: {
  productId: string;
  instructions: string;
  ingredients: InventoryRecipeIngredient[];
}): Promise<void> {
  const ingredients: Json[] = input.ingredients.map((ingredient) => ({
    item_id: ingredient.item_id,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
  }));
  const { error } = await getSupabaseClient().rpc("save_menu_item_recipe", {
    p_product: input.productId,
    p_instructions: input.instructions.trim() || null,
    p_ingredients: ingredients,
  });
  if (error) throw error;
}

export async function deleteInventoryRecipe(productId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("delete_menu_item_recipe", {
    p_product: productId,
  });
  if (error) throw error;
}

export async function setInventoryRecipeRequirement(required: boolean): Promise<void> {
  const { error } = await getSupabaseClient().rpc(
    "set_inventory_recipe_requirement",
    { p_required: required },
  );
  if (error) throw error;
}
