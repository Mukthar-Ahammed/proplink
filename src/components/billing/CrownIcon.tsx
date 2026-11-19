/** Gold crown marking a subscription feature. Decorative: pair it with text. */
export function CrownIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M3.2 7.6a1 1 0 0 1 1.6-.9l3.7 3 2.7-4.6a1 1 0 0 1 1.7 0l2.7 4.6 3.7-3a1 1 0 0 1 1.6.9l-1.4 9.1a1 1 0 0 1-1 .8H5.6a1 1 0 0 1-1-.8L3.2 7.6Z" />
      <rect x="5" y="19" width="14" height="2" rx="1" />
    </svg>
  );
}
