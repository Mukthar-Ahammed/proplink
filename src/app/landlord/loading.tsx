import { PageLoader } from "@/components/ui/page-loader";

/** Shown inside the portal frame while a portal page loads (ADR-077). */
export default function Loading() {
  return <PageLoader />;
}
