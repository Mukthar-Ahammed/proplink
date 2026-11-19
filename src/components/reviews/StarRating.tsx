/**
 * Average stars from published reviews (Phase 5 Task 4, ADR-054). The text is
 * the accessible name; the stars are decoration.
 */
export function StarRating({
  average,
  count,
  className = "",
}: {
  average: number;
  count: number;
  className?: string;
}) {
  if (count === 0) {
    return <span className={`text-xs text-muted ${className}`}>No reviews yet</span>;
  }
  const label = `Rated ${average.toFixed(1)} out of 5 from ${count} review${count === 1 ? "" : "s"}`;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-body ${className}`}
      data-testid="star-rating"
      title={label}
    >
      <span aria-hidden className="text-warning">
        ★
      </span>
      <span className="sr-only">{label}</span>
      <span aria-hidden>
        {average.toFixed(1)} <span className="text-muted">({count})</span>
      </span>
    </span>
  );
}

export function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5 stars`} className="text-warning">
      {"★".repeat(rating)}
      <span className="text-line">{"★".repeat(5 - rating)}</span>
    </span>
  );
}
