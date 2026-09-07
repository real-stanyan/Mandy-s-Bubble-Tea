"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { wavePath } from "@/lib/motion/wave";
import {
  LOOPS,
  matrixAt,
  matrixString,
  rotateAbout,
  translate,
  waveOffset,
  type Frame,
  type LoopName,
  type Matrix,
} from "@/lib/motion/category-art";
import { HERO_LOOPS, type HeroLoopName } from "@/lib/motion/checkout-hero";

// The drawing kit the illustrations share (CategoryArt, CheckoutHero): the
// Mini Cup's cup, the moving-part plumbing, and the palette rules. Port of
// the App's components/brand/art-kit.tsx — same drawings, same numbers; only
// the plumbing differs, because there is no Reanimated here.
//
// A moving part is a <g> whose `transform` matrix and `opacity` are written
// straight onto the DOM node from ONE shared requestAnimationFrame ticker,
// never through React state — nine illustrations re-rendering at 60fps would
// cost more than the whole page. The frame maths is the same pure phase→frame
// vocabulary the App uses (lib/motion). The caller decides `live`; Reduce
// Motion and off-screen both hold frame zero, which is also what the server
// renders, so there is no first-paint jump.

export const INK = "#2A1E14";
export const BODY = "M12 18h36l-4 56a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4z";
export const AMP = 0.8;
export const WL = 12;

/* ------------------------------- the ticker ------------------------------- */

type Tick = (t: number) => void;
const subscribers = new Set<Tick>();
let rafId = 0;

function pump(t: number) {
  rafId = requestAnimationFrame(pump);
  for (const fn of subscribers) fn(t);
}

/** Join the page's single rAF loop; the last leaver turns it off. */
function subscribe(fn: Tick): () => void {
  subscribers.add(fn);
  if (!rafId) rafId = requestAnimationFrame(pump);
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };
}

/** Phase 0→1, repeating every `period` ms, offset by `delay`. Read off the
 *  document clock, so equal periods stay in lockstep and a part that pauses
 *  off-screen comes back in step with the rest of its drawing. */
function phaseAt(t: number, period: number, delay: number): number {
  const p = ((t - delay) / period) % 1;
  return p < 0 ? p + 1 : p;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/** True while the element is anywhere near the viewport — a drawing scrolled
 *  past stops costing anything. Environments without IntersectionObserver
 *  simply stay live. */
export function useInView<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  // With no observer there is nothing to wait for, so start live.
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView];
}

/** A unique, css-safe id prefix for gradients and clips — a page draws many cups. */
export function useUid(): string {
  return useId().replace(/[^a-zA-Z0-9]/g, "");
}

/* ---------------------------- the moving part ---------------------------- */

type Drive = (p: number) => { m: Matrix; opacity: number };

/** A <g> driven by a matrix + opacity function of phase. */
function AnimG({
  drive,
  period,
  delay = 0,
  live,
  children,
}: {
  drive: Drive;
  period: number;
  delay?: number;
  live: boolean;
  children: ReactNode;
}) {
  const ref = useRef<SVGGElement | null>(null);
  const reduced = useReducedMotion();
  const on = live && !reduced;
  // The function is re-made every render (it closes over props); the
  // subscription must not be, or every parent render would restart the loop.
  const driveRef = useRef(drive);
  useEffect(() => {
    driveRef.current = drive;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    return subscribe((t) => {
      const f = driveRef.current(phaseAt(t, period, delay));
      el.setAttribute("transform", matrixString(f.m));
      el.setAttribute("opacity", String(Math.round(f.opacity * 1000) / 1000));
    });
  }, [on, period, delay]);

  const rest = drive(0);
  return (
    <g ref={ref} transform={matrixString(rest.m)} opacity={rest.opacity}>
      {children}
    </g>
  );
}

export type FrameFn = (p: number) => Frame;
const TABLE = { ...LOOPS, ...HERO_LOOPS } as const;
export type AnyLoopName = LoopName | HeroLoopName;

type MotionProps = {
  /** Where the shape's origin sits; the shape is drawn around (0, 0). */
  x: number;
  y: number;
  /** A named loop from lib/motion, or a frame function of your own. */
  loop?: AnyLoopName;
  frame?: FrameFn;
  period: number;
  delay?: number;
  /** Resting rotation in degrees; the loop's rotation is added to it. */
  rot?: number;
  live: boolean;
  children: ReactNode;
};

