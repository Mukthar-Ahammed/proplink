"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";

const STORAGE_KEY = "proplink-cookie-consent"; // "accepted" | "essential"
const CHANGE_EVENT = "proplink-consent-change";

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

const getSnapshot = () => localStorage.getItem(STORAGE_KEY);
// During SSR pretend a choice exists so the banner only appears after hydration.
const getServerSnapshot = () => "ssr";

export function CookieBanner() {
  const consent = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (consent) return null;

  function choose(value: "accepted" | "essential") {
    localStorage.setItem(STORAGE_KEY, value);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 rounded-3xl border border-line bg-white px-5 py-4 text-body shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-w-xl">
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm">
          We use essential cookies to run PropLink UK. Analytics cookies are only set with
          your consent.{" "}
          <Link href="/privacy" className="font-medium text-accent underline">
            Privacy policy
          </Link>
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => choose("essential")}
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-strong"
          >
            Essential only
          </button>
          <button
            onClick={() => choose("accepted")}
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-strong"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
