"use client";

import { useMemo } from "react";
import { wavePath } from "@/lib/motion/wave";
import type { CupVisual } from "@/lib/menu/cup-visual";
import { flapFor, packFor } from "@/lib/motion/checkout-hero";
import { HERO_MAX_CUPS } from "@/lib/menu/order-cups";
import {
  AMP,
  BODY,
  INK,
  Motion,
  PEARLS,
  Surface,
  WL,
  light,
  useInView,
  useUid,
} from "@/components/brand/art-kit";

// The checkout's picture of what happens next, drawn and alive, with the
// customer's own order in it: for pickup, their cups made and waiting on the
// counter (lucky cats beckoning, the bell dinging, steam off the urns); for
// delivery, their cups going one by one into the insulated bag on the doorstep
// while the doorbell chimes. Each cup is drawn from the same cup-visual the
// item sheet uses — liquid colour, ice, foam — always in the Mini Cup's cup
// with its lid, straw and one uniform bed of pearls (see OrderCup).
//
// Port of the App's components/brand/CheckoutHero.tsx; same drawing, same
// timings. Reduce Motion (and off screen) holds frame zero: bell idle, paws
// down, lid closed.

type Props = {
  kind: "pickup" | "delivery";
  /** One per cup in the order, in order; only the first HERO_MAX_CUPS are drawn. */
  cups: CupVisual[];
  /** Cups beyond the drawn ones — shown as "+N" on the pickup ticket. */
  extra?: number;
  className?: string;
};

export function CheckoutHero({ kind, cups, extra = 0, className }: Props) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const shown = cups.slice(0, HERO_MAX_CUPS);
  const one = shown.length === 1;
  return (
    <div
      ref={ref}
      // The scene's own daylight, the same in both themes — hence the literal
      // grounds rather than a theme token (the App's PIN rule).
      className={
        "relative aspect-[1.85] w-full overflow-hidden " +
        (kind === "pickup" ? "bg-[#F5E6D3] " : "bg-[#EAF0E4] ") +
        (className ?? "")
      }
      role="img"
      aria-label={
        kind === "pickup"
          ? `Your ${one ? "drink" : "drinks"} ready on the counter for pickup`
          : `Your ${one ? "drink" : "drinks"} packed for delivery to your door`
      }
    >
      <svg
        className="pointer-events-none block"
        width="100%"
        height="100%"
        viewBox="0 0 360 200"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        {kind === "pickup" ? (
          <Pickup cups={shown} live={inView} />
        ) : (
          <Delivery cups={shown} live={inView} />
        )}
      </svg>
      {kind === "pickup" && extra > 0 ? (
        <span
          aria-hidden="true"
          className="absolute left-[69%] top-[48%] rounded-full bg-[#2A1E14] px-1.5 py-0.5 text-[11px] font-bold leading-tight tabular-nums text-[#FFF3DE]"
        >
          {`+${extra}`}
        </span>
      ) : null}
    </div>
  );
}

/* ----------------------------- a cup from the order ----------------------------- */

const LIQ_TOP = 30;

/** The bed every cup gets: the Mini Cup's seven pearls, drifting up and
 *  settling back on their own stagger. Same in every cup on purpose — see the
 *  note on OrderCup. */
function Pearls({ live }: { live: boolean }) {
  return (
    <>
      {PEARLS.map(([x, y], i) => (
        <Motion
          key={i}
          x={x}
          y={y}
          loop="rise"
          period={3200 + (i % 3) * 500}
          delay={i * 450}
          live={live}
        >
          <circle r={3.4} fill="#3B2317" />
        </Motion>
      ))}
    </>
  );
}

