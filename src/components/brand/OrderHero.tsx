"use client";

import { AMP, BODY, INK, Motion, PEARLS, Surface, WL, light, useInView, useUid } from "@/components/brand/art-kit";
import { CheckoutHero, OrderCup } from "@/components/brand/CheckoutHero";
import { wavePath } from "@/lib/motion/wave";
import type { CupVisual } from "@/lib/menu/cup-visual";
import {
  COUNTER_Y,
  DONE_CUP,
  DONE_PERIOD,
  FILL_DEPTH,
  LIQ_TOP,
  MAKE,
  POUR_FLOOR,
  PREP,
  PREP_PERIOD,
  RECEIVED_PERIOD,
  STREAM_LEN,
  TIN,
  arrive,
  dropIn,
  fill,
  handoff,
  noteSway,
  pour,
  press,
  shake,
  shakeArc,
  starDrift,
  ticketFeed,
} from "@/lib/motion/order-hero";

// What is happening to the customer's drinks, drawn on the order page while
// they wait for them. The checkout hero shows the counter they are heading
// for; this one shows the drinks getting made, and it changes as the order
// moves — which is the only picture on the site that is telling the customer
// something they don't already know.
//
// Same kit as the checkout heroes (components/brand/art-kit): the Mini Cup's
// cup, ink outlines, one shared rAF ticker writing matrices straight onto the
// DOM. Timings and frame maths are lib/motion/order-hero, which is where the
// rule that the loop must close is written down and tested.
//
// "Ready" is the checkout hero itself, unchanged. At checkout that drawing is
// a promise — this is where you'll come and this is what will be waiting; on
// this screen, at this step, it is simply true. Drawing a second counter to
// say the same thing would be the site talking to itself.

export type OrderScene = "received" | "preparing" | "ready" | "done";

