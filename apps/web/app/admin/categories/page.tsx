import { getCategoryTree } from "@/lib/data/categories";

export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  const tree = await getCategoryTree();
  return (
    <div>
      <h1 className="font-serif text-3xl mb-6">Categories</h1>
      <div className="space-y-4">
        {tree.map((c) => (
          <div key={c.handle} className="border border-stone-200 p-4">
            <p className="text-sm font-medium">{c.name}</p>
            {c.children.length > 0 && (
              <ul className="mt-2 pl-4 text-xs text-stone-500 space-y-1">
                {c.children.map((child) => (
                  <li key={child.handle}>{child.name}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
