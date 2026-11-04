"use client";

import { useEffect, useState } from "react";

export function RateLimitCountdown({ seconds }: { seconds: number }) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setInterval(
      () => setRemaining((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [seconds]);

  if (remaining <= 0) return null;
  return <span aria-live="polite"> Try again in {remaining} seconds.</span>;
}
