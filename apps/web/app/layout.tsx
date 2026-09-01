import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  metadataBase: new URL("https://example.com"),
  title: { default: "Beach Footprints — Boho Surf Lifestyle", template: "%s | Beach Footprints" },
  description: "Boho surf-culture apparel and accessories — woven, hand-dyed and built for barefoot mornings.",
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "Beach Footprints",
    title: "Beach Footprints — Boho Surf Lifestyle",
    description: "Boho surf-culture apparel and accessories for warm sand and salt air.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
