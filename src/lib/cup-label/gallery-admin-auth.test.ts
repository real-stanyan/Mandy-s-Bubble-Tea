import { describe, it, expect, afterEach } from "vitest";
import { isAuthedGalleryAdmin } from "./gallery-admin-auth";

function req(token?: string) {
  return new Request("http://x", token ? { headers: { authorization: `Bearer ${token}` } } : {});
}
afterEach(() => { delete process.env.GALLERY_ADMIN_TOKEN; });

describe("isAuthedGalleryAdmin", () => {
  it("unconfigured when env missing", () => {
    expect(isAuthedGalleryAdmin(req("x"))).toEqual({ ok: false, reason: "unconfigured" });
  });
  it("ok with matching bearer token", () => {
    process.env.GALLERY_ADMIN_TOKEN = "secret";
    expect(isAuthedGalleryAdmin(req("secret"))).toEqual({ ok: true });
  });
  it("unauthorized with wrong token", () => {
    process.env.GALLERY_ADMIN_TOKEN = "secret";
    expect(isAuthedGalleryAdmin(req("nope"))).toEqual({ ok: false, reason: "unauthorized" });
  });
});
