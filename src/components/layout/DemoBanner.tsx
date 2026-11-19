/**
 * ADR-076: shown on every page of the hosted demo (PROPLINK_ENV=demo), auth
 * screens included, so no visitor mistakes it for the live service. Nothing
 * renders anywhere else.
 */
export function DemoBanner() {
  if (process.env.PROPLINK_ENV !== "demo") return null;
  return (
    <div
      role="note"
      aria-label="Demo site"
      className="bg-primary px-4 py-2 text-center text-xs font-medium text-white sm:text-sm"
      data-testid="demo-banner"
    >
      Demo site: test data only. No real money, identity checks, signatures or emails.
    </div>
  );
}
