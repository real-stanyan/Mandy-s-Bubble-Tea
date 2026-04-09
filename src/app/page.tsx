import Link from "next/link";
import { getMenu, type MenuCategory } from "@/lib/catalog";
import { BRAND, BUSINESS, LOYALTY } from "@/lib/constants";
import { CartIcon } from "@/components/cart/CartIcon";

// Branded home page for Mandy's Bubble Tea. Server-rendered so
// featured categories come straight from Square without any client
// JS beyond the shared CartIcon. Header/nav lives inline here for
// now — slice G will factor out a shared layout once we have more
// than one page asking for the same chrome.

export const revalidate = 300;

const MAPS_URL = `https://maps.google.com/?q=${encodeURIComponent(
  BUSINESS.address,
)}`;

async function loadFeaturedCategories(): Promise<MenuCategory[] | null> {
  try {
    const menu = await getMenu();
    // Non-empty categories only — no point teasing something with
    // nothing to order. Cap at 3 so the section stays above the fold
    // on most screens.
    return menu.categories.filter((c) => c.itemCount > 0).slice(0, 3);
  } catch {
    // Swallow — the rest of the page is static and should still render
    // even if the Square catalog is briefly unreachable.
    return null;
  }
}

export default async function Home() {
  const featured = await loadFeaturedCategories();

  return (
    <div className="flex flex-1 flex-col bg-white">
      <SiteHeader />
      <Hero />
      <FeaturedCategories categories={featured} />
      <LoyaltyTeaser />
      <VisitUs />
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header
      className="w-full px-6 py-5 text-white"
      style={{ backgroundColor: BRAND.primaryColor }}
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight hover:opacity-90"
        >
          {BRAND.name}
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/menu" className="opacity-90 hover:opacity-100">
            Menu
          </Link>
          <Link href="/account" className="opacity-90 hover:opacity-100">
            Account
          </Link>
          <CartIcon />
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section
      className="px-6 py-24 text-white sm:py-32"
      style={{ backgroundColor: BRAND.primaryColor }}
    >
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-6">
        <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
          Mandy&apos;s
          <br />
          Bubble Tea
        </h1>
        <p className="max-w-xl text-lg opacity-90 sm:text-xl">
          Freshly made bubble tea, brewed daily in Southport.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-5">
          <Link
            href="/menu"
            className="inline-flex items-center rounded-full px-7 py-3 text-base font-semibold transition hover:opacity-90"
            style={{
              backgroundColor: BRAND.accentColor,
              color: BRAND.primaryColor,
            }}
          >
            Order Now →
          </Link>
          <Link
            href="/account"
            className="text-sm font-medium underline opacity-90 hover:opacity-100"
          >
            View rewards
          </Link>
        </div>
      </div>
    </section>
  );
}

function FeaturedCategories({
  categories,
}: {
  categories: MenuCategory[] | null;
}) {
  return (
    <section className="bg-white px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-end justify-between gap-4">
          <h2 className="text-3xl font-semibold tracking-tight text-zinc-900">
            Explore the menu
          </h2>
          <Link
            href="/menu"
            className="text-sm font-medium hover:underline"
            style={{ color: BRAND.primaryColor }}
          >
            See full menu →
          </Link>
        </div>

        {categories && categories.length > 0 ? (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {categories.map((cat) => (
              <li key={cat.id}>
                <Link
                  href={`/menu/${cat.slug}`}
                  className="group block overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm transition hover:shadow-md"
                  style={{ borderColor: `${BRAND.primaryColor}22` }}
                >
                  <div className="relative aspect-square">
                    {cat.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={cat.imageUrl}
                        alt={cat.squareName}
                        className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-105"
                        loading="lazy"
                      />
                    )}
                    <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/20 to-transparent p-4 text-white">
                      <h3 className="text-lg font-semibold leading-tight">
                        {cat.squareName}
                      </h3>
                      <p className="mt-1 text-xs uppercase tracking-wide opacity-80">
                        {cat.itemCount}{" "}
                        {cat.itemCount === 1 ? "item" : "items"}
                      </p>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-600">
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

function LoyaltyTeaser() {
  return (
    <section
      className="px-6 py-20"
      style={{ backgroundColor: BRAND.accentColor }}
    >
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-6">
        <h2
          className="text-3xl font-semibold tracking-tight sm:text-4xl"
          style={{ color: BRAND.primaryColor }}
        >
          Earn stars. Drink free.
        </h2>
        <p className="max-w-2xl text-base leading-relaxed text-zinc-800 sm:text-lg">
          1 drink = 1 ⭐. Collect {LOYALTY.starsPerReward} ⭐ for a{" "}
          <span className="font-semibold">free drink of your choice</span> —
          across all categories.
        </p>
        <div
          className="flex gap-2 text-2xl sm:text-3xl"
          aria-label={`${LOYALTY.starsPerReward} stars to a free drink`}
        >
          {Array.from({ length: LOYALTY.starsPerReward }).map((_, i) => (
            <span key={i} style={{ color: BRAND.primaryColor }}>
              ⭐
            </span>
          ))}
        </div>
        <Link
          href="/account"
          className="mt-2 inline-flex items-center rounded-full px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          style={{ backgroundColor: BRAND.primaryColor }}
        >
          Check your stars →
        </Link>
      </div>
    </section>
  );
}

function VisitUs() {
  return (
    <section className="bg-white px-6 py-20">
      <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-2">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight text-zinc-900">
            Visit us
          </h2>
          <p className="mt-2 text-sm uppercase tracking-wide text-zinc-500">
            Pickup only
          </p>
        </div>
        <dl className="space-y-4 text-sm text-zinc-800">
          <div>
            <dt className="font-semibold text-zinc-900">Address</dt>
            <dd className="mt-1">
              <a
                href={MAPS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
                style={{ color: BRAND.primaryColor }}
              >
                {BUSINESS.address}
              </a>
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-zinc-900">Phone</dt>
            <dd className="mt-1">
              <a
                href={`tel:${BUSINESS.phone.replace(/\s+/g, "")}`}
                className="hover:underline"
                style={{ color: BRAND.primaryColor }}
              >
                {BUSINESS.phone}
              </a>
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-black/10 bg-zinc-50 px-6 py-8 text-xs text-zinc-500">
      <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <p>
          © 2026 {BRAND.name}. All rights reserved.
        </p>
        <p>Powered by Square.</p>
      </div>
    </footer>
  );
}
