import { PageLoader } from "@/components/ui/page-loader";

/**
 * Fallback while a public page's server data loads (ADR-077). Each top-level
 * public folder re-exports it as its `loading.tsx`. It deliberately is not a
 * root `app/loading.tsx`: a root boundary blanks the whole page whenever the
 * top-level folder changes, so going from a portal to Messages (which wears
 * the same portal frame, ADR-081) flashed a bare spinner screen.
 */
export default function SiteLoading() {
  return <PageLoader className="min-h-[60vh]" />;
}
