import { notFound } from "next/navigation";
import { CategoryArt } from "@/components/brand/CategoryArt";
import { CheckoutHero } from "@/components/brand/CheckoutHero";
import { CategoryBanner } from "@/components/menu/CategoryBanner";
import { CATEGORY_ART_TINT, type CategoryArtKind } from "@/lib/menu/category-art";
import { resolveCupVisual } from "@/lib/menu/cup-visual";
import { extraCups, orderCups } from "@/lib/menu/order-cups";

/** Dev-only gallery of the App's illustrations on the web: the nine category
 *  drawings in both crops, the menu banner they sit in, and the two checkout
 *  heroes with a made-up order in them (404s in production). */

const KINDS: { kind: CategoryArtKind; name: string; count: number }[] = [
  { kind: "specials", name: "Weekly Specials", count: 2 },
  { kind: "top10", name: "TOP 10", count: 10 },
  { kind: "milk", name: "MILK TEA", count: 14 },
  { kind: "green", name: "FRUITY GREEN TEA", count: 12 },
  { kind: "black", name: "FRUITY BLACK TEA", count: 9 },
  { kind: "brew", name: "FRESH BREW", count: 6 },
  { kind: "frozen", name: "FROZEN", count: 7 },
  { kind: "cheese", name: "CHEESE CREAM", count: 8 },
  { kind: "mix", name: "SPECIAL MIX", count: 5 },
];

const CART = [
  {
    name: "Brown Sugar Pearl Milk Tea",
    quantity: 1,
    modifiers: [{ name: "Pearl" }, { name: "Normal Ice" }, { name: "70% Sugar" }],
  },
  {
    name: "Matcha Latte",
    quantity: 2,
    modifiers: [{ name: "Red Bean" }, { name: "Less Ice" }, { name: "Oat Milk" }],
  },
  {
    name: "Strawberry Cheese Cream",
    quantity: 3,
    modifiers: [{ name: "Cheese Cream" }, { name: "Coconut Jelly" }, { name: "Normal Ice" }],
  },
];

const SOLO = [
  {
    name: "Taro Milk Tea",
    quantity: 1,
    modifiers: [{ name: "Pearl" }, { name: "Normal Ice" }, { name: "100% Sugar" }],
  },
];

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-14">
      <h2 className="font-serif text-[26px] font-semibold tracking-[-0.02em] text-ink">
        {title}
      </h2>
      {note && <p className="mb-4 mt-1 text-[13.5px] text-ink3">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function CategoryArtPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const cups = orderCups(CART);
  const extra = extraCups(CART);
  const solo = orderCups(SOLO);

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-brand">
        Dev preview
      </p>
      <h1 className="mb-2 mt-2 font-serif text-[38px] font-semibold tracking-[-0.03em] text-ink">
        The App&apos;s drawings, on the web
      </h1>
      <p className="mb-10 max-w-[560px] text-[14.5px] leading-relaxed text-ink2">
        Nine living category illustrations and the two checkout heroes, ported
        from the App (#135–#140). Every moving part runs off one shared rAF
        ticker; Reduce Motion and anything scrolled off screen hold frame zero.
      </p>

      <Panel
        title="Menu section heads"
        note="What each family looks like at the top of its section on /menu."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {KINDS.map((k) => (
            <CategoryBanner
              key={k.kind}
              name={k.name}
              count={k.count}
              note={k.kind === "specials" ? "this week only" : undefined}
            />
          ))}
        </div>
      </Panel>

      <Panel
        title="Home tiles"
        note="The tile crop (26 0 190 100, sliced) — the loose piece under the label is dropped."
      >
        <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          {KINDS.map((k) => (
            <div key={k.kind}>
              <div
                className="aspect-[1.9] overflow-hidden rounded-[14px] shadow-[var(--shadow-card-v)]"
                style={{ backgroundColor: CATEGORY_ART_TINT[k.kind] }}
              >
                <CategoryArt kind={k.kind} crop="tile" />
              </div>
              <p className="mt-2 truncate font-serif text-[15px] font-semibold text-ink">
                {k.name}
              </p>
              <p className="mt-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink3">
                {k.count} drinks
              </p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Checkout heroes"
        note="The customer's own cups: liquid colour, ice, toppings and foam come from cup-visual, capped at four with the rest counted on the ticket."
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-ink3">
              Pickup · 6 cups
            </p>
            <CheckoutHero
              kind="pickup"
              cups={cups}
              extra={extra}
              className="rounded-card border border-line"
            />
          </div>
          <div>
            <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-ink3">
              Delivery · 6 cups
            </p>
            <CheckoutHero
              kind="delivery"
              cups={cups}
              className="rounded-card border border-line"
            />
          </div>
          <div>
            <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-ink3">
              Pickup · one cup
            </p>
            <CheckoutHero
              kind="pickup"
              cups={solo}
              className="rounded-card border border-line"
            />
          </div>
          <div>
            <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-ink3">
              Delivery · one cup
            </p>
            <CheckoutHero
              kind="delivery"
              cups={solo}
              className="rounded-card border border-line"
            />
          </div>
        </div>
      </Panel>

      <Panel title="The cup, straight from cup-visual" note="Sanity check on the mapper the heroes share with the item sheet.">
        <pre className="overflow-x-auto rounded-card border border-line bg-card p-4 font-mono text-[11px] leading-relaxed text-ink2">
          {JSON.stringify(
            resolveCupVisual({
              drinkName: CART[0].name,
              picked: CART[0].modifiers.map((m) => ({ name: m.name, count: 1 })),
            }),
            null,
            2,
          )}
        </pre>
      </Panel>
    </main>
  );
}
