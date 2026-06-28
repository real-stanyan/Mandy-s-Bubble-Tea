import { describe, it, expect } from "vitest";
import { pickActiveCardTender, hasAnyCardTender } from "./order-tender";

const t = (status: string | null, id = status) => ({
  id,
  cardDetails: status ? { status } : null,
});

describe("pickActiveCardTender", () => {
  it("prefers AUTHORIZED over a leading FAILED tender (the DE831 bug)", () => {
    const tenders = [t("FAILED", "pay-fail"), t("AUTHORIZED", "pay-ok")];
    expect(pickActiveCardTender(tenders)?.id).toBe("pay-ok");
  });

  it("returns the AUTHORIZED tender regardless of order", () => {
    expect(pickActiveCardTender([t("AUTHORIZED", "a"), t("FAILED", "f")])?.id).toBe("a");
  });

  it("falls back to CAPTURED when no AUTHORIZED present", () => {
    expect(pickActiveCardTender([t("FAILED"), t("CAPTURED", "cap")])?.id).toBe("cap");
  });

  it("prefers AUTHORIZED over CAPTURED if both somehow present", () => {
    expect(pickActiveCardTender([t("CAPTURED", "cap"), t("AUTHORIZED", "auth")])?.id).toBe("auth");
  });

  it("returns undefined when every tender is FAILED/VOIDED", () => {
    expect(pickActiveCardTender([t("FAILED"), t("VOIDED")])).toBeUndefined();
  });

  it("returns undefined for a $0 order with no card tender", () => {
    expect(pickActiveCardTender([])).toBeUndefined();
    expect(pickActiveCardTender(undefined)).toBeUndefined();
  });
});

describe("hasAnyCardTender", () => {
  it("true when any card tender exists, even all failed", () => {
    expect(hasAnyCardTender([t("FAILED"), t("VOIDED")])).toBe(true);
  });
  it("false for $0 / empty", () => {
    expect(hasAnyCardTender([])).toBe(false);
    expect(hasAnyCardTender(undefined)).toBe(false);
  });
});
