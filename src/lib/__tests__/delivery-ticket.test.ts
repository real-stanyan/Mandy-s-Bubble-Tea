import { describe, it, expect } from "vitest";
import { deliveryFulfillmentNote } from "../delivery-ticket";

describe("deliveryFulfillmentNote", () => {
  it("leads with the truck marker + address so staff see where to drive", () => {
    const note = deliveryFulfillmentNote({
      address: "12 Smith St, Southport QLD 4215",
      phone: "+61426040093",
    });
    expect(note.startsWith("🚚 DELIVERY · 12 Smith St, Southport QLD 4215")).toBe(true);
    expect(note).toContain("+61426040093");
  });

  it("includes driver + order notes when present", () => {
    const note = deliveryFulfillmentNote({
      address: "1 A St",
      phone: "+61400000000",
      driverNote: "gate code 1234",
      orderNote: "less ice",
    });
    expect(note).toContain("gate code 1234");
    expect(note).toContain("less ice");
  });

  it("omits empty optional fields with no dangling separators", () => {
    const note = deliveryFulfillmentNote({ address: "1 A St", phone: "+61400000000" });
    expect(note).toBe("🚚 DELIVERY · 1 A St · +61400000000");
  });
});
