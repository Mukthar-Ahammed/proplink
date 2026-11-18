"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";

export interface PortalItem {
  id: string;
  name: string;
  desc: string;
  href: string;
  label: string;
  icon: string;
}

const PORTALS: PortalItem[] = [
  {
    id: "01",
    name: "Marketplace",
    desc: "Search approved listings by defect, EPC band and budget.",
    href: "/marketplace",
    label: "SHARED PROPERTY DATA",
    icon: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z M15.4 15.4 20.2 20.2 M6.9 11.7 10.5 8.7l3.6 3 M8.3 10.5v3.8h4.4v-3.8",
  },
  {
    id: "02",
    name: "Investor Portal",
    desc: "Syndicate pooling, refurb tracking, capital ledger.",
    href: "/investor",
    label: "MARKET SIGNALS",
    icon: "M12 5A7.5 7.5 0 1 1 4.5 12.5L12 12.5Z M10.6 3.6A7.5 7.5 0 0 0 3.1 11.1L10.6 11.1Z",
  },
  {
    id: "03",
    name: "Agent Portal",
    desc: "List stock, manage leads, build a verified record.",
    href: "/agent",
    label: "VERIFIED RECORDS",
    icon: "M12 3.4l2.2 2.3 3.2-.3-.3 3.2 2.3 2.2-2.3 2.2.3 3.2-3.2-.3-2.2 2.3-2.2-2.3-3.2.3.3-3.2-2.3-2.2 2.3-2.2-.3-3.2 3.2.3Z M9.6 10.9l1.7 1.7 3.2-3.6",
  },
  {
    id: "04",
    name: "Market Intelligence",
    desc: "Comparables, EPC uplift and planning feeds.",
    href: "/marketplace",
    label: "CAPITAL INSIGHTS",
    icon: "M3.5 20h17 M6.5 20v-5 M11 20V9 M15.5 20v-7 M19.5 20V6",
  },
  {
    id: "05",
    name: "Ecosystem",
    desc: "Vetted conveyancers, surveyors, insurers and trades.",
    href: "/marketplace",
    label: "TRUSTED PROFESSIONALS",
    icon: "M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z M5 4.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z M19 4.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z M12 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z M10.1 10.3 6.6 7.8 M13.9 10.3l3.5-2.5 M12 14.6V18",
  },
];

const ECOSYSTEM_TRADES = [
  "Conveyancers",
  "Surveyors",
  "Structural engineers",
  "Insurers",
  "Damp specialists",
  "Roofing",
  "Asbestos removal",
  "Planning consultants",
];

/** Desktop SVG connector definitions for 1200x680 coordinate space */
const DESKTOP_CONNECTORS = [
  // 01 Marketplace (Top Center)
  {
    id: "01",
    path: "M 600 172 L 600 240",
    startNode: { x: 600, y: 172 },
    endNode: { x: 600, y: 240 },
  },
  // 02 Investor Portal (Top Left)
  {
    id: "02",
    path: "M 320 170 C 430 170, 450 250, 500 250",
    startNode: { x: 320, y: 170 },
    endNode: { x: 500, y: 250 },
  },
  // 03 Agent Portal (Top Right)
  {
    id: "03",
    path: "M 880 170 C 770 170, 750 250, 700 250",
    startNode: { x: 880, y: 170 },
    endNode: { x: 700, y: 250 },
  },
  // 04 Market Intelligence (Bottom Left)
  {
    id: "04",
    path: "M 320 490 C 430 490, 450 430, 500 430",
    startNode: { x: 320, y: 490 },
    endNode: { x: 500, y: 430 },
  },
  // 05 Ecosystem (Bottom Right)
  {
    id: "05",
    path: "M 880 490 C 770 490, 750 430, 700 430",
    startNode: { x: 880, y: 490 },
    endNode: { x: 700, y: 430 },
  },
];

