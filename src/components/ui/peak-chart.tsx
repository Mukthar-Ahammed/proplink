"use client";

/*
 * Peak Chart, adapted from "Peak Chart" by Louis Studios
 * (https://studios.lou15.com, via 21st.dev) for PropLink.
 *
 * Kept from the original: the card geometry, the monotone curve that never
 * overshoots (so the dot sits on the real peak), the reveal timeline (grid
 * fades in, line draws with a comet head, dot lands with a pulse, headline
 * counts up), the pointer readout and the reduced-motion path.
 *
 * Changed for the design system (ADR-071, "design tokens only"): the
 * hand-painted blue glow field, halo, grain backdrop and every hex colour are
 * gone. The card ground is the site's teal/cyan mesh (`peak-ground` in
 * globals.css) and the canvas reads its colours from the theme tokens at run
 * time (`--color-accent`, `--color-intel`, ...). The period dropdown and the
 * looping mode were dropped (nothing here needs them), and the width can
 * follow the parent.
 */

import * as React from "react";

import { cn } from "@/lib/cn";

/* Card geometry, in card units (the card is 540 units wide, 696 tall). */
const CW = 540;
const CH = 696;
const CR = 44;
const HN = CH / CW;

/* Plot frame and marks. */
const PLOT_X0 = 44;
const PLOT_X1 = 470;
const PLOT_TOP = 170;
const PLOT_BOTTOM = 385;
const LINE_W = 6.5;
const LINE_FALLOFF = 150;
const LINE_POWER = 1.3;
const LINE_CENTER = 12;
const DOT_R = 12;
const GRID_DX = 40.64;
const GRID_DY = 40.07;
const GRID_Y0 = 468.7;
const GRID_ALPHA = 0.28;

/* Timeline (seconds). */
const T_GRID = 0.9;
const T_DRAW0 = 0.25;
const T_DRAW = 2.1;
const T_NUM0 = 1.0;
const T_NUM = 1.7;
const T_ARROW = 2.65;
const T_MORPH = 0.75;

export interface PeakChartProps {
  /** Series drawn as the line, oldest first. Changing it morphs the line. */
  data: number[];
  /** Point labels for the pointer readout, one per data point (e.g. years). */
  labels?: string[];
  /** Headline number. Counts up when the card is revealed. */
  value: number;
  /** Text drawn right before the headline number (e.g. "£"). */
  valuePrefix?: string;
  /** Text drawn right after the headline number. */
  valueSuffix?: string;
  /** Decimal places for the headline number. */
  decimals?: number;
  /** Small label above the headline number. */
  title?: string;
  /** Caption below the headline number. */
  caption?: string;
  /** Status text in the top-left corner. */
  updatedText?: string;
  /** Small trend arrow beside the number: up, down, or hidden. */
  trend?: "up" | "down" | "none";
  /** Card width in pixels. Leave it out to fill the parent up to `maxWidth`. */
  width?: number;
  /** Largest width when following the parent. */
  maxWidth?: number;
  /** Formats the pointer readout value. Defaults to the rounded value. */
  formatValue?: (value: number) => string;
  className?: string;
}

