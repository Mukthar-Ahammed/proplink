import type { Metadata } from "next";
import { Figtree, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { ChromeGate } from "@/components/layout/ChromeGate";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { CookieBanner } from "@/components/layout/CookieBanner";
import { DemoBanner } from "@/components/layout/DemoBanner";
import { ToastProvider } from "@/components/ui/toast";
import { SITE_URL } from "@/lib/siteUrl";

/**
 * Typography (ADR-071). Figtree carries every UI surface and headline; the
 * italic Instrument Serif is the editorial accent — one or two words inside a
 * headline (`font-serif italic`), never body or UI text. Figtree is variable,
 * so `weight` is omitted; Instrument Serif ships a single 400 weight.
 */
const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  // Lets per-page `generateMetadata` (e.g. `/marketplace/[id]`, Task 2.5) set
  // relative `openGraph.images`/canonical URLs that Next resolves to
  // absolute ones — required for OpenGraph tags to be spec-valid.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "PropLink UK — The UK Distressed Property Platform",
    template: "%s · PropLink UK",
  },
  description:
    "Distressed property marketplace, investor syndication, agent credibility and market intelligence — discovery to completion on one platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-GB"
      className={`${figtree.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ToastProvider>
          {/* ADR-076: the hosted demo's banner shows on every page. */}
          <DemoBanner />
          {/* The `(auth)` routes carry their own full-bleed shell and suppress
              the global chrome — see `<ChromeGate>`. The cookie banner is not
              gated: consent has to be offered on every page. */}
          <ChromeGate>
            <SiteHeader />
          </ChromeGate>
          {children}
          <ChromeGate>
            <SiteFooter />
          </ChromeGate>
          <CookieBanner />
        </ToastProvider>
      </body>
    </html>
  );
}
