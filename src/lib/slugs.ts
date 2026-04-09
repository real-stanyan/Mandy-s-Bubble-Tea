// Convert a human-readable Square category name (e.g. "Fruity Black Tea")
// into a URL-safe slug (e.g. "fruity-black-tea"). Pure, deterministic,
// no dependency on the predefined category list — whatever Square returns
// gets slugified consistently, so the data layer does not need to be
// updated when new categories are added in the Square dashboard.

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumerics → dash
    .replace(/^-+|-+$/g, ""); // trim leading/trailing dashes
}
