import { PageLoader } from "@/components/ui/page-loader";

/** Site-wide fallback while a page's server data loads (ADR-077). */
export default function Loading() {
  return <PageLoader className="min-h-[60vh]" />;
}
