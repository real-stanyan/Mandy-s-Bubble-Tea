// printer-client/src/cup-label/storage.ts
import { supabase } from "../supabase";
import { config } from "../config";

/**
 * Download a rendered ZPL text file from Supabase Storage. The web
 * server uploads one `.zpl` per cup at `<orderId>/<lineId>_<cupIdx>.zpl`
 * under the `doodles` bucket (configurable via CUP_LABEL_STORAGE_BUCKET).
 *
 * Throws on download error or empty body — caller maps that to a
 * job failure with the error message stored in `last_error`.
 */
export async function downloadRasterZPL(rasterPath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(config.cupLabelStorageBucket)
    .download(rasterPath);
  if (error) {
    throw new Error(`storage download ${rasterPath} failed: ${error.message}`);
  }
  if (!data) {
    throw new Error(`storage download ${rasterPath} returned empty body`);
  }
  const text = await data.text();
  if (!text || text.length === 0) {
    throw new Error(`storage download ${rasterPath} returned 0-byte ZPL`);
  }
  return text;
}
