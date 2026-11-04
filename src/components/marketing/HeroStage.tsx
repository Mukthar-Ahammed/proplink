"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { RenderObject } from "@/components/marketing/RenderObject";
import { heroProgress, orbitTransform } from "@/lib/scrollOrbit";
import heroImage from "@/assets/heroimage.jpeg";

/**
 * The hero: a full-bleed band of `brand` petrol carrying one floating object,
 * which the page's scroll swings through three viewing angles (ADR-008,
 * ADR-014).
 *
 * **The ground is flat colour, not a photograph.** That is the reference's
 * language, and it deletes a whole class of problem with it: `TYPE_SCRIM` and
 * the fog scrims existed only to keep ink legible over brick, and the headline
 * is now white on a token whose contrast is fixed at 9.86:1 by the token
 * itself. The terrace photograph moved to the categories split, where it is a
 * subject rather than a backdrop.
 *
 * Everything overlaid arrives as `children` from the server component, so this
 * file is the only client JavaScript the landing page ships. It publishes:
 *
 * - `data-entered` on the section, flipped on after mount, driving the staggered
 *   entrance of everything overlaid. Utilities and transitions only, no
 *   keyframes — a hand-added rule in `globals.css` goes stale under Turbopack's
 *   Tailwind cache (`src/lib/plateWash.ts`).
 * - `data-orbit`, so the reduced-motion path is assertable from an e2e test.
 *
 * Hand-rolled rather than a motion library: the whole effect is one
 * `rAF`-throttled scroll listener writing one `transform`, and the maths that
 * would be worth a dependency lives in `@/lib/scrollOrbit`, unit tested. See
 * ADR-008.
 */

/** Rotation multiplier below `sm`. A yawed plane eats horizontal room. */
const NARROW_DAMPING = 0.4;

export function HeroStage({ children }: { children: React.ReactNode }) {
  const heroRef = useRef<HTMLElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const [reduced, setReduced] = useState(false);
  const [entered, setEntered] = useState(false);

  // Split from the orbit effect so a mid-session change to the OS setting tears
  // the listener down rather than merely damping it.
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // One frame after mount, so the transition has an initial state to leave.
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const hero = heroRef.current;
    const plane = planeRef.current;
    if (!hero || !plane) return;

    // Reduced motion gets no scroll coupling at all, not a damped version of
    // it: scroll-linked scale is exactly the thing that provokes vestibular
    // discomfort, so the object is set square-on and left alone.
    if (reduced) {
      plane.style.transform = orbitTransform(0.5, 0);
      return;
    }

    const narrow = window.matchMedia("(max-width: 639px)");

    let raf = 0;
    let onScreen = true;
    let last = "";

    const paint = () => {
      raf = 0;
      const rect = hero.getBoundingClientRect();
      const next = orbitTransform(
        heroProgress(rect.top, rect.height),
        narrow.matches ? NARROW_DAMPING : 1,
      );
      // The rounding in `orbitTransform` is what makes this guard bite: without
      // it, float noise changes the string on frames where nothing moved.
      if (next !== last) {
        plane.style.transform = next;
        last = next;
      }
    };

    const schedule = () => {
      if (!raf && onScreen) raf = requestAnimationFrame(paint);
    };

    // Once the hero has scrolled away there is nothing to move, so the scroll
    // listener stops doing work for the whole rest of the page.
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen) schedule();
    });
    observer.observe(hero);

    paint();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    narrow.addEventListener("change", schedule);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      narrow.removeEventListener("change", schedule);
    };
  }, [reduced]);

  return (
    <section
      ref={heroRef}
      data-testid="hero-stage"
      data-entered={entered ? "true" : "false"}
      className="group/hero relative isolate flex flex-col overflow-visible bg-[#0e4a55]"
    >
      {/* Ambient radial bloom overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-full"
        style={{
          backgroundImage:
            "radial-gradient(70rem 36rem at 50% 0%, rgba(255, 255, 255, 0.12), transparent 70%)",
        }}
      />

      {children}

      {/* Panoramic photographic banner matching reference image composition */}
      <div
        aria-hidden={false}
        className="relative mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8"
      >
        <div
          className="
            relative overflow-hidden
            rounded-[24px] sm:rounded-[32px] lg:rounded-[36px]
            aspect-[21/9] sm:aspect-[24/9] min-h-[260px] max-h-[480px]
            shadow-2xl border border-primary/10
            opacity-0 transition-opacity duration-[1000ms] ease-out
            group-data-[entered=true]/hero:opacity-100
            motion-reduce:opacity-100 motion-reduce:transition-none
          "
        >
          <Image
            src={heroImage}
            alt="A scaffolded Georgian terrace mid-restoration in London fog"
            fill
            priority
            sizes="(min-width: 1280px) 1200px, (min-width: 1024px) calc(100vw - 80px), calc(100vw - 32px)"
            placeholder="blur"
            className="object-cover object-[28%_30%]"
          />

          {/* Soft vignette scrim */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-primary/30 via-transparent to-transparent"
          />

          {/* Orbit object marker */}
          <div
            className="pointer-events-none absolute right-4 bottom-4
              opacity-0 transition-opacity duration-[1200ms] ease-out
              group-data-[entered=true]/hero:opacity-100
              motion-reduce:opacity-100 motion-reduce:transition-none
              sm:right-8 sm:bottom-6 lg:right-10"
          >
            <div className="[perspective:1400px]">
              <div
                ref={planeRef}
                data-testid="hero-plane"
                data-orbit={reduced ? "static" : "live"}
                className="will-change-transform [transform-origin:50%_50%]"
                style={{ transform: orbitTransform(0) }}
              >
                <RenderObject
                  variant="gable"
                  className="h-24 w-24 sm:h-32 sm:w-32 lg:h-36 lg:w-36 opacity-75 drop-shadow-md"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