/** The customer's cup: cup-visual in, the Mini Cup's cup out — lid and straw on
 *  every one, and the same bed of pearls in every one.
 *
 *  The cups used to draw the customer's actual toppings, shape by shape. At the
 *  size they are on the counter — 43px tall, three or four in a row — a bed of
 *  cubes next to a bed of pearls next to a scatter of crumbs read as debris,
 *  not as a drink. What the scene is for is recognition, and the ticket beside
 *  it is what carries the build. So the pieces are uniform and the liquid is
 *  not: the colour, the foam, the ice are still the customer's own. */
export function OrderCup({
  v,
  x,
  y,
  s,
  live,
}: {
  v: CupVisual;
  x: number;
  y: number;
  s: number;
  live: boolean;
}) {
  const uid = useUid();
  const iceCount = v.ice === "extra" || v.ice === "normal" ? 3 : v.ice === "less" ? 2 : 0;
  const liquidOpacity = Math.min(1, 0.74 + Math.min(v.sugar, 1) * 0.26);
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <defs>
        <clipPath id={`${uid}c`}>
          <path d={BODY} />
        </clipPath>
        <linearGradient id={`${uid}l`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={v.liquidLight} />
          <stop offset="0.55" stopColor={v.liquid} />
          <stop offset="1" stopColor={v.liquid} />
        </linearGradient>
      </defs>
      <path d={BODY} fill="#FDFAF4" />
      <g clipPath={`url(#${uid}c)`}>
        <rect
          x={0}
          y={LIQ_TOP + AMP}
          width={60}
          height={60}
          fill={`url(#${uid}l)`}
          opacity={liquidOpacity}
        />
        {!v.hasFoam ? (
          <Surface
            d={wavePath({
              x0: 10,
              width: 40,
              top: LIQ_TOP,
              amplitude: AMP,
              wavelength: WL,
              depth: 4.5,
            })}
            color={light(v.liquid)}
            live={live}
          />
        ) : null}
        {iceCount > 0 ? (
          <g fill="#fff" opacity={0.55}>
            <rect x={18} y={LIQ_TOP + 8} width={9} height={9} rx={2} transform={`rotate(-12 22 ${LIQ_TOP + 12})`} />
            <rect x={33} y={LIQ_TOP + 12} width={9} height={9} rx={2} transform={`rotate(14 37 ${LIQ_TOP + 16})`} />
            {iceCount > 2 ? (
              <rect x={24} y={LIQ_TOP + 20} width={9} height={9} rx={2} transform={`rotate(-6 28 ${LIQ_TOP + 24})`} />
            ) : null}
          </g>
        ) : null}
        <Pearls live={live} />
        {v.hasFoam ? (
          <>
            <path
              d={`M8 ${LIQ_TOP + 4} C10 ${LIQ_TOP - 5} 22 ${LIQ_TOP - 7} 30 ${LIQ_TOP - 1} C38 ${LIQ_TOP - 8} 50 ${LIQ_TOP - 5} 52 ${LIQ_TOP + 4} Z`}
              fill="#FBF1DF"
            />
            <rect x={0} y={LIQ_TOP + 3} width={60} height={9} fill="#FBF1DF" />
          </>
        ) : null}
        {v.hasBrulee ? <rect x={10} y={LIQ_TOP + 1} width={40} height={5} fill="#C98A3C" /> : null}
      </g>
      <path d={BODY} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <rect x={9} y={14} width={42} height={5} rx={2} fill={INK} />
      <rect x={33} y={0} width={4.5} height={20} rx={1.6} fill={INK} transform="rotate(8 35 10)" />
    </g>
  );
}

/* ----------------------------------- pickup ----------------------------------- */

