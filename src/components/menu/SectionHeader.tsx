import Image from "next/image";

const BANNERS: Record<string, string> = {
  milktea: "/categories/milky.webp",
  milky: "/categories/milky.webp",
  fruitygreentea: "/categories/fruity.webp",
  fruity: "/categories/fruity.webp",
  specialmix: "/categories/special-mix.webp",
  freshbrew: "/categories/fresh-brew.webp",
  fruityblacktea: "/categories/fruity-black-tea.webp",
  frozen: "/categories/frozen.webp",
  cheesecream: "/categories/cheese-cream.webp",
};

function categoryBanner(name: string): string | null {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return BANNERS[key] ?? null;
}

type SectionHeaderProps = {
  title: string;
};

export function SectionHeader({ title }: SectionHeaderProps) {
  const banner = categoryBanner(title);
  return (
    <div className="mx-4 mt-6 mb-2 rounded-card border border-line bg-paper p-3.5 shadow-card lg:mx-0">
      <h2
        className="font-serif text-ink"
        style={{
          fontSize: 22,
          lineHeight: "26px",
          letterSpacing: -0.3,
          fontWeight: 500,
          marginTop: 2,
          marginBottom: banner ? 10 : 0,
        }}
      >
        {title}
      </h2>
      {banner && (
        <div
          className="relative w-full overflow-hidden rounded-tile bg-sage"
          style={{ aspectRatio: "1600 / 678" }}
        >
          <Image
            src={banner}
            alt={title}
            fill
            sizes="(max-width: 768px) 100vw, 900px"
            className="object-cover"
          />
        </div>
      )}
    </div>
  );
}