/* ---------- maths ---------- */

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const easeInOut = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const backOut = (x: number) => {
  const t = clamp01(x);
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

/** Any CSS colour → "r,g,b" via a 1×1 canvas, so tokens can be used with alpha. */
function rgbTriplet(color: string): string {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const ctx = c.getContext("2d");
  if (!ctx) return "0,0,0";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `${r},${g},${b}`;
}

type Palette = { line: string; dotTop: string; dotBottom: string; glow: string };

function readPalette(el: HTMLElement): Palette {
  const css = getComputedStyle(el);
  const token = (name: string) => rgbTriplet(css.getPropertyValue(name).trim());
  const accent = token("--color-accent");
  const intel = token("--color-intel");
  return { line: accent, dotTop: accent, dotBottom: intel, glow: intel };
}

const rgba = (rgb: string, a: number) => `rgba(${rgb},${a.toFixed(4)})`;

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Faint grid that fades out upward and toward the sides. */
function buildGrid(px: number, color: string) {
  const w = Math.round(px);
  const h = Math.round(px * HN);
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d")!;
  const s = px / CW;
  ctx.scale(s, s);
  ctx.strokeStyle = rgba(color, 1);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = -6; k <= 6; k++) {
    const x = CW / 2 + GRID_DX * k;
    ctx.moveTo(x, 250);
    ctx.lineTo(x, CH);
  }
  for (let k = -6; k <= 6; k++) {
    const y = GRID_Y0 + GRID_DY * k;
    if (y < 250 || y > CH) continue;
    ctx.moveTo(0, y);
    ctx.lineTo(CW, y);
  }
  ctx.stroke();
  const mw = 64;
  const mh = Math.round(64 * HN);
  const m = makeCanvas(mw, mh);
  const mc = m.getContext("2d")!;
  const img = mc.createImageData(mw, mh);
  for (let j = 0; j < mh; j++) {
    const y = ((j + 0.5) / mh) * CH;
    const my = smooth((y - 350) / 230);
    for (let i = 0; i < mw; i++) {
      const x = ((i + 0.5) / mw) * CW;
      const mx = Math.exp(-0.5 * Math.pow((x - CW / 2) / 110, 2));
      img.data[(j * mw + i) * 4 + 3] = Math.round(255 * GRID_ALPHA * mx * my);
    }
  }
  mc.putImageData(img, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(m, 0, 0, w, h);
  return c;
}

/* ---------- curve ---------- */

type Curve = { ys: Float32Array; peakX: number; lo: number; hi: number; n: number };

/** Monotone cubic (Steffen) through evenly spaced points, sampled per card unit. */
function buildCurve(data: number[]): Curve {
  const vals = data.length >= 2 ? data : data.length === 1 ? [data[0], data[0]] : [0, 0];
  const n = vals.length;
  let lo = Infinity;
  let hi = -Infinity;
  let pk = 0;
  for (let i = 0; i < n; i++) {
    if (vals[i] < lo) lo = vals[i];
    if (vals[i] > hi) {
      hi = vals[i];
      pk = i;
    }
  }
  const span = hi - lo || 1;
  const yv = vals.map((v) =>
    hi === lo
      ? (PLOT_TOP + PLOT_BOTTOM) / 2
      : PLOT_TOP + (1 - (v - lo) / span) * (PLOT_BOTTOM - PLOT_TOP),
  );
  const h = (PLOT_X1 - PLOT_X0) / (n - 1);
  const sl: number[] = [];
  for (let i = 0; i < n - 1; i++) sl.push((yv[i + 1] - yv[i]) / h);
  const m: number[] = [sl[0]];
  for (let i = 1; i < n - 1; i++) {
    const a = sl[i - 1];
    const b = sl[i];
    m.push(
      (Math.sign(a) + Math.sign(b)) *
        Math.min(Math.abs(a), Math.abs(b), 0.25 * Math.abs(a + b)),
    );
  }
  m.push(sl[n - 2]);
  const ys = new Float32Array(CW + 1);
  for (let x = 0; x <= CW; x++) {
    let y: number;
    if (x <= PLOT_X0) y = yv[0];
    else if (x >= PLOT_X1) y = yv[n - 1];
    else {
      const t = (x - PLOT_X0) / h;
      const i = Math.min(n - 2, Math.floor(t));
      const f = t - i;
      const f2 = f * f;
      const f3 = f2 * f;
      y =
        (2 * f3 - 3 * f2 + 1) * yv[i] +
        (f3 - 2 * f2 + f) * h * m[i] +
        (-2 * f3 + 3 * f2) * yv[i + 1] +
        (f3 - f2) * h * m[i + 1];
    }
    ys[x] = y;
  }
  return { ys, peakX: PLOT_X0 + pk * h, lo, hi, n };
}
function curveY(ys: Float32Array, x: number) {
  const xc = Math.max(0, Math.min(CW, x));
  const i = Math.min(CW - 1, Math.floor(xc));
  const f = xc - i;
  return ys[i] * (1 - f) + ys[i + 1] * f;
}
const lineAlpha = (d: number) =>
  0.35 + 0.65 * Math.exp(-Math.pow(Math.abs(d) / LINE_FALLOFF, LINE_POWER));

/* ---------- timeline ---------- */

type Frame = {
  grid: number;
  draw: number;
  dotS: number;
  dotA: number;
  num: number;
  numA: number;
  numY: number;
  arrow: number;
  arrowA: number;
};

function inverseEase(target: number) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (easeInOut(m) < target) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

function frameAt(t: number): Frame {
  return {
    grid: smooth(t / T_GRID),
    draw: easeInOut((t - T_DRAW0) / T_DRAW),
    dotS: backOut((t - T_DRAW0) / 0.4),
    dotA: smooth((t - T_DRAW0) / 0.2),
    num: easeOut((t - T_NUM0) / T_NUM),
    numA: smooth((t - T_NUM0) / 0.45),
    numY: 1 - easeOut((t - T_NUM0) / 0.7),
    arrow: backOut((t - T_ARROW) / 0.45),
    arrowA: smooth((t - T_ARROW) / 0.18),
  };
}
const T_DONE = T_ARROW + 1.2;

/** The parent's width, for a card that follows its column. */
function useParentWidth(ref: React.RefObject<HTMLElement | null>, enabled: boolean) {
  const [w, setW] = React.useState(0);
  React.useEffect(() => {
    const el = ref.current?.parentElement;
    if (!enabled || !el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, enabled]);
  return w;
}

/* ---------- component ---------- */

export function PeakChart({
  data,
  labels,
  value,
  valuePrefix = "",
  valueSuffix = "",
  decimals = 0,
  title = "",
  caption = "",
  updatedText = "",
  trend = "none",
  width: fixedWidth,
  maxWidth = 320,
  formatValue,
  className,
}: PeakChartProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const parentWidth = useParentWidth(rootRef, fixedWidth === undefined);
  const width = fixedWidth ?? Math.min(maxWidth, parentWidth || maxWidth);
  const u = width / CW;

  const cardRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const digitsRef = React.useRef<HTMLSpanElement>(null);
  const numRef = React.useRef<HTMLDivElement>(null);
  const arrowRef = React.useRef<SVGSVGElement>(null);
  const readRef = React.useRef<HTMLDivElement>(null);
  const readValRef = React.useRef<HTMLSpanElement>(null);
  const readLabRef = React.useRef<HTMLSpanElement>(null);

  const live = React.useRef({
    curve: buildCurve(data),
    from: null as Curve | null,
    morph: 1,
    labels,
    hover: null as number | null,
    hoverX: 0,
    hoverMix: 0,
    fmt: formatValue,
    decimals,
    value,
    kick: () => {},
  });
  React.useEffect(() => {
    const L = live.current;
    L.labels = labels;
    L.fmt = formatValue;
    L.decimals = decimals;
    L.value = value;
  });

  // data changes morph the line
  const key = data.join(",");
  const firstData = React.useRef(true);
  React.useEffect(() => {
    if (firstData.current) {
      firstData.current = false;
      return;
    }
    const L = live.current;
    L.from = L.curve;
    L.curve = buildCurve(key ? key.split(",").map(Number) : []);
    L.morph = 0;
    L.kick();
  }, [key]);

  // the render loop
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const card = cardRef.current;
    if (!canvas || !card || width <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const L = live.current;
    const palette = readPalette(card);
    const reduce =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.ceil(CW * u * dpr);
    canvas.height = Math.ceil(CH * u * dpr);
    canvas.style.width = `${canvas.width / dpr}px`;
    canvas.style.height = `${canvas.height / dpr}px`;
    const grid = buildGrid(width * dpr, palette.line);
    const tLand = (frac: number) => T_DRAW0 + T_DRAW * inverseEase(frac);

    let clock = reduce ? T_DONE : 0;
    let started = reduce;
    let visible = true;
    let raf = 0;
    let last = performance.now();

    const roundRect = () => {
      ctx.beginPath();
      ctx.moveTo(CR, 0);
      ctx.arcTo(CW, 0, CW, CH, CR);
      ctx.arcTo(CW, CH, 0, CH, CR);
      ctx.arcTo(0, CH, 0, 0, CR);
      ctx.arcTo(0, 0, CW, 0, CR);
      ctx.closePath();
    };

    const draw = (dt: number) => {
      if (started && !reduce) clock += dt;
      const t = clock;
      const F = frameAt(started ? t : 0);

      if (L.morph < 1) L.morph = reduce ? 1 : Math.min(1, L.morph + dt / T_MORPH);
      const mk = easeInOut(L.morph);
      const C = L.curve;
      const morphing = L.from !== null && L.morph < 1;
      const ys = morphing ? new Float32Array(CW + 1) : C.ys;
      if (morphing && L.from)
        for (let x = 0; x <= CW; x++)
          ys[x] = L.from.ys[x] + (C.ys[x] - L.from.ys[x]) * mk;
      const lerp = (a: number, b: number) => (morphing ? a + (b - a) * mk : b);
      const peakX = lerp(L.from?.peakX ?? C.peakX, C.peakX);
      const lo = lerp(L.from?.lo ?? C.lo, C.lo);
      const hi = lerp(L.from?.hi ?? C.hi, C.hi);

      const landed = t >= tLand(peakX / CW) && F.dotA > 0.99;
      const wantHover = L.hover !== null && (landed || reduce);
      if (L.hover !== null)
        L.hoverX = reduce
          ? L.hover
          : L.hoverX + (L.hover - L.hoverX) * (1 - Math.exp(-dt * 14));
      L.hoverMix = reduce
        ? wantHover
          ? 1
          : 0
        : L.hoverMix + ((wantHover ? 1 : 0) - L.hoverMix) * (1 - Math.exp(-dt * 10));

      // headline number
      const shown = L.value * F.num;
      if (digitsRef.current) {
        const txt = shown.toLocaleString("en-GB", {
          minimumFractionDigits: L.decimals,
          maximumFractionDigits: L.decimals,
        });
        if (digitsRef.current.textContent !== txt) digitsRef.current.textContent = txt;
      }
      if (numRef.current) {
        numRef.current.style.opacity = String(F.numA);
        numRef.current.style.transform = `translateY(${(F.numY * 5 * u).toFixed(2)}px)`;
        const blur = Math.abs(F.numY) * 6 * u;
        numRef.current.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "";
      }
      if (arrowRef.current) {
        arrowRef.current.style.opacity = String(F.arrowA);
        arrowRef.current.style.transform = `scale(${Math.max(0, F.arrow).toFixed(3)})`;
      }

      // canvas
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const s = dpr * u;
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.save();
      roundRect();
      ctx.clip();
      if (F.grid > 0.001) {
        ctx.globalAlpha = F.grid;
        ctx.drawImage(grid, 0, 0, CW, CH);
        ctx.globalAlpha = 1;
      }

      // area under the drawn line, then the line
      const x1 = F.draw * CW;
      if (x1 > 0.5) {
        const area = ctx.createLinearGradient(0, PLOT_TOP, 0, PLOT_BOTTOM + 60);
        area.addColorStop(0, rgba(palette.line, 0.16));
        area.addColorStop(1, rgba(palette.line, 0));
        ctx.fillStyle = area;
        ctx.beginPath();
        ctx.moveTo(0, PLOT_BOTTOM + 60);
        for (let x = 0; x < x1; x++) ctx.lineTo(x, ys[x]);
        ctx.lineTo(x1, curveY(ys, x1));
        ctx.lineTo(x1, PLOT_BOTTOM + 60);
        ctx.closePath();
        ctx.fill();

        const g = ctx.createLinearGradient(0, 0, CW, 0);
        const head = 0.95 * (1 - smooth((F.draw - 0.8) / 0.2));
        for (let i = 0; i <= 54; i++) {
          const x = (i / 54) * CW;
          let a = lineAlpha(x - peakX - LINE_CENTER);
          if (head > 0.001 && x <= x1 + 10)
            a = Math.max(a, head * Math.exp(-Math.max(0, x1 - x) / 70));
          g.addColorStop(i / 54, rgba(palette.line, a));
        }
        ctx.strokeStyle = g;
        ctx.lineWidth = LINE_W;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(0, ys[0]);
        for (let x = 1; x < x1; x++) ctx.lineTo(x, ys[x]);
        ctx.lineTo(x1, curveY(ys, x1));
        ctx.stroke();
      }

      // dot: rides the drawing tip, rests on the peak, follows the pointer
      if (F.dotA > 0.001) {
        const baseX = Math.min(x1, peakX);
        const dx = baseX + (L.hoverX - baseX) * L.hoverMix;
        const dy = curveY(ys, dx);
        const sinceLand = t - tLand(peakX / CW);
        const pulse = sinceLand > 0 && sinceLand < 1.1 && !reduce ? sinceLand / 1.1 : -1;
        ctx.globalAlpha = F.dotA;
        ctx.translate(dx, dy);
        ctx.scale(F.dotS, F.dotS);
        const boost = pulse >= 0 ? Math.sin(Math.PI * Math.min(1, pulse * 1.6)) : 0;
        const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
        hg.addColorStop(0, rgba(palette.glow, Math.min(1, 0.4 * (1 + 0.9 * boost))));
        hg.addColorStop(0.55, rgba(palette.glow, 0.25));
        hg.addColorStop(1, rgba(palette.glow, 0));
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(0, 0, 30, 0, Math.PI * 2);
        ctx.fill();
        if (pulse >= 0) {
          const r = DOT_R + 26 * easeOut(pulse);
          ctx.strokeStyle = rgba(palette.glow, 0.6 * (1 - pulse) * (1 - pulse));
          ctx.lineWidth = 2.2 * (1 - pulse) + 0.6;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        const bg = ctx.createLinearGradient(0, -DOT_R, 0, DOT_R);
        bg.addColorStop(0, rgba(palette.dotTop, 1));
        bg.addColorStop(1, rgba(palette.dotBottom, 1));
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(0, 0, DOT_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.stroke();
        ctx.setTransform(s, 0, 0, s, 0, 0);
        ctx.globalAlpha = 1;

        const rd = readRef.current;
        if (rd) {
          rd.style.opacity = L.hoverMix.toFixed(3);
          rd.style.transform = `translate(${(dx * u).toFixed(1)}px, ${((dy - 24) * u).toFixed(1)}px) translate(-50%, -100%) scale(${(0.92 + 0.08 * L.hoverMix).toFixed(3)})`;
          if (L.hoverMix > 0.01) {
            const n = C.n;
            const idx = Math.round(
              ((Math.max(PLOT_X0, Math.min(PLOT_X1, dx)) - PLOT_X0) /
                (PLOT_X1 - PLOT_X0)) *
                (n - 1),
            );
            // Read the point's own value near a data point, the curve between them.
            const v =
              lo +
              ((PLOT_BOTTOM - curveY(ys, dx)) / (PLOT_BOTTOM - PLOT_TOP)) * (hi - lo);
            const txt = L.fmt ? L.fmt(v) : Math.round(v).toLocaleString("en-GB");
            if (readValRef.current && readValRef.current.textContent !== txt)
              readValRef.current.textContent = txt;
            const lab = L.labels?.[idx] ?? "";
            if (readLabRef.current) {
              if (readLabRef.current.textContent !== lab)
                readLabRef.current.textContent = lab;
              readLabRef.current.style.display = lab ? "" : "none";
            }
          }
        }
      }
      ctx.restore();
    };

    const busy = () => {
      if (!started) return false;
      const settling =
        L.morph < 1 || Math.abs(L.hoverMix - (L.hover !== null ? 1 : 0)) > 0.001;
      return reduce ? settling : clock < T_DONE || settling || L.hover !== null;
    };
    const tick = () => {
      raf = 0;
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      draw(dt);
      if (visible && !document.hidden && busy()) raf = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (!raf && visible && !document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    L.kick = kick;
    draw(0);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) {
        started = true;
        kick();
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    io.observe(card);
    const onVis = () => {
      if (!document.hidden) kick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      if (raf) cancelAnimationFrame(raf);
      L.kick = () => {};
    };
  }, [width, u]);

  const onMove = (e: React.PointerEvent) => {
    const r = cardRef.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * CW;
    const L = live.current;
    const nx = Math.max(PLOT_X0, Math.min(PLOT_X1, x));
    if (L.hover === null && L.hoverMix < 0.02) L.hoverX = nx;
    L.hover = nx;
    L.kick();
  };
  const onLeave = () => {
    live.current.hover = null;
    live.current.kick();
  };

  const px = (n: number) => `${(n * u).toFixed(3)}px`;
  const finalDigits = value.toLocaleString("en-GB", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <div ref={rootRef} className={cn("inline-block", className)}>
      <div
        ref={cardRef}
        data-peak-chart=""
        className="peak-ground relative flex-none overflow-hidden border border-line text-primary shadow-sm select-none"
        style={{ width, height: width * HN, borderRadius: px(CR) }}
      >
        <canvas
          ref={canvasRef}
          aria-hidden
          className="pointer-events-none absolute top-0 left-0"
        />
        {/* chart pointer surface */}
        <div
          aria-hidden
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={onLeave}
          onPointerCancel={onLeave}
          className="absolute left-0 w-full cursor-crosshair"
          style={{ top: px(110), height: px(320), touchAction: "pan-y" }}
        />
        {updatedText ? (
          <p
            className="absolute m-0 rounded-full bg-white/70 font-medium whitespace-nowrap text-muted backdrop-blur-sm"
            style={{
              left: px(40),
              top: px(40),
              fontSize: px(19),
              padding: `${px(7)} ${px(16)}`,
            }}
          >
            {updatedText}
          </p>
        ) : null}

        {/* pointer readout */}
        <div
          ref={readRef}
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 z-[2] flex items-baseline rounded-lg border border-line bg-white/90 whitespace-nowrap shadow-sm backdrop-blur"
          style={{ opacity: 0, gap: px(8), padding: `${px(8)} ${px(13)}` }}
        >
          <span
            ref={readValRef}
            className="font-semibold text-primary"
            style={{ fontSize: px(20) }}
          />
          <span ref={readLabRef} className="text-muted" style={{ fontSize: px(16) }} />
        </div>

        {title ? (
          <p
            className="absolute right-0 left-0 m-0 text-center font-medium whitespace-nowrap text-muted"
            style={{ top: px(448), fontSize: px(21) }}
          >
            {title}
          </p>
        ) : null}
        <div
          ref={numRef}
          className="absolute right-0 left-0 flex justify-center"
          style={{ top: px(482), opacity: 0 }}
        >
          <div
            className="relative leading-none font-semibold tracking-tight whitespace-nowrap"
            style={{ fontSize: px(66) }}
          >
            {valuePrefix}
            <span className="relative inline-block tabular-nums">
              <span className="invisible">{finalDigits}</span>
              <span ref={digitsRef} className="absolute top-0 right-0">
                {finalDigits}
              </span>
            </span>
            {valueSuffix}
            {trend !== "none" && (
              <svg
                ref={arrowRef}
                viewBox="0 0 8 8"
                aria-hidden
                className={cn(
                  "absolute left-full overflow-visible",
                  trend === "down" ? "text-danger" : "text-success",
                )}
                style={{
                  marginLeft: px(8),
                  top: px(8),
                  width: px(14),
                  height: px(14),
                  transformOrigin: "0% 100%",
                  opacity: 0,
                  rotate: trend === "down" ? "90deg" : undefined,
                }}
              >
                <path
                  d="M0.6 7.4 L7.2 0.8 M2 0.6 L7.4 0.6 L7.4 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
          </div>
        </div>
        {caption ? (
          <p
            className="absolute m-0 text-center text-muted"
            style={{
              left: px(40),
              right: px(40),
              top: px(580),
              fontSize: px(17),
              lineHeight: 1.35,
            }}
          >
            {caption}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default PeakChart;
