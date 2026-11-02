import type { Database } from "../lib/database.types";
import { getSupabaseClient } from "../lib/supabase";

type CategoryRow =
  Database["public"]["Tables"]["pos_menu_categories"]["Row"];
type ProductRow = Database["public"]["Tables"]["pos_products"]["Row"];

export type AdminMenuCategory = CategoryRow;
export type AdminMenuItem = ProductRow;

export async function listAdminMenu(): Promise<{
  categories: AdminMenuCategory[];
  items: AdminMenuItem[];
}> {
  const client = getSupabaseClient();
  const [categoriesResult, itemsResult] = await Promise.all([
    client
      .from("pos_menu_categories")
      .select("id,name_en,name_ar,sort,active,created_at,updated_at")
      .order("sort")
      .order("name_en"),
    client
      .from("pos_products")
      .select(
        "id,category_id,name_en,name_ar,description,price,qualifies_for_time,active,available,image_path,sort,created_at,updated_at",
      )
      .order("sort")
      .order("name_en"),
  ]);
  if (categoriesResult.error) throw categoriesResult.error;
  if (itemsResult.error) throw itemsResult.error;
  return {
    categories: categoriesResult.data,
    items: itemsResult.data,
  };
}

export async function saveMenuCategory(input: {
  id: string | null;
  name_en: string;
  name_ar: string;
  sort: number;
  active: boolean;
}): Promise<void> {
  const result = input.id
    ? await getSupabaseClient()
        .from("pos_menu_categories")
        .update({
          name_en: input.name_en,
          name_ar: input.name_ar,
          sort: input.sort,
          active: input.active,
        })
        .eq("id", input.id)
    : await getSupabaseClient()
        .from("pos_menu_categories")
        .insert({
          name_en: input.name_en,
          name_ar: input.name_ar,
          sort: input.sort,
          active: input.active,
        });
  if (result.error) throw result.error;
}

export async function setMenuCategoryOrder(
  categories: readonly AdminMenuCategory[],
): Promise<void> {
  const client = getSupabaseClient();
  for (const [sort, category] of categories.entries()) {
    const { error } = await client
      .from("pos_menu_categories")
      .update({ sort })
      .eq("id", category.id);
    if (error) throw error;
  }
}

export async function saveMenuItem(input: {
  id: string | null;
  category_id: string;
  name_en: string;
  name_ar: string;
  description: string;
  price: number;
  qualifies_for_time: boolean;
  available: boolean;
  active: boolean;
  image_path: string | null;
}): Promise<void> {
  const values = {
    category_id: input.category_id,
    name_en: input.name_en,
    name_ar: input.name_ar,
    description: input.description.trim() || null,
    price: input.price,
    qualifies_for_time: input.qualifies_for_time,
    available: input.available,
    active: input.active,
    image_path: input.image_path,
  };
  const result = input.id
    ? await getSupabaseClient()
        .from("pos_products")
        .update(values)
        .eq("id", input.id)
    : await getSupabaseClient().from("pos_products").insert(values);
  if (result.error) throw result.error;
}

export async function updateMenuItemAvailability(
  itemId: string,
  available: boolean,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("pos_products")
    .update({ available })
    .eq("id", itemId);
  if (error) throw error;
}

export async function prepareMenuImage(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("menuAdmin.errors.imageType");
  }
  if (file.size > 1024 * 1024) {
    throw new Error("menuAdmin.errors.imageSize");
  }

  const image = await createImageBitmap(file);
  try {
    if (image.width <= 800 && image.height <= 800) return file;
    const scale = Math.min(800 / image.width, 800 / image.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("menuAdmin.errors.imageResize");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const resized = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("menuAdmin.errors.imageResize"));
        },
        file.type,
        file.type === "image/png" ? undefined : 0.86,
      );
    });
    if (resized.size > 1024 * 1024) {
      throw new Error("menuAdmin.errors.imageSize");
    }
    return new File([resized], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
  } finally {
    image.close();
  }
}

export async function uploadMenuImage(file: File): Promise<string> {
  const image = await prepareMenuImage(file);
  const extension =
    image.type === "image/jpeg"
      ? "jpg"
      : image.type === "image/png"
        ? "png"
        : "webp";
  const path = `items/${crypto.randomUUID()}.${extension}`;
  const { data, error } = await getSupabaseClient()
    .storage.from("menu")
    .upload(path, image, { contentType: image.type, upsert: false });
  if (error) throw error;
  return data.path;
}

export async function removeMenuImage(path: string): Promise<void> {
  if (!/^items\/[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(path)) {
    throw new Error("Invalid menu image path.");
  }
  const { error } = await getSupabaseClient().storage.from("menu").remove([path]);
  if (error) throw error;
}

export function getMenuImageUrl(path: string): string {
  return getSupabaseClient().storage.from("menu").getPublicUrl(path).data.publicUrl;
}
