import Link from "next/link";
import { getMenu, type Menu } from "@/lib/catalog";
import { BRAND } from "@/lib/constants";
import { CartIcon } from "@/components/cart/CartIcon";

// Menu landing page — 2/3-col category grid. Empty categories are
// shown greyed out with a "Coming soon" label so the structure is
// visible even when the shop hasn't stocked that category yet.

export const revalidate = 300;

async function loadMenu(): Promise<
  { ok: true; menu: Menu } | { ok: false; error: string }
> {
  try {
    const menu = await getMenu();
    return { ok: true, menu };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export default async function MenuPage() {
  const result = await loadMenu();

  return (
    <div className="flex flex-1 flex-col">
      <header
        className="w-full px-6 py-8 text-white"
        style={{ backgroundColor: BRAND.primaryColor }}
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-2">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-sm opacity-80 hover:opacity-100">
              ← Home
            </Link>
            <CartIcon />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Menu</h1>
          <p className="text-sm opacity-90">Pick a category to get started.</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {!result.ok ? (
          <ErrorState message={result.error} />
        ) : result.menu.categories.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {result.menu.categories.map((cat) => {
              const empty = cat.itemCount === 0;
              const content = (
                <div
                  className={`relative flex aspect-square flex-col justify-end overflow-hidden rounded-lg border shadow-sm transition ${
                    empty
                      ? "cursor-not-allowed border-black/5 bg-zinc-50 opacity-60"
                      : "border-black/10 bg-white hover:shadow-md"
                  }`}
                  style={
                    empty
                      ? undefined
                      : { borderColor: `${BRAND.primaryColor}22` }
                  }
                >
                  {cat.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={cat.imageUrl}
                      alt={cat.squareName}
                      className="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                  {/* Text overlay — gradient ensures legibility over images */}
                  <div
                    className={`relative flex h-full flex-col justify-between p-4 ${
                      cat.imageUrl
                        ? "bg-gradient-to-t from-black/70 via-black/20 to-transparent text-white"
                        : ""
                    }`}
                  >
                    <div>
                      <h2
                        className={`text-lg font-semibold leading-tight ${
                          cat.imageUrl ? "text-white" : "text-zinc-900"
                        }`}
                      >
                        {cat.squareName}
                      </h2>
                      {empty ? (
                        <p className="mt-1 text-xs uppercase tracking-wide text-zinc-400">
                          Coming soon
                        </p>
                      ) : (
                        <p
                          className={`mt-1 text-xs uppercase tracking-wide ${
                            cat.imageUrl ? "text-white/80" : "text-zinc-500"
                          }`}
                        >
                          {cat.itemCount}{" "}
                          {cat.itemCount === 1 ? "item" : "items"}
                        </p>
                      )}
                    </div>
                    {!empty && (
                      <p
                        className="text-sm font-medium"
                        style={
                          cat.imageUrl
                            ? { color: "white" }
                            : { color: BRAND.primaryColor }
                        }
                      >
                        View →
                      </p>
                    )}
                  </div>
                </div>
              );

              return (
                <li key={cat.id}>
                  {empty ? (
                    content
                  ) : (
                    <Link href={`/menu/${cat.slug}`} className="block">
                      {content}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {result.ok && result.menu.uncategorizedItems.length > 0 && (
          <p className="mt-6 text-xs text-zinc-400">
            {result.menu.uncategorizedItems.length} item(s) without a category
            are hidden.
          </p>
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-black/20 p-12 text-center">
      <p className="text-zinc-600">No categories found.</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6">
      <p className="font-semibold text-red-800">Could not load menu</p>
      <p className="mt-2 font-mono text-sm text-red-700">{message}</p>
    </div>
  );
}
