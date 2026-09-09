import { describe, expect, it } from "vitest";
import { editCategorySlugFor, type MenuShelves } from "@/lib/menu/edit-category";
import { TOP10_CATEGORY_SLUG } from "@/lib/menu/top10-presets";
import { WEEKLY_SPECIALS_CATEGORY_SLUG } from "@/lib/menu/weekly-specials";

// Taro lives in milk-tea, is curated into TOP 10 and is on special this week;
// Mango is a TOP 10 + fruit-tea drink; Solo only exists inside TOP 10.
const menu: MenuShelves = {
  categories: [
    { slug: WEEKLY_SPECIALS_CATEGORY_SLUG },
    { slug: TOP10_CATEGORY_SLUG },
    { slug: "milk-tea" },
    { slug: "fruit-tea" },
  ],
  itemsBySlug: new Map([
    [WEEKLY_SPECIALS_CATEGORY_SLUG, [{ id: "TARO" }]],
    [TOP10_CATEGORY_SLUG, [{ id: "TARO" }, { id: "MANGO" }, { id: "SOLO" }]],
    ["milk-tea", [{ id: "TARO" }, { id: "OOLONG" }]],
    ["fruit-tea", [{ id: "MANGO" }]],
  ]),
};

describe("editCategorySlugFor", () => {
  it("reopens a line wearing a TOP 10 display name inside TOP 10", () => {
    expect(editCategorySlugFor(menu, "TARO", "Taro Milk Tea (with Pudding)")).toBe(
      TOP10_CATEGORY_SLUG,
    );
  });

  it("sends the plain drink to its home category, past the specials shelf", () => {
    expect(editCategorySlugFor(menu, "TARO", "Taro Milk Tea")).toBe("milk-tea");
  });

  it("falls back to the home category when no line name is known", () => {
    expect(editCategorySlugFor(menu, "MANGO", null)).toBe("fruit-tea");
  });

  it("keeps a TOP 10-only drink in TOP 10 even under its plain name", () => {
    expect(editCategorySlugFor(menu, "SOLO", "Solo")).toBe(TOP10_CATEGORY_SLUG);
  });

  it("returns null for a drink the catalog no longer has", () => {
    expect(editCategorySlugFor(menu, "GONE", "Anything")).toBeNull();
  });
});
