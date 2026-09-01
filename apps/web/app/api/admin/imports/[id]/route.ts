import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@trend/db";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from("import_jobs")
    .select("id, status, progress, result, created_at, updated_at")
    .eq("id", params.id)
    .single();

  if (error || !data) return NextResponse.json({ error: "Import job not found" }, { status: 404 });
  return NextResponse.json(data);
}
