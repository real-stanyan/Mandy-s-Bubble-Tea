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
    <div className="mx-4 mt-6 mb-2 rounded-card border border-line bg-paper p-3.5 shadow-card">
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
        <div className="relative w-full overflow-hidden rounded-tile bg-sage" style={{ height: 96 }}>
          <Image
            src={banner}
            alt={title}
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            className="object-cover"
          />
          <div
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(42,30,20,0.06)" }}
          />
        </div>
      )}
    </div>
  );
}
