import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  Check,
  ShoppingCart,
  Star,
  Clock,
  Gift,
} from "lucide-react";
import { getMenu, type MenuItem } from "@/lib/catalog";

// Our Story, recreated from the design (web-story.jsx): a warm brand story
// about craft, consistency and ritual — no ingredient-origin claims. Dark
// hero with a floating cup, manifesto, the ordering ritual, the seven
// families (live from Square), values + stats, an assurance split, and a
// closing CTA. Server-rendered to stay lint-clean; visuals come from the
// live menu so there are no missing asset references.

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Our Story — Mandy's Bubble Tea",
  description:
    "A better bubble tea, one perfect cup at a time. The story behind Mandy's — made to order in Southport since 2019.",
};

const KICKER = "Our Story · Southport, est. 2019";
const HEADLINE = ["A better bubble tea,", "one perfect cup at a time."];
const TAGLINE = "Made to order, every single time.";
const INTRO =
  "Mandy's began as a small window on a busy Southport corner — one counter, a handful of recipes, and a simple goal: make the kind of bubble tea you'd happily queue for. A few years on, that's still the whole plan.";

const MANIFESTO = [
  "We're a little obsessed with consistency. The cup you love today should taste exactly that good next week, next month, and a year from now — so we dial in every recipe until it's right, then make it the same way every single time.",
  "And everything is built to order. You choose the base, the sweetness, the ice and the toppings; we shake it fresh and hand it over — no shortcuts, no sitting on the shelf, just your drink, the way you like it.",
];

const PROCESS = [
  {
    n: "01",
    title: "Pick your base",
    body: "Seven families, thirty-plus drinks — from silky milk teas to fruit-forward refreshers.",
    Icon: ShoppingCart,
  },
  {
    n: "02",
    title: "Make it yours",
    body: "Dial the sweetness and ice, then stack on pearls, jellies and cream to taste.",
    Icon: Star,
  },
  {
    n: "03",
    title: "Shaken to order",
    body: "Every cup is shaken the moment you order it — never pre-made, never waiting.",
    Icon: Clock,
  },
  {
    n: "04",
    title: "Sip & earn",
    body: "Grab it in minutes and collect a star toward your next free drink.",
    Icon: Gift,
  },
];

const VALUES = [
  {
    sym: "①",
    name: "Consistency",
    role: "Your favourite, exactly the same, every time.",
    color: "#8D5524",
  },
  {
    sym: "②",
    name: "Customization",
    role: "Sweetness, ice and toppings — entirely your call.",
    color: "#2A6FDB",
  },
  {
    sym: "③",
    name: "Made to order",
    role: "Shaken fresh, never sitting on a shelf.",
    color: "#3CA96E",
  },
  {
    sym: "④",
    name: "Community",
    role: "A neighbourhood spot, proudly on the Gold Coast.",
    color: "#8E6FD0",
  },
];

const STATS = [
  { v: "7", l: "Drink families" },
  { v: "30+", l: "Signature drinks" },
  { v: "2019", l: "Serving Southport" },
  { v: "4.9★", l: "Customer rating" },
];

const ASSURANCE = {
  title: "Crafted for the way you sip",
  body: "Whether it's your morning ritual or an afternoon treat, every Mandy's cup is made the same careful way — balanced, endlessly customizable, and ready in minutes.",
};

const CATEGORY_BLURBS: Record<string, string> = {
  MILKY: "Silky milk teas with chewy pearls — the classics.",
  FRUITY: "Bright, juicy fruit teas — refreshing every sip.",
  "SPECIAL MIX": "House blends you won't find anywhere else.",
  "FRESH BREW": "Pure brewed teas, clean and aromatic.",
  "FRUITY BLACK TEA": "Black tea meets fresh fruit — bold and zesty.",
  FROZEN: "Spoonable frozen slushies for hot days.",
  "CHEESE CREAM": "Crowned with velvety salted cheese foam.",
};

