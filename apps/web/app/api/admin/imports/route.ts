import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";

export const runtime = "nodejs";

const DEFAULT_CHUNK_BYTES = 262_144; // 256KB per range request — small enough that every
// invocation finishes in well under a second of DB + parse work, regardless of total file size.

const bodySchema = z.object({
  tenant: z.string().optional(),
  path: z.string().min(1), // storage path returned by /api/admin/imports/upload-url
  chunkBytes: z.number().int().positive().max(2_000_000).optional(),
  markMissingOutOfStock: z.boolean().optional(),
});

/** Registers an uploaded CSV as an import job. Processing happens later, one bounded chunk per call to [id]/process. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createServiceRoleSupabaseClient();
  const tenantId = await resolveTenantId(supabase, parsed.data.tenant);

  const { data, error } = await supabase
    .from("import_jobs")
    .insert({
      tenant_id: tenantId,
      type: "product_csv",
      status: "QUEUED",
      file_url: parsed.data.path,
      mapping: {
        columns: [
          "handle", "title", "product_type", "short_description", "description",
          "price", "compare_at", "sku", "stock_on_hand", "category_handles",
          "brand", "material", "height_cm", "status", "image_urls",
        ],
      },
      options: {
        byteOffset: 0,
        carryover: "",
        header: null,
        chunkBytes: parsed.data.chunkBytes ?? DEFAULT_CHUNK_BYTES,
        markMissingOutOfStock: parsed.data.markMissingOutOfStock ?? false,
      },
      result: { processedRows: 0, skippedExisting: 0, errors: [], seenHandles: [], seenBrands: [] },
      progress: 0,
    })
    .select("id")
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not create import job" }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