/** One moving part: a loop's frame, applied as a matrix about the shape's own origin. */
export function Motion({
  x,
  y,
  loop,
  frame,
  period,
  delay = 0,
  rot = 0,
  live,
  children,
}: MotionProps) {
  const fn: FrameFn = frame ?? TABLE[loop ?? "rise"];
  return (
    <AnimG
      period={period}
      delay={delay}
      live={live}
      drive={(p) => {
        const f = fn(p);
        return {
          m: matrixAt(x, y, rot + f.rot, f.scale, f.tx, f.ty, f.sy ?? 1),
          opacity: f.opacity,
        };
      }}
    >
      {children}
    </AnimG>
  );
}

/** A <g> turned by a matrix of your own — the cheese cup's tilt, a swirl. */
export function MatrixMotion({
  matrix,
  period,
  delay = 0,
  live,
  children,
}: {
  matrix: (p: number) => Matrix;
  period: number;
  delay?: number;
  live: boolean;
  children: ReactNode;
}) {
  return (
    <AnimG
      period={period}
      delay={delay}
      live={live}
      drive={(p) => ({ m: matrix(p), opacity: 1 })}
    >
      {children}
    </AnimG>
  );
}

/** The Mini Cup's surface: a lighter ribbon whose wavy edge is the surface, scrolling one wavelength every 2.2 s. */
export function Surface({
  d,
  color,
  live,
}: {
  d: string;
  color: string;
  live: boolean;
}) {
  return (
    <MatrixMotion period={2200} live={live} matrix={(p) => translate(waveOffset(p, WL), 0)}>
      <path d={d} fill={color} />
    </MatrixMotion>
  );
}

/** Two colours turning inside the cup (Special Mix). */
export function Swirl({
  cx,
  cy,
  live,
  children,
}: {
  cx: number;
  cy: number;
  live: boolean;
  children: ReactNode;
}) {
  return (
    <MatrixMotion period={9000} live={live} matrix={(p) => rotateAbout(360 * p, cx, cy)}>
      {children}
    </MatrixMotion>
  );
}

/* --------------------------------- colour --------------------------------- */

export function mix(a: string, b: string, t: number): string {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const c = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}
export const light = (hex: string) => mix(hex, "#FFFFFF", 0.38);

/* ----------------------------------- the cup ----------------------------------- */

export type CupProps = {
  x: number;
  y: number;
  s?: number;
  liq: string;
  liqTop?: number;
  pearls?: boolean;
  pearlsRise?: boolean;
  ice?: boolean;
  bubbles?: boolean;
  marble?: [string, string, string];
  slush?: boolean;
  lid?: boolean;
  straw?: boolean;
  strawWide?: boolean;
  steam?: boolean;
  wave?: boolean;
  live: boolean;
};

export const PEARLS: [number, number][] = [
  [20, 71],
  [27, 74],
  [34, 72],
  [41, 74],
  [23, 65],
  [31, 66],
  [38, 65],
];
const BUBBLES: [number, number, number, number][] = [
  [20, 70, 1.6, 0],
  [30, 74, 1.2, 1100],
  [39, 68, 1.8, 2200],
  [26, 60, 1.1, 600],
];

