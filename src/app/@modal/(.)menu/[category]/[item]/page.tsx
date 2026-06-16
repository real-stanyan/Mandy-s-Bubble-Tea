import { ItemModal } from "@/components/menu/ItemModal";
import { ItemDetailContent } from "@/components/menu/ItemDetailContent";

// Intercepting route: when a product link is clicked via client navigation,
// this slot renders the item detail in a modal over the current page. A direct
// load / refresh of /menu/[category]/[item] bypasses interception and renders
// the full route page instead (the @modal slot falls back to default.tsx).
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ category: string; item: string }>;
};

export default async function ItemModalPage({ params }: Props) {
  const { category, item } = await params;
  return (
    <ItemModal>
      <ItemDetailContent categorySlug={category} itemId={item} inModal />
    </ItemModal>
  );
}
