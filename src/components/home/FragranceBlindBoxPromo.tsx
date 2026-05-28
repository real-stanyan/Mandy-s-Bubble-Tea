import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/constants";

// Limited-time campaign card: "Buy 2 drinks, get a fragrance-tag blind
// box." Marketing only — the blind box is handed out in-store at pickup,
// so this is a static server component that links to the menu. Visual
// treatment mirrors DailySpecial / the peach welcome cards. Gated by
// FRAGRANCE_BLIND_BOX_PROMO in page.tsx — flip that to retire it.

// Background-removed cut-outs (transparent PNG) so each hanging tag shows
// in full on the gradient. width/height are the baked intrinsic sizes;
// laid out as a left→right fan so all three read clearly.
const TAGS = [
  { src: "/image/promo/fragrance-tags/black-opium.png", w: 417, h: 520, rotate: "-10deg", z: 1 },
  { src: "/image/promo/fragrance-tags/ocean.png", w: 335, h: 520, rotate: "0deg", z: 3 },
  { src: "/image/promo/fragrance-tags/crisp-apple.png", w: 469, h: 520, rotate: "10deg", z: 2 },
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

          {/* Right — blind-box teaser: 3 of the 10 hanging tags, background
              removed so each shows in full, fanned left→right on the gradient. */}
          <div className="flex shrink-0 items-end justify-center -space-x-5 self-center sm:-space-x-6">
            {TAGS.map((t) => (
              <Image
                key={t.src}
                src={t.src}
                alt=""
                width={t.w}
                height={t.h}
                className="h-[88px] w-auto sm:h-[128px]"
                style={{
                  transform: `rotate(${t.rotate})`,
                  zIndex: t.z,
                  filter: "drop-shadow(0 6px 8px rgba(42,30,20,0.30))",
                }}
              />
            ))}
          </div>
        </Link>
      </div>
    </section>
  );
}