export function OrderHero({
  scene,
  cups,
  extra = 0,
  className,
}: {
  scene: OrderScene;
  /** The customer's own cups, from lib/menu/order-cups. */
  cups: CupVisual[];
  extra?: number;
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();

  if (scene === "ready") {
    return <CheckoutHero kind="pickup" cups={cups} extra={extra} className={className} />;
  }

  const one = cups.length === 1;
  return (
    <div
      ref={ref}
      // The scene's own daylight, the same in both themes — the App's PIN rule
      // for illustrations, as on CheckoutHero.
      className={"relative aspect-[1.85] w-full overflow-hidden bg-[#F5E6D3] " + (className ?? "")}
      role="img"
      aria-label={
        scene === "received"
          ? `Your order printing at the counter`
          : scene === "preparing"
            ? `Your ${one ? "drink being" : "drinks being"} shaken and poured`
            : `Your ${one ? "drink" : "drinks"} collected — thanks for visiting`
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
        {scene === "received" ? (
          <Received cups={cups} live={inView} />
        ) : scene === "preparing" ? (
          <Preparing cups={cups} live={inView} />
        ) : (
          <PickedUp live={inView} />
        )}
      </svg>
    </div>
  );
}

/* --------------------------------- the room -------------------------------- */

/** The room the three new scenes stand in: the checkout hero's counter, and
 *  above it the shelf of topping jars every bubble tea bench has — which is
 *  also what stops the top third being empty wall. */
function Counter() {
  return (
    <>
      <rect width={360} height={200} fill="#F5E6D3" />
      <rect x={0} y={0} width={360} height={12} fill="#E8D7C0" />
      {JARS.map(([x, fill, r]) => (
        <Jar key={x} x={x} fill={fill} pearlR={r} />
      ))}
      <rect x={20} y={SHELF_Y} width={320} height={7} rx={2} fill="#C9A16B" stroke={INK} strokeWidth={2} />
      <rect x={0} y={COUNTER_Y + 4} width={360} height={60} fill="#C9A16B" />
      <rect
        x={0}
        y={COUNTER_Y}
        width={360}
        height={9}
        fill="#E0BE8C"
        stroke={INK}
        strokeWidth={2}
      />
    </>
  );
}

const SHELF_Y = 52;
/** Pearls, jelly, cubes — the jars the bench actually keeps at eye level. */
const JARS: [number, string, number][] = [
  [40, "#3B2317", 3],
  [76, "#C98A3C", 2.4],
  [112, "#E2645F", 2.4],
  [292, "#7CB86B", 2.6],
  [324, "#3B2317", 3],
];

function Jar({ x, fill, pearlR }: { x: number; fill: string; pearlR: number }) {
  return (
    <g transform={`translate(${x} ${SHELF_Y})`}>
      <rect x={-11} y={-26} width={22} height={26} rx={3} fill="#FDFAF4" stroke={INK} strokeWidth={1.8} />
      <g clipPath="none" fill={fill}>
        <circle cx={-5} cy={-5} r={pearlR} />
        <circle cx={2} cy={-4} r={pearlR} />
        <circle cx={7} cy={-6} r={pearlR} />
        <circle cx={-2} cy={-10} r={pearlR} />
        <circle cx={5} cy={-11} r={pearlR} />
      </g>
      <rect x={-13} y={-31} width={26} height={6} rx={2} fill="#8D5524" stroke={INK} strokeWidth={1.6} />
    </g>
  );
}

/** An empty cup, waiting. The finished ones are OrderCup; this is what one
 *  looks like before anything has gone into it. */
function EmptyCup({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d={BODY} fill="#FDFAF4" />
      <path d={BODY} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
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

/* ------------------------------- 1 · received ------------------------------ */

/** The ticket printing. Nothing is being made yet — for a scheduled order that
 *  is the whole point, and saying "Preparing" there was the lie this scene
 *  replaces the silence with. */
function Received({ cups, live }: { cups: CupVisual[]; live: boolean }) {
  return (
    <>
      <Counter />
      {cups.slice(0, 3).map((_, i) => (
        <EmptyCup key={i} x={44 + i * 44} y={COUNTER_Y - 78 * 0.62} s={0.62} />
      ))}
      <g>
        <rect x={236} y={COUNTER_Y - 72} width={64} height={72} rx={8} fill="#D8D3CA" stroke={INK} strokeWidth={2} />
        <rect x={244} y={COUNTER_Y - 64} width={48} height={5} rx={2.5} fill={INK} opacity={0.75} />
        <circle cx={290} cy={COUNTER_Y - 12} r={3.4} fill="#3CA96E" stroke={INK} strokeWidth={1.4} />
      </g>
      <Motion x={268} y={COUNTER_Y - 62} frame={ticketFeed} period={RECEIVED_PERIOD} live={live}>
        <rect x={-21} y={0} width={42} height={46} rx={3} fill="#FFFDF6" stroke={INK} strokeWidth={1.8} />
        <path
          d="M-13 12h26M-13 20h26M-13 28h18M-13 36h12"
          stroke={INK}
          strokeWidth={1.6}
          strokeLinecap="round"
          opacity={0.5}
        />
      </Motion>
      <Sparkle x={320} y={44} delay={0} live={live} />
    </>
  );
}

/* ------------------------------ 2 · preparing ------------------------------ */

/** The shop is 手摇. The tin is the centre of this scene and takes a third of
 *  the loop, because shaking by hand is the thing being sold. */
function Preparing({ cups, live }: { cups: CupVisual[]; live: boolean }) {
  const v = cups[0];
  return (
    <>
      <Counter />
      {v ? <OrderCup v={v} x={DONE_CUP.x} y={DONE_CUP.y} s={DONE_CUP.s} live={live} /> : null}

      {/* The shake read as speed: an arc flicking on each beat, one a side. */}
      {[-1, 1].map((side) => (
        <Motion key={side} x={TIN.x + side * 26} y={60} frame={shakeArc} period={PREP_PERIOD} live={live}>
          <path
            d={side < 0 ? "M0-11a10 10 0 0 0 0 22" : "M0-11a10 10 0 0 1 0 22"}
            fill="none"
            stroke={INK}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Motion>
      ))}

      {/* Drawn before the cup, so the cup's front hides the end of the pour. */}
      <Motion x={0} y={0} frame={pour(POUR_FLOOR, STREAM_LEN)} period={PREP_PERIOD} live={live}>
        <rect
          x={-2.8}
          y={0}
          width={5.6}
          height={STREAM_LEN}
          rx={2.8}
          fill={v ? v.liquidLight : "#DDA96F"}
        />
      </Motion>

      <Tin live={live} />
      <MakingCup v={v} live={live} />

      {/* The next empty cup, arriving as the finished one leaves. At the end of
          the cycle it stands exactly where the cup being made stands at the
          start — which is what closes the loop. */}
      <Motion x={MAKE.x} y={MAKE.y} frame={arrive(-120)} period={PREP_PERIOD} live={live}>
        <g transform={`scale(${MAKE.s})`}>
          <path d={BODY} fill="#FDFAF4" />
          <path d={BODY} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        </g>
      </Motion>

      <Sparkle x={52} y={44} delay={0} live={live} />
      <Sparkle x={330} y={38} delay={1300} live={live} />
    </>
  );
}

function Tin({ live }: { live: boolean }) {
  return (
    <Motion x={TIN.x} y={TIN.y} frame={shake} period={PREP_PERIOD} live={live}>
      <path
        d="M-14-30h28l4 50a6 6 0 0 1-6 6h-24a6 6 0 0 1-6-6z"
        fill="#D8D3CA"
        stroke={INK}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <path d="M-11-18h22" stroke="#fff" strokeWidth={3.4} strokeLinecap="round" opacity={0.55} />
      <rect x={-16} y={-41} width={32} height={12} rx={3.5} fill="#8D5524" stroke={INK} strokeWidth={2} />
      <rect x={-6} y={-48} width={12} height={8} rx={3} fill={INK} />
    </Motion>
  );
}

/** The cup being built: pearls down, tea poured over, lid pressed, straw
 *  through — then it slides onto the finished cup's exact spot and fades out
 *  there, with that cup already drawn underneath. */
function MakingCup({ v, live }: { v: CupVisual | undefined; live: boolean }) {
  const uid = useUid();
  const liquid = v?.liquid ?? "#C98A4B";
  const iceCount = v?.ice === "extra" || v?.ice === "normal" ? 2 : v?.ice === "less" ? 1 : 0;
  return (
    <Motion
      x={MAKE.x}
      y={MAKE.y}
      frame={handoff(DONE_CUP.x - MAKE.x, DONE_CUP.y - MAKE.y, 1 - DONE_CUP.s / MAKE.s)}
      period={PREP_PERIOD}
      live={live}
    >
      <g transform={`scale(${MAKE.s})`}>
        <defs>
          <clipPath id={`${uid}c`}>
            <path d={BODY} />
          </clipPath>
        </defs>
        <path d={BODY} fill="#FDFAF4" />
        <g clipPath={`url(#${uid}c)`}>
          <Motion x={0} y={0} frame={fill(FILL_DEPTH)} period={PREP_PERIOD} live={live}>
            <rect x={0} y={LIQ_TOP + AMP} width={60} height={64} fill={liquid} />
            <Surface
              d={wavePath({ x0: 10, width: 40, top: LIQ_TOP, amplitude: AMP, wavelength: WL, depth: 4.5 })}
              color={light(liquid)}
              live={live}
            />
          </Motion>

          {PEARLS.map(([px, py], i) => (
            <Motion
              key={i}
              x={px}
              y={py}
              frame={dropIn(PREP.pearlFrom + i * PREP.pearlStagger, PREP.pearlFall, -46)}
              period={PREP_PERIOD}
              live={live}
            >
              <circle r={3.4} fill="#3B2317" />
            </Motion>
          ))}

          {/* Ice comes down WITH the tea: it was shaken in the tin, not added
              after. Count follows the customer's own ice choice. */}
          {([[20, LIQ_TOP + 8, -12], [34, LIQ_TOP + 13, 14]] as [number, number, number][])
            .slice(0, iceCount)
            .map(([ix, iy, rot], i) => (
              <Motion
                key={ix}
                x={ix + 4.5}
                y={iy + 4.5}
                rot={rot}
                frame={dropIn(PREP.iceFrom + i * PREP.iceStagger, PREP.iceFall, -40)}
                period={PREP_PERIOD}
                live={live}
              >
                <rect x={-4.5} y={-4.5} width={9} height={9} rx={2} fill="#fff" opacity={0.55} />
              </Motion>
            ))}
        </g>
        <path d={BODY} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" />

        <Motion
          x={30}
          y={16.5}
          frame={press(PREP.sealFrom, PREP.sealTo, -44)}
          period={PREP_PERIOD}
          live={live}
        >
          <rect x={-21} y={-2.5} width={42} height={5} rx={2} fill={INK} />
        </Motion>
        <Motion
          x={35}
          y={10}
          rot={8}
          frame={press(PREP.strawFrom, PREP.strawTo, -30)}
          period={PREP_PERIOD}
          live={live}
        >
          <rect x={-2.25} y={-10} width={4.5} height={20} rx={1.6} fill={INK} />
        </Motion>
      </g>
    </Motion>
  );
}

/* ------------------------------- 4 · picked up ------------------------------ */

/** The counter after. This is the state a customer comes back to most — every
 *  order in their history lands here — so it gets a drawing too, rather than
 *  the bare tick it used to get. */
function PickedUp({ live }: { live: boolean }) {
  return (
    <>
      <Counter />
      {/* Pivoting where the note meets the counter, so the sway reads as a
          card propped there rather than one swinging from its top edge. */}
      <Motion x={180} y={COUNTER_Y} frame={noteSway} period={DONE_PERIOD} live={live}>
        <rect x={-47} y={-44} width={94} height={44} rx={4} fill="#FFFDF6" stroke={INK} strokeWidth={1.8} />
        {/* textLength pins the width: the shop's rounded face is a webfont, and
            without it a fallback's wider metrics would run the words off the
            card on the one frame that matters. */}
        <text
          x={0}
          y={-24}
          textAnchor="middle"
          textLength={74}
          lengthAdjust="spacingAndGlyphs"
          fill={INK}
          style={{
            font: '700 13px var(--font-shantell), "Comic Sans MS", cursive',
            letterSpacing: "0.02em",
          }}
        >
          THANK YOU!
        </text>
        <path
          d="M-11-14q11 9 22 0"
          fill="none"
          stroke="#E2645F"
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      </Motion>
      {[0, 1].map((i) => (
        <Motion
          key={i}
          x={134 + i * 92}
          y={COUNTER_Y - 56}
          frame={starDrift(i * 0.34)}
          period={DONE_PERIOD}
          live={live}
        >
          <path
            d="M0-9 2.8-3 9-2.4 4.4 2.1 5.6 8.6 0 5.5-5.6 8.6-4.4 2.1-9-2.4-2.8-3z"
            fill="#F2B64A"
            stroke={INK}
            strokeWidth={1.4}
            strokeLinejoin="round"
          />
        </Motion>
      ))}
      <Sparkle x={296} y={52} delay={0} live={live} />
      <Sparkle x={64} y={40} delay={1400} live={live} />
    </>
  );
}