function Cat({
  x,
  fill,
  feat,
  coin,
  delay,
  live,
}: {
  x: number;
  fill: string;
  feat: string;
  coin?: boolean;
  delay: number;
  live: boolean;
}) {
  return (
    <g transform={`translate(${x} 66)`}>
      <path d="M-12 0C-13-14-8-20 0-20 8-20 13-14 12 0Z" fill={fill} stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
      <ellipse cx={-6} cy={-2} rx={4} ry={2.4} fill={fill} stroke={INK} strokeWidth={1.4} />
      {coin ? (
        <>
          <ellipse cx={1} cy={-6} rx={6} ry={4} fill="#F2B64A" stroke={INK} strokeWidth={1.4} />
          <path d="M-2-6h6" stroke={INK} strokeWidth={1.2} strokeLinecap="round" />
        </>
      ) : null}
      <path d="M-8-16q8 4 16 0" fill="none" stroke="#E2645F" strokeWidth={2.6} strokeLinecap="round" />
      <circle cy={-13} r={2.2} fill="#F2B64A" stroke={INK} strokeWidth={1} />
      <path
        d="M-9.5-29Q-11-37-5.5-36.5Q-2.5-34-1.5-31zM9.5-29Q11-37 5.5-36.5Q2.5-34 1.5-31z"
        fill={fill}
        stroke={INK}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <circle cy={-24} r={10.5} fill={fill} stroke={INK} strokeWidth={1.8} />
      <path d="M-6-25q2.5-3 5 0M1-25q2.5-3 5 0" fill="none" stroke={feat} strokeWidth={1.5} strokeLinecap="round" />
      <path d="M-1-21h2" stroke={feat} strokeWidth={1.6} strokeLinecap="round" />
      <path d="M-13-22h5M-13-19h5M8-22h5M8-19h5" stroke={feat} strokeWidth={1} strokeLinecap="round" opacity={0.7} />
      <Motion x={9} y={-13} loop="beckon" period={1600} delay={delay} live={live}>
        <rect x={-2} y={-18} width={7} height={19} rx={3.5} fill={fill} stroke={INK} strokeWidth={1.6} />
        <path d="M0-15h3M0-12h3" stroke={feat} strokeWidth={1} strokeLinecap="round" opacity={0.6} />
      </Motion>
    </g>
  );
}

function Urn({ x }: { x: number }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <rect x={0} y={20} width={34} height={44} rx={7} fill="#D8D3CA" stroke={INK} strokeWidth={2} />
      <rect x={4} y={26} width={26} height={6} rx={2} fill="#fff" opacity={0.5} />
      <ellipse cx={17} cy={20} rx={17} ry={5} fill="#EAE6DF" stroke={INK} strokeWidth={2} />
      <rect x={14} y={10} width={6} height={8} rx={2} fill={INK} />
      <path d="M17 64v6" stroke={INK} strokeWidth={2} />
      <rect x={11} y={44} width={8} height={10} rx={2} fill="#8D5524" stroke={INK} strokeWidth={1.6} />
      <path d="M15 54v6" stroke={INK} strokeWidth={2} strokeLinecap="round" />
    </g>
  );
}

function Bell({ x, y, live }: { x: number; y: number; live: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={0} cy={8} rx={17} ry={5} fill="#8D5524" stroke={INK} strokeWidth={2} />
      <Motion x={0} y={8} loop="ding" period={3600} live={live}>
        <path d="M-13 0a13 13 0 0 1 26 0z" fill="#F2B64A" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        <ellipse cx={-5} cy={-8} rx={3} ry={1.6} fill="#fff" opacity={0.6} />
        <circle cy={-14} r={3} fill={INK} />
      </Motion>
      <Motion x={-20} y={8} loop="ringLeft" period={3600} live={live}>
        <path d="M0 -14a12 12 0 0 0 0 20" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" />
      </Motion>
      <Motion x={20} y={8} loop="ringRight" period={3600} live={live}>
        <path d="M0 -14a12 12 0 0 1 0 20" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" />
      </Motion>
    </g>
  );
}

function Plant({ x, y, live }: { x: number; y: number; live: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-9} y={0} width={18} height={16} rx={3} fill="#C9A16B" stroke={INK} strokeWidth={2} />
      <Motion x={0} y={0} loop="planted" period={3200} live={live}>
        <path d="M0 0c-8-6-10-16-4-22 6 4 6 14 4 22z" fill="#7CB86B" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
        <path d="M0 0c8-6 10-16 4-22-6 4-6 14-4 22z" fill="#6E8F5E" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
      </Motion>
    </g>
  );
}

