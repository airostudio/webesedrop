"use client";

import { useRef, useState } from "react";
import Link from "next/link";

type Mode = "csv" | "woocommerce";
type Phase = "idle" | "uploading" | "processing" | "done" | "error";

interface ImportRowError {
  rowNumber: number;
  handle?: string;
  message: string;
}

interface ConversionSummary {
  totalRows: number;
  excludedTitles: string[];
  typeCounts: Record<string, number>;
}

const MODE_CONFIG: Record<Mode, { label: string; accept: string; createEndpoint: string; contentType: string }> = {
  csv: {
    label: "CSV",
    accept: ".csv,text/csv",
    createEndpoint: "/api/admin/imports",
    contentType: "text/csv",
  },
  woocommerce: {
    label: "WooCommerce Export (.xlsx)",
    accept: ".xlsx",
    createEndpoint: "/api/admin/imports/woocommerce",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
};

export default function ProductImportPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("csv");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [processedRows, setProcessedRows] = useState(0);
  const [skippedExisting, setSkippedExisting] = useState(0);
  const [markedOutOfStock, setMarkedOutOfStock] = useState<number | undefined>(undefined);
  const [markMissingOutOfStock, setMarkMissingOutOfStock] = useState(false);
  const [errors, setErrors] = useState<ImportRowError[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<ConversionSummary | null>(null);

  async function runImport(file: File) {
    const config = MODE_CONFIG[mode];
    setPhase("uploading");
    setProgress(0);
    setProcessedRows(0);
    setSkippedExisting(0);
    setMarkedOutOfStock(undefined);
    setErrors([]);
    setMessage(null);
    setSummary(null);

    try {
      // 1) Get a signed upload URL and PUT the file straight to storage —
      // this request never carries the file's bytes, only JSON.
      const uploadUrlRes = await fetch("/api/admin/imports/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name }),
      });
      if (!uploadUrlRes.ok) throw new Error("Could not get an upload URL");
      const { path, signedUrl } = await uploadUrlRes.json();

      // 2) Upload directly to storage. This is the step that would otherwise
      // hit a serverless function's request-body ceiling for a large file —
      // going straight to storage sidesteps it entirely.
      const putRes = await fetch(signedUrl, { method: "PUT", headers: { "Content-Type": config.contentType }, body: file });
      if (!putRes.ok) throw new Error("Upload to storage failed");

      // 3) Register the import job. For WooCommerce this also converts the
      // workbook to the standard CSV format server-side first.
      const createRes = await fetch(config.createEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, markMissingOutOfStock }),
      });
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => null);
        throw new Error(body?.error ?? "Could not create the import job");
      }
      const created = await createRes.json();
      if (mode === "woocommerce") {
        setSummary({ totalRows: created.totalRows, excludedTitles: created.excludedTitles ?? [], typeCounts: created.typeCounts ?? {} });
      }

      // 4) Drive it to completion — one small byte-range chunk per call, so
      // no single request ever has to parse or upsert the whole file.
      setPhase("processing");
      let done = false;
      while (!done) {
        const processRes = await fetch(`/api/admin/imports/${created.id}/process`, { method: "POST" });
        if (!processRes.ok) throw new Error("A chunk failed to process");
        const chunk = await processRes.json();
        done = chunk.done;
        setProgress(chunk.progress ?? 0);
        setProcessedRows(chunk.result?.processedRows ?? 0);
        setSkippedExisting(chunk.result?.skippedExisting ?? 0);
        setMarkedOutOfStock(chunk.result?.markedOutOfStock);
        setErrors(chunk.result?.errors ?? []);
      }

      setPhase("done");
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Import failed");
    }
  }

  const busy = phase === "uploading" || phase === "processing";

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/admin/products" className="text-xs text-stone-500 underline">
          ← Back to Products
        </Link>
      </div>
      <h1 className="font-serif text-3xl mb-3">Import Products</h1>
      <p className="text-sm text-stone-500 mb-8">
        Handles files of any size — the upload goes straight to storage, then gets processed in small
        byte-range chunks (a few hundred KB at a time) so nothing ever hits a request-size or execution-time
        ceiling, however large the file is.
      </p>

      <div className="flex gap-2 mb-8">
        {(Object.keys(MODE_CONFIG) as Mode[]).map((m) => (
          <button
            key={m}
            disabled={busy}
            onClick={() => {
              setMode(m);
              setPhase("idle");
              setSummary(null);
              setErrors([]);
              setMessage(null);
            }}
            className={`text-xs tracking-widest2 uppercase px-4 py-2 border ${
              mode === m ? "border-ink-950 bg-ink-950 text-warm-50" : "border-stone-300 text-stone-500"
            }`}
          >
            {MODE_CONFIG[m].label}
          </button>
        ))}
      </div>

      {mode === "csv" ? (
        <div className="border border-stone-200 p-6 mb-8">
          <p className="text-xs font-medium mb-2">Expected columns</p>
          <p className="text-xs text-stone-500 leading-relaxed">
            handle, title, product_type, short_description, description, price, compare_at, sku, stock_on_hand,
            category_handles (pipe- or comma-separated existing category handles), brand, material, height_cm, status,
            image_urls (pipe- or comma-separated, already-hosted image URLs — first is used as the primary image)
          </p>
        </div>
      ) : (
        <div className="border border-stone-200 p-6 mb-8">
          <p className="text-xs font-medium mb-2">What this does</p>
          <p className="text-xs text-stone-500 leading-relaxed">
            Upload a WooCommerce product-export .xlsx directly. Converted server-side into the
            same import format — product type and category are classified from the title and WooCommerce categories,
            material/height are parsed from the embedded spec table, and every row lands as{" "}
            <span className="font-medium">DRAFT</span> for review before publishing. Images are referenced from the
            source site's own URLs, not re-hosted here.
          </p>
        </div>
      )}

      <label className="flex items-start gap-2 mb-6 text-xs text-stone-600 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={markMissingOutOfStock}
          disabled={busy}
          onChange={(e) => setMarkMissingOutOfStock(e.target.checked)}
        />
        <span>
          Mark products not in this file as <span className="font-medium">Out Of Stock</span>. Existing products are
          always left alone by default — this only affects products sharing a brand with the imported file whose
          handle doesn&apos;t appear in it (their stock is set to 0; they are not deleted or unpublished).
        </span>
      </label>

      <input
        ref={fileInput}
        type="file"
        accept={MODE_CONFIG[mode].accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) runImport(file);
        }}
      />

      <button className="btn-primary" disabled={busy} onClick={() => fileInput.current?.click()}>
        {phase === "idle" && `Choose ${mode === "csv" ? "CSV" : ".xlsx"} File`}
        {phase === "uploading" && "Uploading…"}
        {phase === "processing" && "Processing…"}
        {(phase === "done" || phase === "error") && "Import Another File"}
      </button>

      {summary && (
        <div className="mt-6 border border-stone-200 p-4 text-xs text-stone-600">
          <p className="mb-1">
            <span className="font-medium">{summary.totalRows}</span> product row(s) converted
            {summary.excludedTitles.length > 0 && ` · ${summary.excludedTitles.length} row(s) excluded (not real products)`}
          </p>
          <p className="text-stone-500">
            {Object.entries(summary.typeCounts)
              .map(([type, count]) => `${count} ${type}`)
              .join(" · ")}
          </p>
        </div>
      )}

      {phase !== "idle" && (
        <div className="mt-8">
          <div className="h-2 bg-stone-200 w-full">
            <div className="h-2 bg-ink-950 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-stone-500 mt-2">
            {progress}% · {processedRows} new product{processedRows === 1 ? "" : "s"} added
            {skippedExisting > 0 ? ` · ${skippedExisting} already existed (left alone)` : ""}
            {markedOutOfStock !== undefined ? ` · ${markedOutOfStock} marked out of stock` : ""}
            {errors.length > 0 ? ` · ${errors.length} row error${errors.length === 1 ? "" : "s"}` : ""}
          </p>
        </div>
      )}

      {phase === "done" && <p className="text-sm mt-4">Import complete.</p>}
      {phase === "error" && <p className="text-sm text-red-600 mt-4">{message}</p>}

      {errors.length > 0 && (
        <div className="mt-6 border border-stone-200 max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-stone-500 border-b border-stone-200">
                <th className="p-2">Row</th>
                <th className="p-2">Handle</th>
                <th className="p-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((e, i) => (
                <tr key={i} className="border-b border-stone-100">
                  <td className="p-2">{e.rowNumber >= 0 ? e.rowNumber : "—"}</td>
                  <td className="p-2">{e.handle ?? "—"}</td>
                  <td className="p-2">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
