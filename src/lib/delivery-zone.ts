import { DELIVERABLE_POSTCODES } from "./constants";

// Delivery zone is defined by an explicit postcode allow-list (replaces the
// old straight-line radius gate). The list lives in constants; this module
// owns the membership test and the Google Places postcode extraction.

const ALLOWED = new Set<string>(DELIVERABLE_POSTCODES);

export function isDeliverablePostcode(pc: string | null | undefined): boolean {
  if (!pc) return false;
  return ALLOWED.has(pc.trim());
}

type AddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

// Pull the postcode from Google Places `address_components`. Returns the
// `postal_code` component's long_name, or null when absent.
export function extractPostcode(
  components: AddressComponent[] | undefined | null,
): string | null {
  if (!components || components.length === 0) return null;
  const match = components.find((c) => c.types?.includes("postal_code"));
  return match?.long_name ?? null;
}
