import Image from "next/image";
import Link from "next/link";
import { getMenu, type MenuItem } from "@/lib/catalog";
import { BRAND, BUSINESS, FRAGRANCE_BLIND_BOX_PROMO } from "@/lib/constants";
import { formatPrice } from "@/lib/utils";
import { LoyaltyPopup } from "@/components/layout/LoyaltyPopup";
import { OrderModePopup } from "@/components/home/OrderModePopup";
import { WelcomeDiscountBanner } from "@/components/home/WelcomeDiscountBanner";
import { FragranceBlindBoxPromo } from "@/components/home/FragranceBlindBoxPromo";

// Branded home page for Mandy's Bubble Tea. Server-rendered so
// featured categories come straight from Square without any client
// JS beyond the shared CartIcon. Header/nav lives inline here for
// now — slice G will factor out a shared layout once we have more
// than one page asking for the same chrome.

export const revalidate = 10;

const MAPS_URL = `https://maps.google.com/?q=${encodeURIComponent(
  BUSINESS.address,
)}`;

const CUSTOMER_REVIEWS = [
  // 口感体验
  { text: "The softest boba in town!", author: "Customer Favorite" },
  { text: "Fresh, creamy, and perfectly sweet.", author: "Customer Favorite" },
  {
    text: "Every sip feels like a treat — so smooth and refreshing!",
    author: "Customer Favorite",
  },
  {
    text: "The pearls are chewy in the best way possible.",
    author: "Customer Favorite",
  },
  {
    text: "Perfectly balanced sweetness — never too sugary.",
    author: "Customer Favorite",
  },
  {
    text: "So rich and creamy, tastes freshly made every time.",
    author: "Customer Favorite",
  },

  // 最爱单品
  { text: "My go-to spot for taro milk tea!", author: "Customer Favorite" },
  { text: "The cheese cream series is unreal.", author: "Customer Favorite" },
  {
    text: "The brown sugar milk tea is absolutely addictive.",
    author: "Customer Favorite",
  },
  {
    text: "Their matcha latte is the best I've ever had.",
    author: "Customer Favorite",
  },
  {
    text: "The fruit teas are so refreshing — perfect for summer.",
    author: "Customer Favorite",
  },
  {
    text: "Can't get enough of the coconut milk series!",
    author: "Customer Favorite",
  },

  // 复购 & 忠实顾客
  { text: "Best bubble tea on the Gold Coast!", author: "Customer Favorite" },
  { text: "I come here every week — obsessed!", author: "Customer Favorite" },
  {
    text: "My friends and I come here after every outing.",
    author: "Customer Favorite",
  },
  {
    text: "I've tried every item on the menu — zero regrets!",
    author: "Customer Favorite",
  },
  {
    text: "This is our family's weekend ritual now.",
    author: "Customer Favorite",
  },
  {
    text: "Once you try it, you can't go back to anywhere else.",
    author: "Customer Favorite",
  },

  // 体验 & 氛围
  {
    text: "The staff are always so friendly and welcoming.",
    author: "Customer Favorite",
  },
  {
    text: "Love the vibe here — great drinks, great energy.",
    author: "Customer Favorite",
  },
  {
    text: "Quick service and the quality never drops.",
    author: "Customer Favorite",
  },
  {
    text: "A hidden gem that deserves so much more hype.",
    author: "Customer Favorite",
  },
  {
    text: "The perfect pick-me-up any time of day.",
    author: "Customer Favorite",
  },
  {
    text: "Always consistent — exactly what I expect every visit.",
    author: "Customer Favorite",
  },
];

type FeaturedItem = MenuItem & { categorySlug: string };

type HomeData = {
  featuredItems: FeaturedItem[];
  heroImageUrl: string | null;
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
    // Collect all items with images
    const allWithImage: FeaturedItem[] = [];
    for (const [slug, items] of menu.itemsBySlug.entries()) {
      for (const item of items) {
        if (item.imageUrl) allWithImage.push({ ...item, categorySlug: slug });
      }
    }

    const shuffled = shuffle(allWithImage);
    const heroImageUrl = shuffled[0]?.imageUrl ?? null;
    const featuredItems = shuffled.slice(0, 4);

    return { featuredItems, heroImageUrl, review };
  } catch {
    return { featuredItems: [], heroImageUrl: null, review };
  }
}

