import type { Metadata } from "next";
import Link from "next/link";
import { ItemDetailContent } from "@/components/menu/ItemDetailContent";

// Full-route fallback for editing a cart line from /checkout. Client
// navigation is intercepted by @modal/(.)menu/edit/[item] and shows the same
// body in the item modal over the checkout page; a hard load or refresh of
// the URL lands here instead. The line itself lives in the browser cart, so it
// travels as ?line=<line id>&name=<line name> — the server only works out
// which category to open the drink under (see lib/menu/edit-category).
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Edit your drink" };

type PageProps = {
  params: Promise<{ item: string }>;
  searchParams: Promise<{ line?: string; name?: string }>;
};

export default async function EditLinePage({ params, searchParams }: PageProps) {
  const { item: itemId } = await params;
  const { line, name } = await searchParams;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/checkout"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink2 transition hover:text-ink sm:mb-6"
      >
        ← Back to checkout
      </Link>
      <ItemDetailContent
        itemId={itemId}
        edit={{ lineId: line ?? null, lineName: name ?? null }}
      />
    </main>
  );
}
