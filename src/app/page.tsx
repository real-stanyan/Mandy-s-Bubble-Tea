import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import { getMenu, type MenuItem } from "@/lib/catalog";
import { FRAGRANCE_BLIND_BOX_PROMO, STORE_PLACE_ID } from "@/lib/constants";
import { formatPrice } from "@/lib/utils";
import { LoyaltyPopup } from "@/components/layout/LoyaltyPopup";
import { OrderModePopup } from "@/components/home/OrderModePopup";
import { HeroCup } from "@/components/home/HeroCup";
import { getStoreRating, type StoreRating } from "@/lib/store-rating";
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
  const [{ featured, review }, storeRating] = await Promise.all([
    loadHomeData(),
    getStoreRating(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <WelcomeDiscountBanner />
      {FRAGRANCE_BLIND_BOX_PROMO && <FragranceBlindBoxPromo />}
      <Hero review={review} storeRating={storeRating} />
      <Marquee />
      <Featured items={featured} />
      <StoryTeaser />
      <AppPromo />
      <LoyaltyPopup />
      <OrderModePopup />
    </div>
  );
}

function GoogleGLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#34A853"
        d="M10.53 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.28-3.14.76-4.59l-7.98-6.19A23.99 23.99 0 0 0 0 24c0 3.77.9 7.35 2.56 10.53l7.97-5.94z"
      />
      <path
        fill="#FBBC05"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 5.94C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function Hero({
  review,
  storeRating,
}: {
  review: (typeof CUSTOMER_REVIEWS)[number];
  storeRating: StoreRating | null;
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
              [`${(storeRating?.rating ?? 4.4).toFixed(1)}★`, "Customer rating"],
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
          {/* soft warm spotlight — radial peach glow fading to nothing, no hard
              edge, so the cup reads as lit from behind rather than stuck on a disc */}
          <div
            className="absolute aspect-square w-[92%] rounded-full sm:w-[100%]"
            style={{
              background:
                "radial-gradient(circle at 50% 42%, rgba(255,179,128,0.55), rgba(255,179,128,0.16) 46%, transparent 70%)",
              filter: "blur(8px)",
            }}
          />
          {/* bright cream core so the cup pops off the glow */}
          <div
            className="absolute aspect-square w-[58%] rounded-full"
            style={{
              background:
                "radial-gradient(circle at 50% 44%, rgba(255,243,222,0.72), transparent 70%)",
              filter: "blur(6px)",
            }}
          />
          {/* grounding shadow ellipse — cup reads as floating above a surface */}
          <div
            className="absolute bottom-[9%] left-1/2 h-[7%] w-[50%] -translate-x-1/2 rounded-[50%]"
            style={{
              background: "rgba(42,30,20,0.20)",
              filter: "blur(12px)",
            }}
          />
          <div className="home-float relative z-[2] w-[72%] sm:w-[78%]">
            <HeroCup cups={HERO_CUPS} />
          </div>
          {/* floating rating card — live Google Maps store rating; falls back
              to a static review if the rating can't be fetched */}
          {storeRating ? (
            <a
              href={
                storeRating.url ??
                `https://www.google.com/maps/place/?q=place_id:${STORE_PLACE_ID}`
              }
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Mandy's rated ${storeRating.rating.toFixed(1)} out of 5 from ${storeRating.total} Google reviews`}
              className="absolute bottom-[6%] left-[-2%] z-[3] flex max-w-[260px] items-center gap-2.5 rounded-[16px] bg-white p-3 pr-4 shadow-[0_18px_44px_rgba(42,30,20,0.14)] ring-1 ring-black/[0.06] transition hover:-translate-y-0.5"
            >
              <GoogleGLogo className="h-[26px] w-[26px] shrink-0" />
              <span className="min-w-0">
                <span className="block text-[11px] font-medium text-ink3">
                  Google Rating
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[15px] font-bold leading-none text-[#202124]">
                    {storeRating.rating.toFixed(1)}
                  </span>
                  <span className="flex items-center gap-px" aria-hidden="true">
                    {[0, 1, 2, 3, 4].map((i) => {
                      const fill = Math.max(
                        0,
                        Math.min(1, storeRating.rating - i),
                      );
                      return (
                        <span key={i} className="relative inline-flex">
                          <Star size={12} className="fill-[#E0E0E0] text-[#E0E0E0]" />
                          <span
                            className="absolute inset-0 overflow-hidden"
                            style={{ width: `${fill * 100}%` }}
                          >
                            <Star
                              size={12}
                              className="fill-[#FBBC04] text-[#FBBC04]"
                            />
                          </span>
                        </span>
                      );
                    })}
                  </span>
                  <span className="text-[11px] text-ink3">
                    ({storeRating.total.toLocaleString()})
                  </span>
                </span>
              </span>
            </a>
          ) : (
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
          )}
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
            <div className="relative aspect-square w-[82%]">
              <Image
                src="/image/image_1.webp"
                alt="Mona Lisa enjoying bubble tea"
                fill
                sizes="(max-width: 768px) 320px, 400px"
                className="rounded-[20px] object-contain"
                style={{ filter: "drop-shadow(0 22px 34px rgba(0,0,0,.45))" }}
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
        className="relative overflow-hidden rounded-[30px] p-10 sm:p-14"
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
