"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

export interface GalleryImage {
  url: string;
  alt: string;
}

/** Thumbnails shown beside the main image before the "+N" tile takes over. */
const VISIBLE_THUMBS = 4;

/**
 * Main image with previous/next arrows and a thumbnail column (ADR-071; Task
 * 2.5 brief: "gallery ... keyboard accessible"). Thumbnails are real `<button>`
 * elements with `role="tab"` and `aria-selected`, so they are focusable and fire
 * on Enter/Space with no extra key handling. On narrow screens the thumbnails
 * become a horizontal strip under the image.
 *
 * Plain `<img>`, not `next/image`: S3/mock-storage URLs and agent-hosted URLs
 * aren't in any configured image domain list.
 */
export function PropertyGallery({ images }: { images: GalleryImage[] }) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex aspect-[16/9] w-full items-center justify-center rounded-3xl border border-line bg-surface text-sm text-muted">
        No photos uploaded yet
      </div>
    );
  }

  const active = images[activeIndex] ?? images[0];
  const many = images.length > 1;
  const go = (delta: number) =>
    setActiveIndex((i) => (i + delta + images.length) % images.length);

  const thumbs = images.slice(0, VISIBLE_THUMBS);
  const hidden = images.length - thumbs.length;

  return (
    <div className={cn("grid gap-3", many && "lg:grid-cols-[1fr_9.5rem]")}>
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={active.url}
          alt={active.alt}
          data-testid="gallery-main-image"
          className="aspect-[16/10] w-full rounded-3xl bg-surface object-cover"
        />
        {many && (
          <>
            <ArrowButton side="left" label="Previous photo" onClick={() => go(-1)} />
            <ArrowButton side="right" label="Next photo" onClick={() => go(1)} />
            <span className="absolute bottom-4 left-4 rounded-full bg-primary/70 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
              {activeIndex + 1} / {images.length}
            </span>
          </>
        )}
      </div>

      {many && (
        <div
          className="flex gap-3 overflow-x-auto lg:flex-col lg:overflow-visible"
          role="tablist"
          aria-label="Photos"
        >
          {images.map((img, i) => {
            const isOverflowTile = i === VISIBLE_THUMBS - 1 && hidden > 0;
            return (
              <button
                key={img.url + i}
                type="button"
                role="tab"
                aria-selected={i === activeIndex}
                aria-label={`Show photo ${i + 1} of ${images.length}`}
                onClick={() => setActiveIndex(i)}
                className={cn(
                  "relative h-20 w-28 flex-none overflow-hidden rounded-2xl ring-2 ring-offset-2 transition lg:h-auto lg:w-full lg:flex-1",
                  i === activeIndex ? "ring-accent" : "ring-transparent hover:ring-line",
                  // Beyond the visible column, thumbnails stay in the strip on
                  // mobile but are folded into the "+N" tile on desktop.
                  i >= VISIBLE_THUMBS && "lg:hidden",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" className="h-full w-full object-cover" />
                {isOverflowTile && (
                  <span
                    aria-hidden
                    className="absolute inset-0 hidden items-center justify-center bg-primary/55 text-lg font-semibold text-white lg:flex"
                  >
                    +{hidden + 1}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ArrowButton({
  side,
  label,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-primary shadow-md backdrop-blur-sm transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        side === "left" ? "left-4" : "right-4",
      )}
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
      >
        <path d={side === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
      </svg>
    </button>
  );
}
