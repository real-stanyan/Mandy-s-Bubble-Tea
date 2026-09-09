import { ItemModal } from "@/components/menu/ItemModal";
import { ItemDetailContent } from "@/components/menu/ItemDetailContent";

// Intercepting route for the checkout page's "Edit": the drink opens in the
// item modal over /checkout, pre-filled from the cart line named in the query
// (?line=<line id>&name=<line name>), and dismissing it lands back on
// checkout. A direct load of /menu/edit/[item] renders the full page instead.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ item: string }>;
  searchParams: Promise<{ line?: string; name?: string }>;
};

export default async function EditLineModalPage({ params, searchParams }: Props) {
  const { item } = await params;
  const { line, name } = await searchParams;
  return (
    <ItemModal>
      <ItemDetailContent
        itemId={item}
        inModal
        edit={{ lineId: line ?? null, lineName: name ?? null }}
      />
    </ItemModal>
  );
}