function categoryBlurb(squareName: string, itemCount: number): string {
  return (
    CATEGORY_BLURBS[squareName.toUpperCase()] ??
    `${itemCount} drink${itemCount !== 1 ? "s" : ""} to explore.`
  );
}

type FamilyCard = {
  slug: string;
  name: string;
  imageUrl: string | null;
  itemCount: number;
};

type StoryData = {
  heroItem: MenuItem | null;
  assuranceItem: MenuItem | null;
  families: FamilyCard[];
};

async function loadStoryData(): Promise<StoryData> {
  try {
    const menu = await getMenu();
    const withImage: MenuItem[] = [];
    for (const items of menu.itemsBySlug.values()) {
      for (const item of items) {
        if (item.imageUrl) withImage.push(item);
      }
    }
    const families: FamilyCard[] = menu.categories
      .filter((c) => c.itemCount > 0)
      .map((c) => ({
        slug: c.slug,
        name: c.squareName,
        imageUrl: c.imageUrl,
        itemCount: c.itemCount,
      }));
    return {
      heroItem: withImage[0] ?? null,
      assuranceItem: withImage[1] ?? withImage[0] ?? null,
      families,
    };
  } catch {
    return { heroItem: null, assuranceItem: null, families: [] };
  }
}

export default async function OurStoryPage() {
  const { heroItem, assuranceItem, families } = await loadStoryData();

  return (
    <div className="flex flex-1 flex-col">
      {/* ===================== HERO ===================== */}
      <section
        className="relative overflow-hidden text-white"
        style={{ backgroundColor: "#241710" }}
      >
        <div
          className="pointer-events-none absolute right-[-4%] top-[-18%] h-[440px] w-[440px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(255,179,128,.22), transparent 66%)",
          }}
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-16 sm:px-8 sm:pt-24 md:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-peach">
              {KICKER}
            </p>
            <h1 className="mt-4 font-serif text-[clamp(40px,4.8vw,64px)] font-semibold leading-[1.0] tracking-[-0.03em]">
              <span className="block">{HEADLINE[0]}</span>
              <span className="block italic text-peach">{HEADLINE[1]}</span>
            </h1>
            <p className="mt-5 max-w-[540px] text-[18px] leading-relaxed text-white/75">
              {INTRO}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/menu"
                className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3.5 text-sm font-semibold text-white shadow-[0_14px_24px_rgba(141,85,36,0.30)] transition hover:bg-brand-dark active:scale-[0.97]"
              >
                Browse the menu <ArrowRight size={17} />
              </Link>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-3 text-[14.5px] font-semibold text-white/80">
                <Check size={16} className="text-peach" /> {TAGLINE}
              </span>
            </div>
          </div>
          <div className="relative grid place-items-center">
            <div
              className="absolute aspect-square w-[78%] rounded-full blur-md"
              style={{
                background:
                  "radial-gradient(circle at 40% 34%, rgba(255,179,128,.5), rgba(141,85,36,.2) 70%, transparent 78%)",
              }}
            />
            {heroItem?.imageUrl ? (
              <div className="home-float relative z-[2] w-[68%]">
                <Image
                  src={heroItem.imageUrl}
                  alt={heroItem.name}
                  width={520}
                  height={520}
                  priority
                  className="h-auto w-full object-contain"
                  style={{
                    filter: "drop-shadow(0 28px 40px rgba(0,0,0,.5))",
                  }}
                />
              </div>
            ) : (
              <div className="home-float relative z-[2] grid aspect-square w-[58%] place-items-center text-[120px]">
                🧋
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ===================== MANIFESTO ===================== */}
      <section className="mx-auto w-full max-w-[1000px] px-5 pb-2 pt-20 sm:px-8">
        <div className="grid items-start gap-11 md:grid-cols-2">
          <h2 className="font-serif text-[clamp(28px,3.4vw,36px)] font-semibold leading-[1.08] tracking-[-0.02em] text-ink">
            Two things we
            <br />
            <span className="italic text-brand">never compromise.</span>
          </h2>
          <div className="flex flex-col gap-4">
            {MANIFESTO.map((p) => (
              <p key={p.slice(0, 24)} className="text-[16px] leading-relaxed text-ink2">
                {p}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== PROCESS ===================== */}
      <section className="mx-auto w-full max-w-6xl px-5 pt-[72px] sm:px-8">
        <SectionHead
          kicker="The ritual"
          title="How your cup comes together"
          sub="Four quick steps from tap to sip — the same care behind every order."
        />
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PROCESS.map(({ n, title, body, Icon }) => (
            <div
              key={n}
              className="rounded-card border border-line bg-card p-6 shadow-[0_2px_8px_rgba(42,30,20,0.05)]"
            >
              <div className="flex items-center justify-between">
                <span className="grid h-[42px] w-[42px] place-items-center rounded-tile bg-cream text-brand">
                  <Icon size={20} />
                </span>
                <span className="font-serif text-[30px] font-semibold tracking-[-1px] text-ink4">
                  {n}
                </span>
              </div>
              <h3 className="mt-4 font-serif text-[20px] font-semibold tracking-[-0.3px] text-ink">
                {title}
              </h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink2">
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ===================== FAMILIES ===================== */}
      {families.length > 0 && (
        <section className="mx-auto w-full max-w-6xl px-5 pt-[72px] sm:px-8">
          <SectionHead
            center
            kicker="The full range"
            title="Seven ways to sip"
            sub="From silky milk teas to spoonable frozen slushies — there's a Mandy's cup for every mood."
          />
          <div className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {families.map((cat) => (
              <Link
                key={cat.slug}
                href={`/menu/${cat.slug}`}
                className="group flex flex-col overflow-hidden rounded-card border border-line bg-card text-left shadow-[0_2px_8px_rgba(42,30,20,0.05)] transition hover:-translate-y-1 hover:shadow-[0_18px_44px_rgba(42,30,20,0.14)]"
              >
                <div className="relative aspect-[16/10] overflow-hidden bg-bg2">
                  {cat.imageUrl && (
                    <Image
                      src={cat.imageUrl}
                      alt={cat.name}
                      fill
                      sizes="(max-width:1024px) 50vw, 25vw"
                      className="object-cover transition group-hover:scale-105"
                    />
                  )}
                </div>
                <div className="p-4">
                  <h3 className="font-serif text-[18px] font-semibold tracking-[-0.3px] text-ink">
                    {cat.name}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-ink3">
                    {categoryBlurb(cat.name, cat.itemCount)}
                  </p>
                </div>
              </Link>
            ))}
            <Link
              href="/menu"
              className="flex min-h-[140px] flex-col items-start justify-center gap-2.5 rounded-card bg-brand p-6 text-white transition hover:-translate-y-1"
            >
              <span className="grid h-[42px] w-[42px] place-items-center rounded-full bg-white/20">
                <ArrowRight size={20} />
              </span>
              <span className="font-serif text-[20px] font-semibold leading-tight">
                See the
                <br />
                whole menu
              </span>
            </Link>
          </div>
        </section>
      )}

      {/* ===================== VALUES + STATS ===================== */}
      <section className="mx-auto w-full max-w-6xl px-5 pt-[72px] sm:px-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {VALUES.map((v) => (
            <div
              key={v.name}
              className="relative overflow-hidden rounded-card border border-line bg-card p-6 shadow-[0_2px_8px_rgba(42,30,20,0.05)]"
            >
              <span
                className="absolute inset-x-0 top-0 h-1"
                style={{ backgroundColor: v.color }}
              />
              <span
                className="font-serif text-[30px] font-semibold"
                style={{ color: v.color }}
              >
                {v.sym}
              </span>
              <h3 className="mt-2.5 font-serif text-[18px] font-semibold tracking-[-0.2px] text-ink">
                {v.name}
              </h3>
              <p className="mt-1.5 text-[13px] leading-snug text-ink2">
                {v.role}
              </p>
            </div>
          ))}
        </div>
        <div
          className="relative mt-4 overflow-hidden rounded-[28px] px-8 py-11 text-white sm:px-10"
          style={{ backgroundColor: "#241710" }}
        >
          <div
            className="pointer-events-none absolute right-[-3%] top-[-40%] h-[280px] w-[280px] rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(255,179,128,.16), transparent 66%)",
            }}
          />
          <div className="relative grid grid-cols-2 gap-6 sm:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.l} className="text-center">
                <div className="font-serif text-[clamp(34px,4vw,46px)] font-semibold tracking-[-1.5px] text-peach">
                  {s.v}
                </div>
                <div className="mt-1.5 text-[12.5px] font-medium text-white/60">
                  {s.l}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== ASSURANCE ===================== */}
      <section className="mx-auto w-full max-w-6xl px-5 pt-[72px] sm:px-8">
        <div className="grid overflow-hidden rounded-[28px] border border-line bg-card shadow-[0_2px_8px_rgba(42,30,20,0.05)] md:grid-cols-[0.85fr_1.15fr]">
          <div className="relative grid min-h-[280px] place-items-center overflow-hidden bg-bg2">
            <div
              className="absolute aspect-square w-[70%] rounded-full blur-lg"
              style={{
                background:
                  "radial-gradient(circle, rgba(255,179,128,.4), transparent 66%)",
              }}
            />
            {assuranceItem?.imageUrl ? (
              <Image
                src={assuranceItem.imageUrl}
                alt={assuranceItem.name}
                width={360}
                height={360}
                className="relative z-[1] w-[52%] object-contain"
                style={{
                  filter: "drop-shadow(0 20px 28px rgba(42,30,20,.3))",
                }}
              />
            ) : (
              <span className="relative z-[1] text-[96px]">🧋</span>
            )}
          </div>
          <div className="p-10 sm:p-12">
            <span className="inline-flex items-center gap-2 rounded-full bg-cream px-4 py-2 text-[13px] font-semibold text-brand">
              <Star size={15} /> Made the same way, every time
            </span>
            <h2 className="mt-4 font-serif text-[clamp(28px,3.2vw,34px)] font-semibold leading-[1.08] tracking-[-0.02em] text-ink">
              {ASSURANCE.title}
            </h2>
            <p className="mt-3.5 max-w-[480px] text-[16px] leading-relaxed text-ink2">
              {ASSURANCE.body}
            </p>
          </div>
        </div>
      </section>

      {/* ===================== CTA ===================== */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-20 pt-[72px] sm:px-8">
        <div className="mx-auto max-w-[620px] text-center">
          <h2 className="font-serif text-[clamp(32px,4vw,40px)] font-semibold leading-[1.05] tracking-[-0.03em] text-ink">
            Come find your cup.
          </h2>
          <p className="mt-3 text-[16.5px] leading-relaxed text-ink2">
            Thirty-plus drinks, made to order and ready in minutes — with a free
            one waiting at the end of every loyalty card.
          </p>
          <Link
            href="/menu"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3.5 text-sm font-semibold text-white shadow-[0_14px_24px_rgba(141,85,36,0.30)] transition hover:bg-brand-dark active:scale-[0.97]"
          >
            Order now <ArrowRight size={17} />
          </Link>
        </div>
      </section>
    </div>
  );
}

function SectionHead({
  kicker,
  title,
  sub,
  center,
}: {
  kicker: string;
  title: string;
  sub: string;
  center?: boolean;
}) {
  return (
    <div className={center ? "mx-auto max-w-xl text-center" : ""}>
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-brand">
        {kicker}
      </p>
      <h2 className="mt-2 font-serif text-[clamp(28px,3.6vw,40px)] font-semibold tracking-[-0.02em] text-ink">
        {title}
      </h2>
      <p
        className={
          "mt-2 text-[14.5px] leading-relaxed text-ink2" +
          (center ? " mx-auto max-w-[460px]" : " max-w-[460px]")
        }
      >
        {sub}
      </p>
    </div>
  );
}
