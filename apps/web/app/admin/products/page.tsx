import Link from "next/link";
import { getAllProductsForAdmin } from "@/lib/data/products";
import { publishAllDrafts, publishProduct } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  const products = await getAllProductsForAdmin();
  const draftCount = products.filter((p) => p.status === "DRAFT").length;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="font-serif text-3xl">Products</h1>
        <div className="flex gap-3">
          {draftCount > 0 && (
            <form action={publishAllDrafts}>
              <button type="submit" className="btn-secondary">
                Publish All Drafts ({draftCount})
              </button>
            </form>
          )}
          <Link href="/admin/products/import" className="btn-secondary">
            Import CSV
          </Link>
          <button className="btn-primary">New Product</button>
        </div>
      </div>
      {draftCount > 0 && (
        <p className="text-xs text-stone-500 mb-4">
          {draftCount} product{draftCount === 1 ? "" : "s"} imported as Draft and not yet visible on the storefront — publish individually below
          or all at once above.
        </p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-stone-500 border-b border-stone-200">
            <th className="py-2">Title</th>
            <th className="py-2">Type</th>
            <th className="py-2">Status</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} className="border-b border-stone-100">
              <td className="py-2">{p.title}</td>
              <td className="py-2 text-stone-500">{p.productType}</td>
              <td className="py-2 text-stone-500">{p.status}</td>
              <td className="py-2 flex gap-3 items-center">
                <button className="text-xs underline">Edit</button>
                {p.status !== "PUBLISHED" && (
                  <form action={publishProduct.bind(null, p.id)}>
                    <button type="submit" className="text-xs underline">
                      Publish
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
