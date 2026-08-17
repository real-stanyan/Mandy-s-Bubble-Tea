import { describe, it, expect, vi, beforeEach } from "vitest";

const getAuthedUser = vi.fn();
const openMysteryBox = vi.fn();
vi.mock("@/lib/auth", () => ({ getAuthedUser }));
vi.mock("@/lib/mystery-box", () => ({ openMysteryBox }));

const { POST } = await import("./route");

const req = () =>
  new Request("http://localhost/api/chat/mystery-box/open", { method: "POST" });

beforeEach(() => {
  getAuthedUser.mockReset();
  openMysteryBox.mockReset();
  getAuthedUser.mockResolvedValue({
    userId: "u1",
    profile: { phone_e164: "+61400000001", square_customer_id: "C1" },
  });
});

describe("POST /api/chat/mystery-box/open", () => {
  it("requires sign-in — the coupon needs an account to live in", async () => {
    getAuthedUser.mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect((await res.json()).signIn).toBe(true);
    expect(openMysteryBox).not.toHaveBeenCalled();
  });

  it("returns the drawn prize on a successful open", async () => {
    openMysteryBox.mockResolvedValue({
      opened: true,
      couponId: "abc",
      prize: "free_topping",
      label: "Free Topping",
      expiresAt: "2026-08-31T00:00:00.000Z",
    });
    const res = await POST(req());
    const body = await res.json();
    expect(openMysteryBox).toHaveBeenCalledWith("+61400000001", "C1");
    expect(body).toMatchObject({ ok: true, prize: "free_topping", couponId: "abc" });
  });

  it("reports already-today as a fact (200), unavailable as a failure (503)", async () => {
    openMysteryBox.mockResolvedValue({ opened: false, reason: "already-today" });
    const res1 = await POST(req());
    expect(res1.status).toBe(200);
    expect((await res1.json()).reason).toBe("already-today");

    openMysteryBox.mockResolvedValue({ opened: false, reason: "unavailable" });
    const res2 = await POST(req());
    expect(res2.status).toBe(503);
  });
});
