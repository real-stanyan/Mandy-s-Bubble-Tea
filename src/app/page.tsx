import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import { getMenu, type MenuItem } from "@/lib/catalog";
import { FRAGRANCE_BLIND_BOX_PROMO } from "@/lib/constants";
import { formatPrice } from "@/lib/utils";
import { LoyaltyPopup } from "@/components/layout/LoyaltyPopup";
import { OrderModePopup } from "@/components/home/OrderModePopup";
import { WelcomeDiscountBanner } from "@/components/home/WelcomeDiscountBanner";
import { FragranceBlindBoxPromo } from "@/components/home/FragranceBlindBoxPromo";

// Branded home page for Mandy's Bubble Tea, recreated from the
// design_handoff (web-home.jsx): hero with a floating cup + review/badge
// cards, a review marquee, featured drinks, the 7-family category grid, a
// story teaser, and the app promo. Server-rendered — featured drinks and
// categories come straight from Square. Motion is CSS-only (marquee +
// hero float), reduced-motion safe.

export const revalidate = 10;

// Hero cup visuals — background-removed transparent cup photos so the
// floating cup sits cleanly on the radial gradient (no white photo box).
// One is picked at random per render; Featured cards still use Square photos.
const HERO_CUPS = [
  "/home/hero-cups/1.webp",
  "/home/hero-cups/2.webp",
  "/home/hero-cups/3.webp",
  "/home/hero-cups/4.webp",
  "/home/hero-cups/5.webp",
  "/home/hero-cups/6.webp",
  "/home/hero-cups/7.webp",
];

const CUSTOMER_REVIEWS = [
  { text: "The softest boba in town!", author: "Customer Favorite" },
  { text: "Fresh, creamy, and perfectly sweet.", author: "Customer Favorite" },
  { text: "Every sip feels like a treat — so smooth and refreshing!", author: "Customer Favorite" },
  { text: "The pearls are chewy in the best way possible.", author: "Customer Favorite" },
  { text: "Perfectly balanced sweetness — never too sugary.", author: "Customer Favorite" },
  { text: "So rich and creamy, tastes freshly made every time.", author: "Customer Favorite" },
  { text: "My go-to spot for taro milk tea!", author: "Customer Favorite" },
  { text: "The cheese cream series is unreal.", author: "Customer Favorite" },
  { text: "The brown sugar milk tea is absolutely addictive.", author: "Customer Favorite" },
  { text: "Their matcha latte is the best I've ever had.", author: "Customer Favorite" },
  { text: "The fruit teas are so refreshing — perfect for summer.", author: "Customer Favorite" },
  { text: "Best bubble tea on the Gold Coast!", author: "Customer Favorite" },
  { text: "I come here every week — obsessed!", author: "Customer Favorite" },
  { text: "The staff are always so friendly and welcoming.", author: "Customer Favorite" },
  { text: "A hidden gem that deserves so much more hype.", author: "Customer Favorite" },
  { text: "Always consistent — exactly what I expect every visit.", author: "Customer Favorite" },
];

type FeaturedItem = MenuItem & { categorySlug: string };

