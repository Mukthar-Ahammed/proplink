/**
 * Dot-matrix map of the United Kingdom for the landing hero (ADR-071).
 *
 * The outlines are a hand-simplified coastline (lon/lat, roughly 5–15 km
 * accuracy) — plenty for a decorative dot grid, and no geodata dependency. Dots
 * are computed once at module load on the server and shipped as plain SVG.
 */

type LonLat = readonly [lon: number, lat: number];

// prettier-ignore
const GREAT_BRITAIN: LonLat[] = [
  [-3.37, 58.67], [-3.02, 58.64], [-3.1, 58.44], [-3.8, 57.98], [-4.0, 57.85],
  [-3.8, 57.7], [-4.2, 57.5], [-3.6, 57.65], [-2.8, 57.7], [-2.0, 57.68],
  [-1.8, 57.5], [-2.08, 57.15], [-2.2, 56.9], [-2.5, 56.6], [-2.8, 56.45],
  [-2.6, 56.3], [-3.3, 56.05], [-3.2, 55.98], [-2.6, 56.0], [-2.1, 55.87],
  [-1.75, 55.6], [-1.55, 55.2], [-1.4, 54.98], [-1.15, 54.6], [-0.6, 54.48],
  [-0.2, 54.1], [-0.05, 53.65], [0.35, 53.2], [0.2, 52.9], [0.6, 52.95],
  [1.3, 52.92], [1.75, 52.62], [1.6, 52.1], [1.0, 51.8], [0.9, 51.55],
  [0.6, 51.45], [1.4, 51.38], [1.4, 51.15], [0.97, 50.92], [0.25, 50.75],
  [-0.8, 50.75], [-1.3, 50.8], [-2.0, 50.6], [-2.45, 50.57], [-3.0, 50.7],
  [-3.45, 50.6], [-3.6, 50.22], [-4.2, 50.35], [-5.05, 50.0], [-5.7, 50.05],
  [-5.0, 50.4], [-4.53, 51.02], [-4.2, 51.2], [-3.5, 51.2], [-3.0, 51.35],
  [-2.65, 51.55], [-3.15, 51.45], [-3.9, 51.6], [-4.3, 51.67], [-5.05, 51.62],
  [-5.3, 51.75], [-5.1, 52.0], [-4.15, 52.4], [-4.1, 52.85], [-4.75, 52.8],
  [-4.6, 53.3], [-4.3, 53.42], [-3.8, 53.3], [-3.1, 53.35], [-3.05, 53.6],
  [-3.05, 53.95], [-3.2, 54.1], [-3.6, 54.5], [-3.4, 54.95], [-3.6, 54.88],
  [-4.4, 54.7], [-4.9, 54.65], [-5.15, 55.0], [-4.65, 55.45], [-4.85, 55.9],
  [-5.45, 55.85], [-5.6, 55.3], [-5.8, 55.6], [-5.5, 56.4], [-6.2, 56.7],
  [-5.85, 57.0], [-5.7, 57.3], [-5.8, 57.85], [-5.3, 58.15], [-5.0, 58.62],
  [-4.4, 58.55],
];

// prettier-ignore
const NORTHERN_IRELAND: LonLat[] = [
  [-6.05, 55.25], [-5.75, 54.85], [-5.45, 54.6], [-5.5, 54.3], [-6.0, 54.05],
  [-6.6, 54.05], [-7.0, 54.25], [-7.6, 54.15], [-8.15, 54.45], [-7.85, 54.7],
  [-7.55, 55.05], [-7.0, 55.2], [-6.5, 55.25],
];

// prettier-ignore
const ISLANDS: LonLat[][] = [
  // Skye
  [[-6.6, 57.5], [-6.2, 57.7], [-5.75, 57.3], [-6.3, 57.15]],
  // Outer Hebrides
  [[-6.2, 58.52], [-6.25, 58.0], [-7.1, 57.65], [-7.2, 57.0], [-7.5, 57.0],
   [-7.5, 57.6], [-7.1, 58.2], [-6.6, 58.4]],
  // Orkney
  [[-3.4, 59.15], [-2.8, 59.35], [-2.4, 59.0], [-2.9, 58.75], [-3.3, 58.85]],
  // Shetland
  [[-1.3, 60.8], [-0.8, 60.75], [-1.0, 60.2], [-1.3, 59.85], [-1.4, 60.0], [-1.6, 60.5]],
  // Isle of Man
  [[-4.8, 54.05], [-4.35, 54.4], [-4.3, 54.2]],
];

const POLYGONS = [GREAT_BRITAIN, NORTHERN_IRELAND, ...ISLANDS];

const BOUNDS = { minLon: -8.3, maxLon: 1.9, minLat: 49.9, maxLat: 60.95 };
/** Equirectangular stretch at the UK's mid-latitude, so the shape isn't squat. */
const LON_SCALE = Math.cos((54.5 * Math.PI) / 180);
const UNIT = 100;

export const UK_MAP_WIDTH = Math.round(
  (BOUNDS.maxLon - BOUNDS.minLon) * LON_SCALE * UNIT,
);
export const UK_MAP_HEIGHT = Math.round((BOUNDS.maxLat - BOUNDS.minLat) * UNIT);

/** Spacing and radius of the dot grid, in map units. */
export const UK_DOT_STEP = 13;
export const UK_DOT_RADIUS = 3.6;

/** Projects lon/lat to map units (origin top-left). */
export function projectUk(lon: number, lat: number): { x: number; y: number } {
  return {
    x: (lon - BOUNDS.minLon) * LON_SCALE * UNIT,
    y: (BOUNDS.maxLat - lat) * UNIT,
  };
}

function inside(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      hit = !hit;
    }
  }
  return hit;
}

function buildDots(): { x: number; y: number }[] {
  const projected = POLYGONS.map((poly) => poly.map(([lon, lat]) => projectUk(lon, lat)));
  const dots: { x: number; y: number }[] = [];
  for (let y = UK_DOT_STEP / 2; y < UK_MAP_HEIGHT; y += UK_DOT_STEP) {
    for (let x = UK_DOT_STEP / 2; x < UK_MAP_WIDTH; x += UK_DOT_STEP) {
      if (projected.some((poly) => inside(x, y, poly))) dots.push({ x, y });
    }
  }
  return dots;
}

export const UK_DOTS = buildDots();
