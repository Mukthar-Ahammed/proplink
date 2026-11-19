import { redirect } from "next/navigation";

/**
 * Buyer messages moved to the shared, realtime chat (Phase 3 Task 7,
 * ADR-043). Kept as a redirect so old links keep working.
 */
export default function BuyerMessagesPage() {
  redirect("/messages");
}
