import { unsubscribeAction } from "@/components/buy/savedSearchActions";
import { searchNameForToken } from "@/services/buyers/savedSearches";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stop alerts — PropLink UK", robots: { index: false } };

/**
 * Unsubscribe from one saved search's alerts (Phase 5 Task 3, ADR-056). The
 * page itself changes nothing (mail scanners follow links); the button does.
 */
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const { done } = await searchParams;
  const name = await searchNameForToken(token);
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-bold text-primary">Saved-search alerts</h1>
      {done === "1" ? (
        <p className="mt-4 text-sm text-body" role="status">
          Done. You will get no more alerts for {name ? `"${name}"` : "this search"}. You
          can turn them back on from your saved searches.
        </p>
      ) : name ? (
        <form action={unsubscribeAction} className="mt-4 space-y-4">
          <p className="text-sm text-body">
            Stop email alerts for your saved search &ldquo;{name}&rdquo;?
          </p>
          <input type="hidden" name="token" value={token} />
          <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white">
            Stop these alerts
          </button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-muted">This link is not valid any more.</p>
      )}
    </main>
  );
}