export default async function Home() {
  const { featuredItems, heroImageUrl, review } = await loadHomeData();

  return (
    <div className="flex flex-1 flex-col">
      <WelcomeDiscountBanner />
      {FRAGRANCE_BLIND_BOX_PROMO && <FragranceBlindBoxPromo />}
      <Hero imageUrl={heroImageUrl} review={review} />
      <FeaturedProducts items={featuredItems} />
      <OurStory />
      <AppPromo />
      <LoyaltyPopup />
      <OrderModePopup />
    </div>
  );
}

function Hero({
  imageUrl,
  review,
}: {
  imageUrl: string | null;
  review: (typeof CUSTOMER_REVIEWS)[number];
}) {
  return (
    <section className="px-4 py-10 sm:px-6 sm:py-16 md:py-24">
      <div className="mx-auto grid max-w-5xl items-center gap-8 sm:gap-10 sm:grid-cols-2">
        {/* Left — copy */}
        <div className="flex flex-col items-start gap-4 sm:gap-5">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
            style={{
              backgroundColor: "#E8F5E9",
              color: "#2E7D32",
            }}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
            Freshly Brewed Daily
          </span>

          <h1 className="text-3xl font-bold leading-[1.1] tracking-tight text-zinc-900 sm:text-4xl md:text-5xl lg:text-6xl">
            Your Daily Dose
            <br />
            of <span style={{ color: BRAND.primaryColor }}>Happiness</span>
          </h1>

          <p className="max-w-md text-sm leading-relaxed text-zinc-600 sm:text-base">
            Crafted with premium organic tea leaves and artisan-made boba
            pearls. Experience the warmth of a neighborhood tea house in every
            sip.
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-3">
            <Link
              href="/menu"
              className="inline-flex items-center rounded-full px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 sm:px-6 sm:py-3"
              style={{ backgroundColor: BRAND.primaryColor }}
            >
              Order
            </Link>
            <Link
              href="/our-story"
              className="inline-flex items-center rounded-full border border-black/15 px-5 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-black/5 sm:px-6 sm:py-3"
            >
              Our Story
            </Link>
          </div>
        </div>

        {/* Right — product image + review badge */}
        <div className="relative flex items-center justify-center">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt="Bubble tea"
              width={384}
              height={384}
              sizes="(max-width: 640px) 224px, (max-width: 768px) 288px, (max-width: 1024px) 320px, 384px"
              className="h-56 w-56 rounded-2xl object-cover shadow-lg sm:h-72 sm:w-72 md:h-80 md:w-80 lg:h-96 lg:w-96"
              priority
            />
          ) : (
            <div
              className="flex h-56 w-56 items-center justify-center rounded-2xl text-6xl sm:h-72 sm:w-72 md:h-80 md:w-80 lg:h-96 lg:w-96"
              style={{ backgroundColor: BRAND.accentColor }}
            >
              🧋
            </div>
          )}

          {/* Review badge */}
          <div className="absolute -bottom-4 left-0 flex max-w-[calc(100%-1rem)] items-center gap-2 rounded-full bg-white px-3 py-2 shadow-md sm:-left-4 sm:gap-2.5 sm:px-4 sm:py-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs text-white sm:h-8 sm:w-8">
              ⭐
            </span>
            <div className="min-w-0 text-left">
              <p className="truncate text-[11px] font-semibold text-zinc-800 sm:text-xs">
                {review.author}
              </p>
              <p className="truncate text-[11px] text-zinc-500 sm:text-xs">
                &ldquo;{review.text}&rdquo;
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeaturedProducts({ items }: { items: FeaturedItem[] }) {
  return (
    <section className="px-4 py-12 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 text-center sm:mb-10">
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl md:text-4xl">
            Steeped in Flavor
          </h2>
          <p className="mt-2 text-sm text-zinc-500">
            Hand-picked favorites from our seasonal menu.
          </p>
        </div>

        {items.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-6">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/menu/${item.categorySlug}/${item.id}`}
                  className="group block overflow-hidden rounded-xl bg-white p-2.5 shadow-sm transition hover:shadow-md sm:rounded-2xl sm:p-4"
                >
                  <div className="relative mx-auto aspect-square w-full overflow-hidden rounded-xl">
                    {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt={item.name}
                        fill
                        sizes="(max-width: 640px) 40vw, 200px"
                        className="object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div
                        className="flex h-full w-full items-center justify-center text-5xl"
                        style={{ backgroundColor: BRAND.accentColor }}
                      >
                        🧋
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex items-start justify-between gap-2 sm:mt-4">
                    <h3 className="min-w-0 truncate text-xs font-semibold text-zinc-900 sm:text-sm">
                      {item.name}
                    </h3>
                    {item.priceCents != null && (
                      <span
                        className="shrink-0 text-xs font-bold sm:text-sm"
                        style={{ color: BRAND.primaryColor }}
                      >
                        {formatPrice(item.priceCents)}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 sm:mt-3">
                    <span
                      className="inline-flex w-full items-center justify-center rounded-full py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90 sm:py-2 sm:text-xs"
                      style={{ backgroundColor: BRAND.primaryColor }}
                    >
                      Add to Cart
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-center text-sm text-zinc-600">
            <Link
              href="/menu"
              className="font-medium hover:underline"
              style={{ color: BRAND.primaryColor }}
            >
              See our menu →
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}

function AppPromo() {
  return (
    <section className="px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-7xl">
        <div
          className="relative overflow-hidden rounded-3xl"
          style={{ backgroundColor: "#2E1D12" }}
        >
          <div className="grid items-center gap-10 px-6 py-14 sm:px-12 sm:py-16 md:grid-cols-2 md:px-16 md:py-20 lg:px-20">
            {/* Left — copy */}
            <div className="flex flex-col items-start gap-5">
              <span
                className="text-[11px] font-medium uppercase tracking-[0.22em]"
                style={{ color: "#F5C9A3" }}
              >
                Mandy&apos;s App
              </span>
              <h2 className="font-serif text-4xl leading-[1.05] tracking-tight text-white sm:text-5xl md:text-6xl lg:text-[80px] lg:leading-[0.95]">
                Skip the line.
                <br />
                <span className="italic" style={{ color: "#F5C9A3" }}>
                  Sip sooner.
                </span>
              </h2>
              <p className="max-w-md text-sm leading-relaxed text-white/70 sm:text-base lg:text-lg">
                Order ahead, track your drink from brew to ready, and earn
                stars automatically. Same app we use behind the counter.
              </p>

              <div className="mt-2 flex flex-wrap gap-3">
                <a
                  href="https://apps.apple.com/au/app/mandys-bubble-tea/id6762111842"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-3 rounded-2xl px-5 py-3 transition hover:opacity-90"
                  style={{ backgroundColor: "#F5E6C8" }}
                  aria-label="Download Mandy's Bubble Tea on the App Store"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-7 w-7 shrink-0"
                    fill="#1a1a1a"
                    aria-hidden
                  >
                    <path d="M17.564 12.69c-.02-2.28 1.86-3.37 1.94-3.42-1.06-1.55-2.71-1.76-3.3-1.78-1.39-.14-2.73.82-3.44.82-.72 0-1.81-.81-2.97-.79-1.52.02-2.94.89-3.72 2.25-1.6 2.77-.41 6.85 1.13 9.1.77 1.1 1.68 2.34 2.87 2.29 1.16-.05 1.59-.74 2.99-.74s1.79.74 3.01.72c1.25-.02 2.03-1.11 2.78-2.22.88-1.27 1.24-2.51 1.25-2.58-.03-.01-2.39-.92-2.41-3.64zM15.21 5.9c.64-.78 1.07-1.86.95-2.93-.92.04-2.04.61-2.7 1.38-.59.69-1.11 1.79-.97 2.85 1.03.08 2.08-.52 2.72-1.3z" />
                  </svg>
                  <span className="leading-tight text-left">
                    <span
                      className="block text-[10px] font-medium"
                      style={{ color: "#6B4A2B" }}
                    >
                      Download on
                    </span>
                    <span className="block text-[15px] font-bold text-[#1a1a1a]">
                      App Store
                    </span>
                  </span>
                </a>
              </div>
            </div>

            {/* Right — phone mockup */}
            <div className="relative hidden md:flex md:items-center md:justify-end">
              <PhoneMockup />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PhoneMockup() {
  return (
    <div
      className="relative aspect-[9/18] w-[280px] rounded-[36px] p-[6px] shadow-2xl lg:w-[320px] xl:w-[360px]"
      style={{
        backgroundColor: "#3D2818",
        transform: "rotate(6deg)",
      }}
    >
      <div
        className="flex h-full w-full flex-col gap-4 rounded-[30px] p-5"
        style={{ backgroundColor: "#F5E6C8" }}
      >
        <p className="font-serif text-2xl text-[#3D2818]">Mandy</p>

        <div
          className="flex flex-col gap-1 rounded-2xl p-4"
          style={{ backgroundColor: "#8D5524", color: "#FFF3DE" }}
        >
          <span className="text-[9px] font-semibold uppercase tracking-[0.25em]">
            Rewards
          </span>
          <span className="font-serif text-2xl leading-tight">
            6 <span className="text-base opacity-80">/ 9 stars</span>
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="aspect-square rounded-xl" style={{ backgroundColor: "#F5C9A3" }} />
          <div className="aspect-square rounded-xl" style={{ backgroundColor: "#B9C4A0" }} />
          <div className="aspect-square rounded-xl" style={{ backgroundColor: "#8D5524" }} />
        </div>
      </div>
    </div>
  );
}

function OurStory() {
  return (
    <section
      className="px-4 py-12 sm:px-6 sm:py-20"
      style={{ backgroundColor: "#3E2723" }}
    >
      <div className="mx-auto grid max-w-5xl items-center gap-8 sm:gap-10 sm:grid-cols-2">
        {/* Left — image */}
        <div className="flex items-center justify-center">
          <Image
            src="/image/image_1.webp"
            alt="Bubble tea illustration"
            width={384}
            height={384}
            sizes="(max-width: 640px) 224px, (max-width: 768px) 288px, (max-width: 1024px) 320px, 384px"
            className="h-56 w-56 rounded-2xl object-contain sm:h-72 sm:w-72 md:h-80 md:w-80 lg:h-96 lg:w-96"
          />
        </div>

        {/* Right — copy */}
        <div className="flex flex-col gap-4 sm:gap-5">
          <h2 className="text-2xl font-bold leading-tight tracking-tight text-white sm:text-3xl md:text-4xl">
            Steeped in Tradition,
            <br />
            <span className="italic" style={{ color: BRAND.accentColor }}>
              Crafted for Comfort
            </span>
          </h2>

          <div
            className="h-1 w-12 rounded-full"
            style={{ backgroundColor: BRAND.primaryColor }}
          />

          <p className="text-sm leading-relaxed text-white/80">
            Mandy&apos;s began as a small window in a bustling street corner,
            born from a passion for the perfect tea-to-milk ratio. Every cup we
            serve is a tribute to the artisanal methods of tea-making, updated
            for the modern explorer.
          </p>
          <p className="text-sm leading-relaxed text-white/80">
            We source our leaves from high-altitude gardens and prepare our
            toppings in-house daily, ensuring that every sip is as fresh as the
            first of the day.
          </p>

          <div className="mt-4 flex gap-10">
            <div>
              <p className="text-2xl font-bold text-white">100%</p>
              <p className="text-xs uppercase tracking-wide text-white/60">
                Organic Tea
              </p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">In-House</p>
              <p className="text-xs uppercase tracking-wide text-white/60">
                Made Fresh
              </p>
            </div>
          </div>

          <Link
            href="/our-story"
            className="mt-2 inline-flex items-center text-sm font-semibold text-white/90 transition hover:text-white"
          >
            Read Our Full Story →
          </Link>
        </div>
      </div>
    </section>
  );
}

