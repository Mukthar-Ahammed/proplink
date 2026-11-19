import {
  UK_DOTS,
  UK_DOT_RADIUS,
  UK_MAP_HEIGHT,
  UK_MAP_WIDTH,
  projectUk,
} from "@/lib/ukDotMap";

/** Pins that pulse continuously. [lon, lat, delay in seconds] */
const STEADY: [number, number, number][] = [
  [-0.12, 51.5, 0], // London
  [-2.24, 53.48, 0.7], // Manchester
  [-1.9, 52.48, 1.4], // Birmingham
  [-4.25, 55.86, 2.1], // Glasgow
  [-2.59, 51.45, 1.0], // Bristol
  [-1.61, 54.97, 1.8], // Newcastle
];

/** Pins that pop in, hold and fade — "a new listing just landed here". */
const POPS: [number, number, number][] = [
  [-1.55, 53.8, 0.4], // Leeds
  [-3.19, 55.95, 1.6], // Edinburgh
  [-3.18, 51.48, 2.9], // Cardiff
  [-5.93, 54.6, 4.1], // Belfast
  [-2.98, 53.41, 5.2], // Liverpool
  [1.3, 52.63, 3.4], // Norwich
  [-1.15, 52.95, 6.0], // Nottingham
  [-4.14, 50.37, 2.2], // Plymouth
  [-2.1, 57.15, 4.8], // Aberdeen
  [-1.4, 50.9, 5.8], // Southampton
];

/** Shared by both pin kinds: soft halo, expanding ring, solid dot. */
function Pin({ delay }: { delay: number }) {
  return (
    <>
      <circle r={15} className="fill-accent/10" />
      <circle
        r={6}
        className="animate-blip fill-none stroke-accent stroke-2 [transform-box:fill-box] origin-center motion-reduce:animate-none motion-reduce:opacity-0"
        style={{ animationDelay: `${delay}s` }}
      />
      <circle r={6} className="fill-accent" />
      <circle r={2.2} className="fill-white" />
    </>
  );
}

/**
 * Dot-matrix UK with pulsing listing pins (ADR-071 hero). Purely decorative —
 * the pins are illustrative regional markers, not real listing positions, and
 * carry no details — so the whole figure is `aria-hidden`. Server component:
 * the dots are static SVG and every animation is CSS (`animate-blip`,
 * `animate-blip-pop` in `globals.css`), all off under reduced motion.
 */
export function UkListingsMap({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${UK_MAP_WIDTH} ${UK_MAP_HEIGHT}`}
      className={className}
      overflow="visible"
    >
      <g className="fill-accent/20">
        {UK_DOTS.map((d) => (
          <circle key={`${d.x}-${d.y}`} cx={d.x} cy={d.y} r={UK_DOT_RADIUS} />
        ))}
      </g>

      {STEADY.map(([lon, lat, delay]) => {
        const { x, y } = projectUk(lon, lat);
        return (
          <g key={`s-${lon}-${lat}`} transform={`translate(${x} ${y})`}>
            <Pin delay={delay} />
          </g>
        );
      })}

      {POPS.map(([lon, lat, delay]) => {
        const { x, y } = projectUk(lon, lat);
        return (
          <g key={`p-${lon}-${lat}`} transform={`translate(${x} ${y})`}>
            <g
              className="animate-blip-pop [transform-box:fill-box] origin-center motion-reduce:animate-none"
              style={{ animationDelay: `${delay}s` }}
            >
              <Pin delay={0.3} />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