function Sparkle({ x, y, delay, live }: { x: number; y: number; delay: number; live: boolean }) {
  return (
    <Motion x={x} y={y} loop="twinkle" period={2600} delay={delay} live={live}>
      <path d="M0 -5Q0 0 5 0Q0 0 0 5Q0 0 -5 0Q0 0 0 -5z" fill="#F2B64A" stroke={INK} strokeWidth={1.2} />
    </Motion>
  );
}

function Pickup({ cups, live }: { cups: CupVisual[]; live: boolean }) {
  return (
    <>
      <rect width={360} height={200} fill="#F5E6D3" />
      <rect x={0} y={0} width={360} height={12} fill="#E8D7C0" />
      <rect x={20} y={66} width={320} height={7} rx={2} fill="#C9A16B" stroke={INK} strokeWidth={2} />
      <Cat x={48} fill="#F2B64A" feat={INK} delay={0} live={live} />
      <Cat x={84} fill="#FFF9F0" feat={INK} coin delay={500} live={live} />
      <Cat x={120} fill="#3B3633" feat="#FFF3DE" delay={1000} live={live} />
      <Urn x={232} />
      <Urn x={280} />
      {(
        [
          [249, 0],
          [297, 1400],
          [242, 2400],
        ] as [number, number][]
      ).map(([sx, dl]) => (
        <Motion key={`${sx}-${dl}`} x={sx} y={12} loop="wisp" period={3000} delay={dl} live={live}>
          <path d="M0 0c-4-6 4-9 0-15" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" opacity={0.5} />
        </Motion>
      ))}
      <rect x={0} y={140} width={360} height={60} fill="#C9A16B" />
      <rect x={0} y={136} width={360} height={9} fill="#E0BE8C" stroke={INK} strokeWidth={2} />
      {cups.map((v, i) => (
        <OrderCup key={i} v={v} x={56 + i * 50} y={80} s={0.72} live={live} />
      ))}
      {/* The order ticket, leaning on nothing much, stirring in the air-con. */}
      <Motion x={258} y={140} loop="flutter" period={2800} live={live}>
        <path d="M0 0V-32H24V0Z" fill="#FFF9F0" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
        <path
          d="M5 -24h14M5 -18h10M5 -12h14M5 -6h8"
          stroke={INK}
          strokeWidth={1.6}
          strokeLinecap="round"
          opacity={0.55}
        />
      </Motion>
      <Bell x={304} y={128} live={live} />
      <Plant x={344} y={122} live={live} />
      <Sparkle x={22} y={100} delay={800} live={live} />
    </>
  );
}

/* ---------------------------------- delivery ---------------------------------- */

