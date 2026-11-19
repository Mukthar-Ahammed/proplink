/** Money and date helpers shared by project pages (server and client). */
/** Pence → plain pounds for form defaults ("125000.50"). */
export function penceToPoundsInput(pence: bigint | null | undefined): string {
  if (pence === null || pence === undefined) return "";
  const negative = pence < BigInt(0);
  const abs = negative ? -pence : pence;
  const whole = abs / BigInt(100);
  const rest = Number(abs % BigInt(100));
  return `${negative ? "-" : ""}${whole}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

/** A date as YYYY-MM-DD (UTC), or "—". */
export function day(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : "—";
}
