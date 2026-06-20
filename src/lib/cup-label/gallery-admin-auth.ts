import "server-only";

export function isAuthedGalleryAdmin(
  request: Request,
): { ok: true } | { ok: false; reason: "unauthorized" | "unconfigured" } {
  const expected = process.env.GALLERY_ADMIN_TOKEN;
  if (!expected) return { ok: false, reason: "unconfigured" };
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token && token === expected) return { ok: true };
  return { ok: false, reason: "unauthorized" };
}
