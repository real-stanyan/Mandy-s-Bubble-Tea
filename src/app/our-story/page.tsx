import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { BRAND, BUSINESS } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Our Story — Mandy's Bubble Tea",
  description:
    "From a small window on a bustling street corner to the Gold Coast's favorite tea house. Discover the story behind Mandy's Bubble Tea.",
};

const MAPS_URL = `https://maps.google.com/?q=${encodeURIComponent(
  BUSINESS.address,
)}`;

export default function OurStoryPage() {
  return (
    <div className="flex flex-1 flex-col">
      {/* Hero banner */}
      <section
        className="relative px-4 py-16 sm:px-6 sm:py-24 md:py-32"
        style={{ backgroundColor: "#3E2723" }}
      >
        <div className="mx-auto max-w-3xl text-center">
          <p
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: BRAND.accentColor }}
          >
            Our Story
          </p>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl md:text-5xl">
            Steeped in Tradition,{" "}
            <span className="italic" style={{ color: BRAND.accentColor }}>
              Crafted for Comfort
            </span>
          </h1>
          <div
            className="mx-auto mt-6 h-1 w-12 rounded-full"
            style={{ backgroundColor: BRAND.primaryColor }}
          />
        </div>
      </section>

      {/* Origin */}
      <section className="px-4 py-12 sm:px-6 sm:py-20">
        <div className="mx-auto grid max-w-5xl items-center gap-8 sm:gap-12 sm:grid-cols-2">
          <Image
            src="/image/image_1.webp"
            alt="Mandy's Bubble Tea shop"
            width={384}
            height={384}
            sizes="(max-width: 640px) 256px, (max-width: 1024px) 320px, 384px"
            className="mx-auto h-64 w-64 rounded-2xl object-contain sm:h-80 sm:w-80 lg:h-96 lg:w-96"
          />
          <div className="flex flex-col gap-4">
            <h2 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
              How It All Began
            </h2>
            <p className="text-sm leading-relaxed text-zinc-600">
              Mandy&apos;s began as a small window on a bustling street corner,
              born from a passion for the perfect tea-to-milk ratio. What started
              as a simple dream — to bring authentic bubble tea to the Gold Coast
              — quickly became a neighborhood favorite.
            </p>
            <p className="text-sm leading-relaxed text-zinc-600">
              Every cup we serve is a tribute to the artisanal methods of
              tea-making, updated for the modern explorer. From choosing the right
              tea leaves to perfecting every topping, we pour our heart into each
              drink.
            </p>
          </div>
        </div>
      </section>

      {/* What makes us different */}
      <section
        className="px-4 py-12 sm:px-6 sm:py-20"
        style={{ backgroundColor: BRAND.accentColor }}
      >
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
              What Makes Us Different
            </h2>
            <p className="mt-2 text-sm text-zinc-500">
              Quality in every sip, from leaf to cup.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-3">
            <PillarCard
              icon="🍃"
              title="Premium Tea Leaves"
              description="Sourced from high-altitude gardens, our organic tea leaves are selected for their rich aroma and smooth finish."
            />
            <PillarCard
              icon="🧋"
              title="Fresh Toppings"
              description="We prepare our boba pearls and toppings in-house every 4 hours — ensuring that every sip is as fresh as the first of the day."
            />
            <PillarCard
              icon="💛"
              title="Made with Love"
              description="No shortcuts, no compromises. Just honest, handcrafted bubble tea made with care by our team."
            />
          </div>
        </div>
      </section>

      {/* Values / fun facts */}
      <section className="px-4 py-12 sm:px-6 sm:py-20">
        <div className="mx-auto grid max-w-5xl items-center gap-8 sm:gap-12 sm:grid-cols-2">
          <div className="order-2 sm:order-1 flex flex-col gap-4">
            <h2 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
              More Than Just Tea
            </h2>
            <p className="text-sm leading-relaxed text-zinc-600">
              At Mandy&apos;s, we believe bubble tea is more than a drink — it&apos;s
              a moment of joy. Whether you&apos;re catching up with friends,
              treating yourself after a long day, or discovering your new favorite
              flavor, we want every visit to feel like coming home.
            </p>
            <p className="text-sm leading-relaxed text-zinc-600">
              With 7 signature categories — from creamy Milky teas to refreshing
              Fruity blends and indulgent Cheese Cream creations — there&apos;s
              always something new to try.
            </p>

            <div className="mt-4 flex flex-wrap gap-8">
              <div>
                <p
                  className="text-2xl font-bold"
                  style={{ color: BRAND.primaryColor }}
                >
                  100%
                </p>
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  Organic Tea
                </p>
              </div>
              <div>
                <p
                  className="text-2xl font-bold"
                  style={{ color: BRAND.primaryColor }}
                >
                  In-House
                </p>
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  Made Fresh
                </p>
              </div>
              <div>
                <p
                  className="text-2xl font-bold"
                  style={{ color: BRAND.primaryColor }}
                >
                  7
                </p>
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  Categories
                </p>
              </div>
            </div>
          </div>
          <Image
            src="/image/image_2.webp"
            alt="Bubble tea preparation"
            width={384}
            height={384}
            sizes="(max-width: 640px) 256px, (max-width: 1024px) 320px, 384px"
            className="order-1 sm:order-2 mx-auto h-64 w-64 rounded-2xl object-contain sm:h-80 sm:w-80 lg:h-96 lg:w-96"
          />
        </div>
      </section>

      {/* Visit us CTA */}
      <section
        className="px-4 py-12 sm:px-6 sm:py-20"
        style={{ backgroundColor: "#3E2723" }}
      >
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Come Say Hi
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/80">
            We&apos;d love to make your next favorite drink. Visit us at
            Southport and experience the warmth of a neighborhood tea house.
          </p>

          <div className="mt-4 space-y-1 text-sm text-white/70">
            <p>{BUSINESS.address}</p>
            <p>Open daily: 10:30 AM – 10:30 PM</p>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/menu"
              className="inline-flex items-center rounded-full px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: BRAND.primaryColor }}
            >
              View Menu
            </Link>
            <a
              href={MAPS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Get Directions
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

function PillarCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <span className="text-3xl">{icon}</span>
      <h3 className="mt-3 text-sm font-semibold text-zinc-900">{title}</h3>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">
        {description}
      </p>
    </div>
  );
}