type HomeData = {
  featured: FeaturedItem[];
  review: (typeof CUSTOMER_REVIEWS)[number];
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadHomeData(): Promise<HomeData> {
  const review =
    CUSTOMER_REVIEWS[Math.floor(Math.random() * CUSTOMER_REVIEWS.length)];
  try {
    const menu = await getMenu();
    const withImage: FeaturedItem[] = [];
    for (const [slug, items] of menu.itemsBySlug.entries()) {
      for (const item of items) {
        if (item.imageUrl) withImage.push({ ...item, categorySlug: slug });
      }
    }
    const shuffled = shuffle(withImage);
    return {
      featured: shuffled.slice(0, 4),
      review,
    };
  } catch {
    return { featured: [], review };
  }
}

export default async function Home() {
  const { featured, review } = await loadHomeData();
  const heroCup = HERO_CUPS[Math.floor(Math.random() * HERO_CUPS.length)];

  return (
    <div className="flex flex-1 flex-col">
      <WelcomeDiscountBanner />
      {FRAGRANCE_BLIND_BOX_PROMO && <FragranceBlindBoxPromo />}
      <Hero heroCup={heroCup} review={review} />
      <Marquee />
      <Featured items={featured} />
      <StoryTeaser />
      <AppPromo />
      <LoyaltyPopup />
      <OrderModePopup />
    </div>
  );
}

function Hero({
  heroCup,
  review,
}: {
  heroCup: string;
  review: (typeof CUSTOMER_REVIEWS)[number];
}) {
  return (
    <section className="px-5 pt-6 sm:px-8 sm:pt-14">
      <div className="mx-auto grid max-w-6xl items-center gap-5 sm:gap-10 md:grid-cols-[1.05fr_0.95fr]">
        {/* left copy */}
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-green/15 px-3.5 py-2 text-[13px] font-semibold text-green-dark">
            <span className="h-[7px] w-[7px] rounded-full bg-current" />
            Freshly brewed daily in Southport
          </span>
          <h1 className="mt-3.5 font-serif text-[clamp(44px,6vw,72px)] font-semibold leading-[0.98] tracking-[-0.03em] text-ink sm:mt-5">
            Your daily dose
            <br />
            of <span className="italic text-brand">happiness</span>.
          </h1>
          <p className="mt-3 max-w-[480px] text-[17px] leading-relaxed text-ink2 sm:mt-5">
            Silky milk teas and chewy pearls, made to order — order ahead, skip
            the line, and earn a free drink along the way.
          </p>
          <div className="mt-5 flex flex-wrap gap-3 sm:mt-7">
            <Link
              href="/menu"
              className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3.5 text-sm font-semibold text-white shadow-[0_14px_24px_rgba(141,85,36,0.30)] transition hover:bg-brand-dark active:scale-[0.97]"
            >
              Order now <ArrowRight size={17} />
            </Link>
            <Link
              href="/account"
              className="inline-flex items-center rounded-full border border-line bg-card px-6 py-3.5 text-sm font-semibold text-ink2 transition hover:bg-paper"
            >
              Join rewards
            </Link>
          </div>
          <div className="mt-5 flex items-center gap-7 sm:mt-9">
            {[
              ["7", "Drink families"],
              ["30+", "Signature drinks"],
              ["4.9★", "Customer rating"],
            ].map(([v, l]) => (
              <div key={l}>
                <div className="font-serif text-[30px] font-semibold tracking-[-0.5px] text-brand">
                  {v}
                </div>
                <div className="mt-0.5 text-[12px] font-medium text-ink3">
                  {l}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* right visual */}
        <div className="relative grid place-items-center">
          <div
            className="absolute aspect-square w-[78%] rounded-full opacity-90 sm:w-[84%]"
            style={{
              background:
                "radial-gradient(circle at 38% 32%, var(--color-peach), var(--color-brand) 78%)",
            }}
          />
          <div className="absolute aspect-square w-[62%] rounded-full border border-dashed border-white/40 sm:w-[68%]" />
          <div className="home-float relative z-[2] w-[72%] sm:w-[78%]">
            <Image
              src={heroCup}
              alt="Mandy's Bubble Tea"
              width={520}
              height={520}
              priority
              className="h-auto w-full object-contain"
              style={{ filter: "drop-shadow(0 30px 44px rgba(42,30,20,0.34))" }}
            />
          </div>
          {/* floating review card */}
          <div className="absolute bottom-[6%] left-[-2%] z-[3] flex max-w-[252px] items-center gap-3 rounded-[18px] bg-card p-3 pr-4 shadow-[0_18px_44px_rgba(42,30,20,0.14)]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-star">
              <Star size={18} className="fill-current" />
            </span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-bold text-ink">
                {review.author}
              </span>
              <span className="block text-[12.5px] leading-snug text-ink3">
                &ldquo;{review.text}&rdquo;
              </span>
            </span>
          </div>
          {/* floating badge */}
          <div className="absolute right-[-1%] top-[8%] z-[3] flex items-center gap-2 rounded-full bg-card px-4 py-2.5 shadow-[0_18px_44px_rgba(42,30,20,0.14)]">
            <Star size={17} className="text-peach" />
            <span className="text-[13px] font-semibold text-ink">
              Made fresh to order
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Marquee() {
  const items = [...CUSTOMER_REVIEWS, ...CUSTOMER_REVIEWS];
  return (
    <div className="mt-10 overflow-hidden border-y border-line bg-paper py-4">
      <div className="home-marquee-track">
        {items.map((r, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-2.5 px-7 text-[15px] font-medium text-ink2"
          >
            <Star size={14} className="shrink-0 text-star" /> &ldquo;{r.text}
            &rdquo;
          </span>
        ))}
      </div>
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
      <p className="mt-2 max-w-[460px] text-[14.5px] leading-relaxed text-ink2">
        {sub}
      </p>
    </div>
  );
}

function Featured({ items }: { items: FeaturedItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mx-auto w-full max-w-6xl px-5 pt-[72px] sm:px-8">
      <div className="mb-8 flex items-end justify-between gap-5">
        <SectionHead
          kicker="Mandy's · Southport"
          title="Steeped in flavour"
          sub="The signatures that built the queue — our most-loved cups, ready to order."
        />
        <Link
          href="/menu"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-card px-4 py-2.5 text-[13px] font-semibold text-ink2 transition hover:bg-paper"
        >
          View full menu <ArrowRight size={15} />
        </Link>
      </div>
      <div className="scrollbar-hide -mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 sm:mx-0 sm:px-0 lg:grid lg:grid-cols-4 lg:gap-5 lg:overflow-visible">
        {items.map((it) => (
          <Link
            key={it.id}
            href={`/menu/${it.categorySlug}/${it.id}`}
            className="group flex w-[158px] shrink-0 snap-start flex-col overflow-hidden rounded-card border border-line bg-card shadow-[0_2px_8px_rgba(42,30,20,0.05)] transition hover:-translate-y-1 hover:shadow-[0_18px_44px_rgba(42,30,20,0.14)] sm:w-[200px] lg:w-auto lg:shrink"
          >
            <div className="relative aspect-square overflow-hidden bg-bg2">
              {it.imageUrl && (
                <Image
                  src={it.imageUrl}
                  alt={it.name}
                  fill
                  sizes="(max-width:1024px) 50vw, 25vw"
                  className="object-cover transition group-hover:scale-105"
                />
              )}
            </div>
            <div className="flex flex-1 items-start justify-between gap-2 p-3.5">
              <h3 className="min-w-0 font-serif text-[15px] font-semibold leading-snug text-ink">
                {it.name}
              </h3>
              {it.priceCents != null && (
                <span className="shrink-0 font-mono text-sm font-bold text-brand">
                  {formatPrice(it.priceCents)}
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function StoryTeaser() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 pt-[72px] sm:px-8">
      <div
        className="overflow-hidden rounded-[30px] text-white"
        style={{ background: "#3E2723" }}
      >
        <div className="grid items-center gap-0 md:grid-cols-[1fr_1.1fr]">
          <div className="relative grid place-items-center p-12">
            <div
              className="absolute aspect-square w-[70%] rounded-full blur-lg"
              style={{
                background:
                  "radial-gradient(circle, rgba(255,179,128,.34), transparent 66%)",
              }}
            />
            <div className="relative aspect-square w-[58%]">
              <Image
                src="/logo.webp"
                alt="Mandy's"
                fill
                sizes="240px"
                className="object-contain"
                style={{ filter: "drop-shadow(0 22px 30px rgba(0,0,0,.45))" }}
              />
            </div>
          </div>
          <div className="p-10 pr-12 md:py-14">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-peach">
              Our story
            </p>
            <h2 className="mt-3 font-serif text-[clamp(28px,3.4vw,38px)] font-semibold leading-tight tracking-[-0.02em]">
              A better bubble tea,
              <br />
              <span className="italic text-cream">
                one perfect cup at a time
              </span>
            </h2>
            <p className="mt-4 max-w-[460px] text-[15.5px] leading-relaxed text-white/80">
              Mandy&apos;s began as a small window on a busy Southport corner —
              one counter, a handful of recipes, and a simple goal: make the
              kind of bubble tea you&apos;d happily queue for.
            </p>
            <Link
              href="/our-story"
              className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
            >
              Read our story <ArrowRight size={15} />
            </Link>
            <div className="mt-7 flex gap-11">
              {[
                ["30+", "Signature drinks"],
                ["7", "Drink families"],
                ["2019", "Est. Southport"],
              ].map(([v, l]) => (
                <div key={l}>
                  <div className="font-serif text-[30px] font-semibold">{v}</div>
                  <div className="mt-0.5 text-[11px] uppercase tracking-wide text-white/60">
                    {l}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AppPromo() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
      <div
        className="relative grid items-center gap-8 overflow-hidden rounded-[30px] p-10 sm:p-14 md:grid-cols-[1.3fr_1fr]"
        style={{ background: "#2E1D12" }}
      >
        <div
          className="absolute right-[-6%] top-[-30%] h-[360px] w-[360px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(255,179,128,.18), transparent 68%)",
          }}
        />
        <div className="relative">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-[#F5C9A3]">
            Mandy&apos;s App
          </p>
          <h2 className="mt-3 font-serif text-[clamp(34px,4.4vw,46px)] font-semibold leading-[0.98] tracking-[-0.02em] text-white">
            Skip the line.
            <br />
            <span className="italic text-[#F5C9A3]">Sip sooner.</span>
          </h2>
          <p className="mt-4 max-w-[420px] text-[16px] leading-relaxed text-white/70">
            Order ahead, track your drink from brew to ready, and watch your
            stars stack up automatically toward a free cup.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <StoreBadge top="Download on the" big="App Store" />
            <StoreBadge top="Get it on" big="Google Play" />
          </div>
        </div>
        <div className="relative grid place-items-center">
          <div
            className="aspect-[9/19] w-[200px] rounded-[34px] p-2"
            style={{ background: "#1d140d", boxShadow: "0 30px 60px rgba(0,0,0,.5)" }}
          >
            <div
              className="flex h-full w-full flex-col items-center justify-center gap-3.5 rounded-[27px] p-4 text-center"
              style={{ background: "linear-gradient(160deg,#F2E8DF,#E8DAC6)" }}
            >
              <Image src="/logo.webp" alt="Mandy's" width={70} height={70} />
              <span className="text-[11px] font-semibold text-ink3">
                Order on the go
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StoreBadge({ top, big }: { top: string; big: string }) {
  return (
    <span
      className="inline-flex items-center gap-2.5 rounded-[14px] px-4 py-2.5"
      style={{ background: "#F5E6C8" }}
    >
      <span className="text-left leading-tight">
        <span className="block text-[9.5px] font-medium text-[#6B4A2B]">
          {top}
        </span>
        <span className="block text-[15px] font-bold text-[#1a1a1a]">{big}</span>
      </span>
    </span>
  );
}