function Delivery({ cups, live }: { cups: CupVisual[]; live: boolean }) {
  const n = cups.length;
  const packs = useMemo(() => cups.map((_, i) => packFor(i)), [cups]);
  const flap = useMemo(() => flapFor(n), [n]);
  return (
    <>
      <rect width={360} height={200} fill="#EAF0E4" />
      <Motion x={60} y={40} loop="drift" period={14000} live={live}>
        <path
          d="M0 0c-10 0-14-8-8-13 2-10 18-12 22-3 8-4 18 2 14 9 6 3 2 8-4 7z"
          fill="#fff"
          stroke={INK}
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
      </Motion>
      <rect x={150} y={14} width={150} height={160} fill="#FFF3DE" stroke={INK} strokeWidth={2} />
      <rect x={180} y={40} width={90} height={134} rx={4} fill="#A2AD91" stroke={INK} strokeWidth={2} />
      <rect x={192} y={52} width={66} height={44} rx={3} fill="#EAF0E4" stroke={INK} strokeWidth={1.6} />
      <path d="M225 52v44M192 74h66" stroke={INK} strokeWidth={1.4} opacity={0.6} />
      <circle cx={250} cy={120} r={4} fill="#F2B64A" stroke={INK} strokeWidth={1.6} />
      <rect x={208} y={104} width={34} height={14} rx={3} fill="#FFF3DE" stroke={INK} strokeWidth={1.4} />
      <path d="M215 111h20" stroke={INK} strokeWidth={2} strokeLinecap="round" opacity={0.5} />
      {/* The doorbell, pressed at the top of each cycle, two chime rings. */}
      <g transform="translate(290 76)">
        <rect x={-7} y={-10} width={14} height={20} rx={4} fill="#3B3633" stroke={INK} strokeWidth={1.6} />
        <Motion x={0} y={0} loop="bellwave" period={4000} live={live}>
          <circle r={3.5} fill="#F2B64A" stroke={INK} strokeWidth={1} />
        </Motion>
        <Motion x={0} y={0} loop="chime" period={4000} live={live}>
          <circle r={10} fill="none" stroke={INK} strokeWidth={1.6} />
        </Motion>
        <Motion x={0} y={0} loop="chime" period={4000} delay={500} live={live}>
          <circle r={10} fill="none" stroke={INK} strokeWidth={1.6} />
        </Motion>
      </g>
      <rect x={0} y={170} width={360} height={30} fill="#D9CBB3" />
      <path d="M0 170h360" stroke={INK} strokeWidth={2} />
      <rect x={160} y={160} width={130} height={14} rx={3} fill="#C9A16B" stroke={INK} strokeWidth={2} />
      <path d="M172 167h106" stroke={INK} strokeWidth={1.6} strokeDasharray="4 4" opacity={0.5} />
      {/* The bag: opaque; the cups appear above it and go in one by one, hidden by the front once inside. */}
      <g transform="translate(226 126) scale(0.72)">
        <rect x={-46} y={-8} width={92} height={12} rx={3} fill="#3B2317" />
        {cups.map((v, i) => (
          <Motion key={i} x={-18} y={-2} frame={packs[i]} period={6000} live={live}>
            <OrderCup v={v} x={0} y={0} s={0.6} live={live} />
          </Motion>
        ))}
        <path
          d="M-52 -6h104v58a8 8 0 0 1 -8 8h-88a8 8 0 0 1 -8 -8z"
          fill="#8D5524"
          stroke={INK}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <rect x={-22} y={22} width={44} height={14} rx={3} fill="#FFF3DE" />
        <path d="M-15 29h30" stroke={INK} strokeWidth={2} strokeLinecap="round" opacity={0.55} />
        <Motion x={-52} y={-2} frame={flap} period={6000} live={live}>
          <rect x={0} y={-12} width={104} height={12} rx={4} fill="#6B3E15" stroke={INK} strokeWidth={2} />
          <path d="M36 -12v-6a16 16 0 0 1 32 0v6" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
        </Motion>
      </g>
      <g transform="translate(92 150)">
        <rect x={-11} y={0} width={22} height={20} rx={4} fill="#E9A87A" stroke={INK} strokeWidth={2} />
        <Motion x={0} y={0} loop="planted" period={3200} live={live}>
          <path d="M0 0c-10-8-12-20-4-28 8 5 8 18 4 28z" fill="#7CB86B" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
          <path d="M0 0c10-8 12-20 4-28-8 5-8 18-4 28z" fill="#6E8F5E" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
          <path d="M0 0c-2-12 2-22 8-26" fill="none" stroke={INK} strokeWidth={1.6} />
        </Motion>
      </g>
      <rect x={308} y={120} width={24} height={30} rx={2} fill="#C9A16B" stroke={INK} strokeWidth={2} />
      <Sparkle x={36} y={66} delay={300} live={live} />
    </>
  );
}
