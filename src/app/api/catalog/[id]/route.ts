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
    const imageIds =
      obj.type === "ITEM"
        ? ((obj as Record<string, unknown>).itemData as Record<string, unknown> | undefined)?.imageIds as string[] | undefined
        : undefined;

    if (imageIds?.length && res.relatedObjects) {
      for (const rel of res.relatedObjects) {
        if (rel.type === "IMAGE" && rel.id && imageIds.includes(rel.id)) {
          const imgData = (rel as Record<string, unknown>).imageData as
            | { url?: string }
            | undefined;
          if (imgData?.url) {
            imageUrl = imgData.url;
            break;
          }
        }
      }
    }

    const serialized = serializeSquareResponse(obj);
    if (imageUrl) {
      serialized.imageUrl = imageUrl;
    }

    return NextResponse.json({ ok: true, item: serialized });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