/** The Mini Cup's cup on a 60×90 stage: near-straight sides, flat lid, straw at eight degrees. */
export function Cup({
  x,
  y,
  s = 1,
  liq,
  liqTop = 30,
  pearls,
  pearlsRise,
  ice,
  bubbles,
  marble,
  slush,
  lid = true,
  straw = true,
  strawWide,
  steam,
  wave = true,
  live,
}: CupProps) {
  const uid = useUid();
  const surface = light(marble ? marble[1] : liq);
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <defs>
        <clipPath id={`${uid}c`}>
          <path d={BODY} />
        </clipPath>
        <linearGradient id={`${uid}l`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={light(liq)} />
          <stop offset="0.55" stopColor={liq} />
          <stop offset="1" stopColor={liq} />
        </linearGradient>
      </defs>
      <path d={BODY} fill="#FDFAF4" />
      <g clipPath={`url(#${uid}c)`}>
        {marble ? (
          <>
            <rect x={0} y={liqTop + AMP} width={60} height={60} fill={marble[0]} />
            <Swirl cx={30} cy={liqTop + 28} live={live}>
              <ellipse cx={18} cy={liqTop + 16} rx={16} ry={9} fill={marble[1]} />
              <ellipse cx={42} cy={liqTop + 40} rx={18} ry={9} fill={marble[1]} />
              <ellipse cx={44} cy={liqTop + 12} rx={8} ry={5} fill={marble[2]} opacity={0.8} />
            </Swirl>
          </>
        ) : (
          <rect x={0} y={liqTop + AMP} width={60} height={60} fill={`url(#${uid}l)`} />
        )}
        {wave && !slush ? (
          <Surface
            d={wavePath({
              x0: 10,
              width: 40,
              top: liqTop,
              amplitude: AMP,
              wavelength: WL,
              depth: 4.5,
            })}
            color={surface}
            live={live}
          />
        ) : null}
        {ice ? (
          <g fill="#fff" opacity={0.55}>
            <rect
              x={18}
              y={liqTop + 6}
              width={9}
              height={9}
              rx={2}
              transform={`rotate(-12 22 ${liqTop + 10})`}
            />
            <rect
              x={33}
              y={liqTop + 10}
              width={9}
              height={9}
              rx={2}
              transform={`rotate(14 37 ${liqTop + 14})`}
            />
            <rect
              x={24}
              y={liqTop + 18}
              width={9}
              height={9}
              rx={2}
              transform={`rotate(-6 28 ${liqTop + 22})`}
            />
          </g>
        ) : null}
        {bubbles
          ? BUBBLES.map(([bx, by, r, dl], i) => (
              <Motion key={i} x={bx} y={by} loop="bubble" period={3400} delay={dl} live={live}>
                <circle r={r} fill="#fff" opacity={0.8} />
              </Motion>
            ))
          : null}
        {pearls
          ? PEARLS.map(([px, py], i) =>
              pearlsRise ? (
                <Motion
                  key={i}
                  x={px}
                  y={py}
                  loop="rise"
                  period={3200 + (i % 3) * 500}
                  delay={i * 450}
                  live={live}
                >
                  <circle r={3.4} fill="#3B2317" />
                </Motion>
              ) : (
                <circle key={i} cx={px} cy={py} r={3.4} fill="#3B2317" />
              ),
            )
          : null}
      </g>
      <path d={BODY} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      {lid ? <rect x={9} y={14} width={42} height={5} rx={2} fill={INK} /> : null}
      {slush ? (
        <>
          {/* No lid: the slush is heaped above the rim, breathing, with frost and a passing cold sheen. */}
          <Motion x={30} y={19} loop="breathe" period={5000} live={live}>
            <path
              d="M-20 0C-19-11-10-17-1-12C5-19 19-16 20 0Z"
              fill={liq}
              stroke={INK}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          </Motion>
          <path
            d="M15 15c3-5 8-7 13-6"
            fill="none"
            stroke="#fff"
            strokeWidth={2.4}
            strokeLinecap="round"
            opacity={0.8}
          />
          <Motion x={31} y={10.5} loop="sweep" period={3600} live={live}>
            <path
              d="M-13 2.5c6-6 16-7 26-3"
              fill="none"
              stroke="#fff"
              strokeWidth={3}
              strokeLinecap="round"
              opacity={0.7}
            />
          </Motion>
          <circle cx={40} cy={8} r={1.4} fill="#fff" />
          <circle cx={22} cy={6} r={1.1} fill="#fff" />
        </>
      ) : null}
      {straw ? (
        strawWide ? (
          <rect x={31} y={-4} width={7} height={22} rx={2.5} fill={INK} transform="rotate(8 35 8)" />
        ) : (
          <rect x={33} y={0} width={4.5} height={20} rx={1.6} fill={INK} transform="rotate(8 35 10)" />
        )
      ) : null}
      {steam
        ? (
            [
              [22, 0],
              [31, 900],
              [40, 1800],
            ] as [number, number][]
          ).map(([sx, dl]) => (
            <Motion key={sx} x={sx} y={10} loop="wisp" period={3200} delay={dl} live={live}>
              <path
                d="M0 0c-4-5 4-8 0-13"
                fill="none"
                stroke={INK}
                strokeWidth={2}
                strokeLinecap="round"
                opacity={0.5}
              />
            </Motion>
          ))
        : null}
    </g>
  );
}
