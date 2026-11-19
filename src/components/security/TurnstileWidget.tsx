"use client";

import { useEffect, useRef } from "react";

type TurnstileOptions = {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
};

declare global {
  interface Window {
    turnstile?: {
      render(container: HTMLElement, options: TurnstileOptions): string;
      remove(widgetId: string): void;
    };
  }
}

type TurnstileWidgetProps = {
  onToken: (token: string | undefined) => void;
  resetKey?: number;
};

export function TurnstileWidget({ onToken, resetKey = 0 }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;

    let active = true;
    let widgetId: string | undefined;
    const container = containerRef.current;
    const render = () => {
      if (!active || !window.turnstile || widgetId) return;
      widgetId = window.turnstile.render(container, {
        sitekey: siteKey,
        callback: (token) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(undefined),
        "error-callback": () => onTokenRef.current(undefined),
      });
    };

    let script = document.querySelector<HTMLScriptElement>(
      'script[data-proplink-turnstile="true"]',
    );
    if (!script) {
      script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.proplinkTurnstile = "true";
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    render();

    return () => {
      active = false;
      script?.removeEventListener("load", render);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      onTokenRef.current(undefined);
    };
  }, [siteKey, resetKey]);

  if (!siteKey) return null;
  return <div ref={containerRef} aria-label="Security verification" />;
}
