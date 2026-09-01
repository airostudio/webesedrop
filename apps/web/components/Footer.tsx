import Link from "next/link";

const columns = [
  {
    title: "Shop",
    links: [
      { label: "Dresses & Kimonos", href: "/shop/dresses-kimonos" },
      { label: "Swim", href: "/shop/swim" },
      { label: "Accessories", href: "/shop/accessories" },
      { label: "Care", href: "/shop/care" },
      { label: "New Arrivals", href: "/shop/new-arrivals" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Contact & Support", href: "/account/support" },
      { label: "Returns", href: "/guides/fabric-care-101" },
      { label: "Warranty", href: "/guides/fabric-care-101" },
      { label: "Care Assistant", href: "/care" },
      { label: "Compare Products", href: "/compare" },
    ],
  },
  {
    title: "About",
    links: [
      { label: "Packing Guide", href: "/guides/packing-for-a-coastal-getaway" },
      { label: "Privacy Policy", href: "/account/privacy" },
      { label: "Shipping Information", href: "/guides" },
      { label: "Product Finder", href: "/product-finder" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-stone-200 bg-ink-950 text-warm-100 mt-24">
      <div className="container-page py-16 grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="font-serif text-2xl mb-4">Beach Footprints</p>
          <p className="text-sm text-stone-400 leading-relaxed max-w-xs">
            Boho surf-culture apparel and accessories, woven and hand-dyed for warm sand and salt air.
          </p>
        </div>
        {columns.map((col) => (
          <div key={col.title}>
            <p className="eyebrow text-stone-500 mb-4">{col.title}</p>
            <ul className="space-y-3">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-stone-300 hover:text-warm-50 transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-ink-800">
        <div className="container-page py-6 text-xs text-stone-500 flex flex-col sm:flex-row justify-between gap-2">
          <p>© {new Date().getFullYear()} Beach Footprints. All rights reserved.</p>
          <p>Free shipping over $75.</p>
        </div>
      </div>
    </footer>
  );
}
