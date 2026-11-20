import { PageLoader } from "@/components/ui/page-loader";

/**
 * Shown inside the portal frame (`messages/layout.tsx`, ADR-081) while a
 * conversation loads, so the banner and tabs stay put like any portal page.
 */
export default function Loading() {
  return <PageLoader />;
}
