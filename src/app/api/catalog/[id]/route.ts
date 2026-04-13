import { NextResponse } from "next/server";
import { squareClient } from "@/lib/square";
import { serializeSquareResponse } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const res = await squareClient.catalog.batchGet({
      objectIds: [id],
      includeRelatedObjects: true,
    });

    const obj = res.objects?.[0];
    if (!obj) {
      return NextResponse.json(
        { ok: false, error: "Item not found" },
        { status: 404 },
      );
    }

    // Resolve image URL from related objects
    let imageUrl: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itemData = (obj as any).itemData;
    const imageIds: string[] | undefined = itemData?.imageIds;

    if (imageIds?.length && res.relatedObjects) {
      for (const rel of res.relatedObjects) {
        if (rel.type === "IMAGE" && rel.id && imageIds.includes(rel.id)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const imgUrl = (rel as any).imageData?.url as string | undefined;
          if (imgUrl) {
            imageUrl = imgUrl;
            break;
          }
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const serialized = serializeSquareResponse(obj) as any;
    if (imageUrl) {
      serialized.imageUrl = imageUrl;
    }

    return NextResponse.json({ ok: true, item: serialized });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