export function PlatformEcosystem() {
  const [activeHover, setActiveHover] = useState<string | null>(null);

  return (
    <section className="relative overflow-hidden bg-surface py-20 sm:py-28 lg:py-32">
      {/* Background Architectural Grid Pattern */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "radial-gradient(#062319 0.75px, transparent 0.75px), linear-gradient(to right, #062319 1px, transparent 1px), linear-gradient(to bottom, #062319 1px, transparent 1px)",
          backgroundSize: "24px 24px, 72px 72px, 72px 72px",
        }}
      />

      {/* Ambient Radial Glow behind section center */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(16,185,129,0.12) 0%, rgba(6,35,25,0.05) 50%, transparent 70%)",
        }}
      />

      {/* Header Container */}
      <div className="relative mx-auto w-full max-w-3xl px-6 text-center">
        <p className="text-[11px] font-semibold tracking-[0.24em] text-secondary/80 uppercase">
          The Platform
        </p>
        <h2 className="font-display mt-3 text-[clamp(2rem,4vw,3.25rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-primary">
          Five portals, <span className="font-light text-secondary">shared data</span>
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
          A single property ecosystem connecting investors, agents, professionals and
          market data. Different portals, one shared source of truth.
        </p>
      </div>

      {/* ================================================================ DESKTOP CANVAS (≥1024px) */}
      <div className="relative mx-auto mt-12 hidden h-[680px] w-full max-w-6xl xl:max-w-7xl lg:block">
        {/* SVG Connector Lines & Node Network Overlay */}
        <svg
          aria-hidden
          viewBox="0 0 1200 680"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          <defs>
            <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Faint Background Data Rings around Centerpiece */}
          <circle
            cx="600"
            cy="350"
            r="170"
            fill="none"
            stroke="#062319"
            strokeOpacity="0.08"
            strokeWidth="1.2"
          />
          <circle
            cx="600"
            cy="350"
            r="240"
            fill="none"
            stroke="#062319"
            strokeOpacity="0.06"
            strokeWidth="1"
            strokeDasharray="4 6"
          />
          <circle
            cx="600"
            cy="350"
            r="310"
            fill="none"
            stroke="#062319"
            strokeOpacity="0.04"
            strokeWidth="1"
          />

          {/* Render Desktop Connector Curves */}
          {DESKTOP_CONNECTORS.map((conn) => {
            const isHovered = activeHover === conn.id;

            return (
              <g key={conn.id} className="transition-all duration-300">
                {/* Subtle soft shadow beam when hovered */}
                {isHovered && (
                  <path
                    d={conn.path}
                    fill="none"
                    stroke="#062319"
                    strokeWidth="3.5"
                    strokeOpacity="0.1"
                  />
                )}

                {/* Main Curved Connection Line */}
                <path
                  d={conn.path}
                  fill="none"
                  stroke="#062319"
                  strokeOpacity={isHovered ? 0.75 : 0.22}
                  strokeWidth={isHovered ? 2.0 : 1.4}
                  className="transition-all duration-300"
                />

                {/* Subtle Connection Node Halos when Hovered */}
                {isHovered && (
                  <>
                    <circle
                      cx={conn.startNode.x}
                      cy={conn.startNode.y}
                      r="6"
                      fill="#062319"
                      fillOpacity="0.12"
                    />
                    <circle
                      cx={conn.endNode.x}
                      cy={conn.endNode.y}
                      r="6"
                      fill="#062319"
                      fillOpacity="0.12"
                    />
                  </>
                )}

                {/* Connection End Node Dots */}
                <circle
                  cx={conn.startNode.x}
                  cy={conn.startNode.y}
                  r={isHovered ? 4.5 : 3.5}
                  fill="#062319"
                  fillOpacity={isHovered ? 0.85 : 0.45}
                  className="transition-all duration-300"
                />
                <circle
                  cx={conn.endNode.x}
                  cy={conn.endNode.y}
                  r={isHovered ? 4.5 : 3.5}
                  fill="#062319"
                  fillOpacity={isHovered ? 0.85 : 0.45}
                  className="transition-all duration-300"
                />
              </g>
            );
          })}
        </svg>

        {/* Centerpiece Image Anchor */}
        <div className="absolute left-1/2 top-1/2 h-[320px] w-[420px] -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center">
          <Image
            src="/ui/comp 1.png"
            alt="PropLink Shared Platform Infrastructure"
            width={520}
            height={400}
            priority
            className="h-full w-full object-contain drop-shadow-[0_12px_24px_rgba(6,35,25,0.08)] transition-transform duration-500 hover:scale-[1.02]"
          />
        </div>

        {/* 01 Marketplace (Top Center) */}
        <div className="absolute left-1/2 top-0 w-[340px] -translate-x-1/2">
          <PortalCard
            portal={PORTALS[0]}
            isHovered={activeHover === PORTALS[0].id}
            onHover={(hover) => setActiveHover(hover ? PORTALS[0].id : null)}
          />
        </div>

        {/* 02 Investor Portal (Top Left) */}
        <div className="absolute left-0 top-[110px] w-[310px]">
          <PortalCard
            portal={PORTALS[1]}
            isHovered={activeHover === PORTALS[1].id}
            onHover={(hover) => setActiveHover(hover ? PORTALS[1].id : null)}
          />
        </div>

        {/* 03 Agent Portal (Top Right) */}
        <div className="absolute right-0 top-[110px] w-[310px]">
          <PortalCard
            portal={PORTALS[2]}
            isHovered={activeHover === PORTALS[2].id}
            onHover={(hover) => setActiveHover(hover ? PORTALS[2].id : null)}
          />
        </div>

        {/* 04 Market Intelligence (Bottom Left) */}
        <div className="absolute bottom-[40px] left-0 w-[310px]">
          <PortalCard
            portal={PORTALS[3]}
            isHovered={activeHover === PORTALS[3].id}
            onHover={(hover) => setActiveHover(hover ? PORTALS[3].id : null)}
          />
        </div>

        {/* 05 Ecosystem (Bottom Right) */}
        <div className="absolute bottom-[40px] right-0 w-[310px]">
          <PortalCard
            portal={PORTALS[4]}
            isHovered={activeHover === PORTALS[4].id}
            onHover={(hover) => setActiveHover(hover ? PORTALS[4].id : null)}
          />
        </div>
      </div>

      {/* ================================================================ TABLET LAYOUT (768px – 1023px) */}
      <div className="mx-auto mt-12 hidden w-full max-w-4xl px-6 md:block lg:hidden">
        {/* Centerpiece Image */}
        <div className="relative mx-auto my-6 flex h-[280px] w-[380px] items-center justify-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-tr from-accent/10 to-primary/5 blur-2xl"
          />
          <Image
            src="/ui/comp 1.png"
            alt="PropLink Shared Platform Infrastructure"
            width={440}
            height={320}
            className="h-full w-full object-contain"
          />
        </div>

        {/* Card 01 Centered */}
        <div className="mx-auto mb-6 max-w-md">
          <PortalCard portal={PORTALS[0]} isHovered={false} onHover={() => {}} />
        </div>

        {/* Cards 02 & 03 Grid */}
        <div className="grid grid-cols-2 gap-5">
          <PortalCard portal={PORTALS[1]} isHovered={false} onHover={() => {}} />
          <PortalCard portal={PORTALS[2]} isHovered={false} onHover={() => {}} />
        </div>

        {/* Cards 04 & 05 Grid */}
        <div className="mt-5 grid grid-cols-2 gap-5">
          <PortalCard portal={PORTALS[3]} isHovered={false} onHover={() => {}} />
          <PortalCard portal={PORTALS[4]} isHovered={false} onHover={() => {}} />
        </div>
      </div>

      {/* ================================================================ MOBILE LAYOUT (<768px) */}
      <div className="mx-auto mt-8 flex w-full max-w-md flex-col px-5 md:hidden">
        {/* Centerpiece Floating Image */}
        <div className="relative mx-auto flex h-[220px] w-full items-center justify-center py-2">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-4 rounded-full bg-accent/10 blur-xl"
          />
          <Image
            src="/ui/comp 1.png"
            alt="PropLink Shared Platform Infrastructure"
            width={320}
            height={240}
            className="h-full w-full object-contain drop-shadow-md"
          />
        </div>

        {/* Shared Data Indicator Line */}
        <div className="relative mx-auto my-4 flex flex-col items-center">
          <span className="text-[10px] font-semibold tracking-widest text-primary/70 uppercase">
            SHARED DATA INFRASTRUCTURE
          </span>
          <div className="mt-2 h-8 w-0.5 bg-gradient-to-b from-primary/40 to-primary/10" />
        </div>

        {/* Stacked Cards */}
        <div className="flex flex-col gap-4">
          {PORTALS.map((portal) => (
            <PortalCard
              key={portal.id}
              portal={portal}
              isHovered={false}
              onHover={() => {}}
            />
          ))}
        </div>
      </div>

      {/* ================================================================ ECOSYSTEM MARQUEE BAND */}
      <div
        aria-hidden
        className="relative mt-20 overflow-hidden border-y border-line bg-background py-5"
      >
        <div className="animate-marquee flex w-max motion-reduce:animate-none">
          {[0, 1].map((copy) => (
            <ul key={copy} className="flex shrink-0 items-center">
              {ECOSYSTEM_TRADES.map((trade) => (
                <li
                  key={trade}
                  className="flex items-center gap-8 pr-8 text-sm tracking-[0.12em] text-muted uppercase"
                >
                  <span className="text-accent">&#9670;</span>
                  {trade}
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}

function PortalCard({
  portal,
  isHovered,
  onHover,
}: {
  portal: PortalItem;
  isHovered: boolean;
  onHover: (hovered: boolean) => void;
}) {
  return (
    <Link
      href={portal.href}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      className={cn(
        "group relative flex flex-col rounded-[22px] border bg-white/95 p-6 shadow-[0_4px_20px_-4px_rgba(6,35,25,0.06)] backdrop-blur-sm transition-all duration-300 ease-out",
        "border-line hover:border-primary/30 hover:shadow-[0_12px_32px_-6px_rgba(6,35,25,0.14)] hover:-translate-y-1.5",
        isHovered &&
          "border-primary/40 shadow-[0_12px_32px_-6px_rgba(6,35,25,0.14)] -translate-y-1.5",
      )}
    >
      <div className="flex items-center justify-between">
        {/* Glyph Icon Container */}
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#eef4f0] text-primary transition-colors group-hover:bg-primary group-hover:text-white">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <path d={portal.icon} />
          </svg>
        </div>

        {/* Portal Index Number */}
        <span className="text-xs font-semibold tracking-wider text-muted tabular-nums">
          {portal.id}
        </span>
      </div>

      {/* Title */}
      <h3 className="font-display mt-4 text-lg font-semibold tracking-[-0.01em] text-primary group-hover:text-accent transition-colors">
        {portal.name}
      </h3>

      {/* Description */}
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{portal.desc}</p>
    </Link>
  );
}
