import "server-only";
import { db, getTenantId } from "./client";
import type { Category } from "../types";

interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  handle: string;
  description: string | null;
  hero_image_url: string | null;
}

function rowToCategory(row: CategoryRow, handleById: Map<string, string>): Category {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    description: row.description ?? undefined,
    heroImageUrl: row.hero_image_url ?? undefined,
    parentHandle: row.parent_id ? handleById.get(row.parent_id) : undefined,
  };
}

export async function getCategories(): Promise<Category[]> {
  const tenantId = await getTenantId();
  const { data, error } = await db()
    .from("categories")
    .select("id, parent_id, name, handle, description, hero_image_url")
    .eq("tenant_id", tenantId)
    .eq("is_hidden", false)
    .order("position");
  if (error) throw new Error(`Could not load categories: ${error.message}`);

  const rows = (data ?? []) as CategoryRow[];
  const handleById = new Map(rows.map((r) => [r.id, r.handle]));
  return rows.map((r) => rowToCategory(r, handleById));
}

export async function getCategoryTree() {
  const categories = await getCategories();
  const top = categories.filter((c) => !c.parentHandle);
  return top.map((c) => ({ ...c, children: categories.filter((s) => s.parentHandle === c.handle) }));
}

export async function getCategoryByHandle(handle: string): Promise<Category | undefined> {
  const categories = await getCategories();
  return categories.find((c) => c.handle === handle);
}
