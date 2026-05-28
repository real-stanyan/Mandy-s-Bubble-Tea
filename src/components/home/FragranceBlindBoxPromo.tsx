import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/constants";

// Limited-time campaign card: "Buy 2 drinks, get a fragrance-tag blind
// box." Marketing only — the blind box is handed out in-store at pickup,
// so this is a static server component that links to the menu. Visual
// treatment mirrors DailySpecial / the peach welcome cards. Gated by
// FRAGRANCE_BLIND_BOX_PROMO in page.tsx — flip that to retire it.

const TAGS = [
  { src: "/image/promo/fragrance-tags/cherry.png", rotate: "-8deg", top: "0", right: "1.75rem" },
  { src: "/image/promo/fragrance-tags/black-opium.png", rotate: "7deg", top: "2.25rem", right: "0" },
  { src: "/image/promo/fragrance-tags/new-car.png", rotate: "-4deg", top: "4.5rem", right: "2rem" },
] as const;

export function FragranceBlindBoxPromo() {
  return (
    <section className="px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/menu"
          className="group relative flex items-stretch gap-3 overflow-hidden rounded-3xl border border-black/10 p-5 shadow-sm transition hover:shadow-md sm:gap-4 sm:p-8"
          style={{
            backgroundImage:
              "linear-gradient(115deg, #FFB380 0%, #FFCFA3 55%, #FFF3DE 100%)",
          }}
          aria-label="Buy 2 drinks, get a fragrance-tag blind box — order now"
        >
          {/* Left — copy */}
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-4">
            <div>
              <span className="inline-block rounded bg-[#2A1E14] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.13em] text-[#FFF3DE]">
                Limited · While stocks last
              </span>
              <h2 className="mt-3 font-serif text-2xl leading-[1.05] text-[#2A1E14] sm:text-3xl md:text-4xl">
                2 drinks, <span className="italic">one surprise</span>
              </h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-[#5A4330] sm:text-base">
                Buy any 2 drinks, get a fragrance-tag blind box — 10 designs, 10
                scents.
              </p>
            </div>
            <span
              className="inline-flex w-fit items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white transition group-hover:opacity-90"
              style={{ backgroundColor: BRAND.primaryColor }}
            >
              Order now →
            </span>
          </div>

          {/* Right — fanned blind-box teaser (3 of 10 tags) */}
          <div
            className="relative w-[104px] shrink-0 self-center sm:w-[168px]"
            style={{ height: "152px" }}
            aria-hidden
          >
            {TAGS.map((t) => (
              <span
                key={t.src}
                className="absolute h-[64px] w-[64px] overflow-hidden rounded-[10px] bg-white shadow-md sm:h-[92px] sm:w-[92px]"
                style={{ top: t.top, right: t.right, transform: `rotate(${t.rotate})` }}
              >
                <Image
                  src={t.src}
                  alt=""
                  width={184}
                  height={184}
                  className="h-full w-full object-cover"
                />
              </span>
            ))}
          </div>
        </Link>
      </div>
    </section>
  );
}
