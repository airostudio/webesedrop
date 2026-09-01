"use server";

import { revalidatePath } from "next/cache";
import { db, getTenantId } from "@/lib/data/client";

export async function publishProduct(productId: string): Promise<void> {
  const tenantId = await getTenantId();
  const { error } = await db().from("products").update({ status: "PUBLISHED" }).eq("id", productId).eq("tenant_id", tenantId);
  if (error) throw new Error(`Could not publish product: ${error.message}`);
  revalidatePath("/admin/products");
  revalidatePath("/admin");
  revalidatePath("/shop");
  revalidatePath("/");
}

/** Publishes every DRAFT product for the tenant in one go — e.g. right after a WooCommerce import, which lands everything as DRAFT for review. */
export async function publishAllDrafts(): Promise<void> {
  const tenantId = await getTenantId();
  const { error } = await db().from("products").update({ status: "PUBLISHED" }).eq("tenant_id", tenantId).eq("status", "DRAFT");
  if (error) throw new Error(`Could not publish draft products: ${error.message}`);
  revalidatePath("/admin/products");
  revalidatePath("/admin");
  revalidatePath("/shop");
  revalidatePath("/");
}
