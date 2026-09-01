"use client";

import ProductCard from "@/components/ProductCard";
import FilterSidebar, { useFilteredProducts } from "@/components/FilterSidebar";
import type { ProductSummary } from "@/lib/types";

export default function ShopGrid({ products, title, description }: { products: ProductSummary[]; title: string; description?: string }) {
  const { filters, setFilters, materials, filtered } = useFilteredProducts(products);

  return (
    <div className="container-page py-14">
      <div className="mb-10 max-w-2xl">
        <h1 className="font-serif text-4xl mb-3">{title}</h1>
        {description && <p className="text-stone-500">{description}</p>}
      </div>
      <div className="grid lg:grid-cols-[220px_1fr] gap-10">
        <FilterSidebar materials={materials} filters={filters} onChange={setFilters} />
        <div>
          <p className="text-xs text-stone-500 mb-6">{filtered.length} products</p>
          {filtered.length === 0 ? (
            <p className="text-sm text-stone-500">No products match those filters yet.</p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
              {filtered.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
