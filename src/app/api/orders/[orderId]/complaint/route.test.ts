import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getAuthedUser: vi.fn() }));
vi.mock("@/lib/square", () => ({
  squareClient: { orders: { get: vi.fn() }, customers: { get: vi.fn() } },
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/email/resend", () => ({
  getResendClient: vi.fn(),
  COMPLAINT_TO_EMAIL: "hello@mandybubbletea.com",
  COMPLAINT_FROM_EMAIL: "noreply@mandybubbletea.com",
}));
vi.mock("@/lib/photo-compress", () => ({
  compressForEmail: vi.fn(),
}));

import { POST } from "./route";
import { getAuthedUser } from "@/lib/auth";
import { squareClient } from "@/lib/square";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getResendClient } from "@/lib/email/resend";
import { compressForEmail } from "@/lib/photo-compress";

const ORDER = {
  id: "ord_abc",
  state: "COMPLETED",
  customerId: "CUST_OWN",
  closedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
  ticketName: "OL999",
  lineItems: [
    {
      name: "Pearl Milk Tea",
      quantity: "1",
      basePriceMoney: { amount: BigInt(700), currency: "AUD" },
      variationName: "Large",
    },
  ],
  totalMoney: { amount: BigInt(700), currency: "AUD" },
};

function makeRequest(form: FormData, orderId = "ord_abc") {
  return {
    request: new Request(`http://test/api/orders/${orderId}/complaint`, {
      method: "POST",
      body: form,
    }),
    context: { params: Promise.resolve({ orderId }) },
  };
}

function setupHappyPathMocks(
  opts: {
    existingComplaint?: boolean;
    existingStatus?: "pending" | "sent" | "failed";
    saveError?: { message: string } | null;
  } = {},
) {
  (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "u1",
    email: "stan@example.com",
    phone: "+61412345678",
    profile: {
      user_id: "u1",
      square_customer_id: "CUST_OWN",
      first_name: "Stan",
      last_name: "Yan",
      phone_e164: "+61412345678",
    },
  });
  (squareClient.orders.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    order: ORDER,
  });
  (squareClient.customers.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    customer: { givenName: "Stan", familyName: "Yan", phoneNumber: "+61412345678", emailAddress: "stan@example.com" },
  });
  (compressForEmail as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (_buf: Buffer, _mime: string, idx: number) => ({
      buffer: Buffer.from("compressed"),
      filename: `photo-${idx + 1}.jpg`,
      mimeType: "image/jpeg",
    }),
  );

  const existing = opts.existingComplaint
    ? { id: "row1", status: opts.existingStatus ?? "sent" }
    : null;

  const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null });
  const selectEq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq: selectEq });
  const upsert = vi.fn().mockResolvedValue({ error: opts.saveError ?? null });
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  (getSupabaseAdmin as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn().mockReturnValue({ select, upsert, update }),
  });

  const send = vi.fn().mockResolvedValue({ data: { id: "msg_123" }, error: null });
  (getResendClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    emails: { send },
  });

  return { send, upsert, update };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST complaint", () => {
  it("401 when no session", async () => {
    (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(401);
  });

  it("403 when order belongs to another customer", async () => {
    setupHappyPathMocks();
    (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "u1",
      profile: { square_customer_id: "CUST_OTHER", first_name: "Stan", last_name: "Yan" },
    });
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(403);
  });

  it("409 when order not COMPLETED", async () => {
    setupHappyPathMocks();
    (squareClient.orders.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      order: { ...ORDER, state: "OPEN" },
    });
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(409);
  });

  it("410 when window closed", async () => {
    setupHappyPathMocks();
    (squareClient.orders.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      order: {
        ...ORDER,
        closedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(410);
  });

  it("409 when already reported", async () => {
    setupHappyPathMocks({ existingComplaint: true });
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("ALREADY_REPORTED");
  });

  it("422 when description < 10 chars", async () => {
    setupHappyPathMocks();
    const fd = new FormData();
    fd.set("description", "short");
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("INVALID_INPUT");
    expect(json.reason).toBe("DESCRIPTION_TOO_SHORT");
  });

  it("422 when more than 3 photos", async () => {
    setupHappyPathMocks();
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    for (let i = 0; i < 4; i++) {
      fd.append("photos", new File([new Uint8Array(1000)], `p${i}.jpg`, { type: "image/jpeg" }));
    }
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(422);
  });

  it("422 when a photo exceeds 8 MB", async () => {
    setupHappyPathMocks();
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    fd.append("photos", new File([new Uint8Array(9 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" }));
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(422);
  });

  it("422 when MIME not allowed", async () => {
    setupHappyPathMocks();
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    fd.append("photos", new File([new Uint8Array(100)], "x.pdf", { type: "application/pdf" }));
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(422);
  });

  it("502 when Resend fails — but the complaint is kept, marked failed", async () => {
    // The whole point of #132: the customer still gets an error, and the shop
    // still ends up with a record of what they said. Previously a failed send
    // left nothing at all.
    const mocks = setupHappyPathMocks();
    mocks.send.mockResolvedValueOnce({ data: null, error: { message: "Service unavailable" } });
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(502);

    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.upsert.mock.calls[0][0]).toMatchObject({
      order_id: "ord_abc",
      description: "Pearls were hard, drink off.",
      status: "pending",
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ status: "failed" });
  });

  it("records the complaint before attempting the send", async () => {
    // Ordering is the fix. Written after the send, a provider outage erases
    // the complaint; written before, it survives one.
    const order: string[] = [];
    const mocks = setupHappyPathMocks();
    mocks.upsert.mockImplementation(async () => {
      order.push("save");
      return { error: null };
    });
    mocks.send.mockImplementation(async () => {
      order.push("send");
      return { data: { id: "m" }, error: null };
    });
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    const { request, context } = makeRequest(fd);
    await POST(request, context);
    expect(order).toEqual(["save", "send"]);
  });

  it("still sends when the complaint could not be recorded", async () => {
    // Refusing here would swap "only in the email" for "cannot complain at
    // all" — delivery is the point.
    const mocks = setupHappyPathMocks({ saveError: { message: "db down" } });
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("lets the customer retry after a failed send", async () => {
    // Their own failed attempt must not answer every retry with
    // ALREADY_REPORTED.
    const mocks = setupHappyPathMocks({
      existingComplaint: true,
      existingStatus: "failed",
    });
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("lets the customer retry when a previous attempt is stuck pending", async () => {
    // A function that timed out mid-send leaves the row pending forever.
    // Treating that as "already reported" would lock them out permanently.
    const mocks = setupHappyPathMocks({
      existingComplaint: true,
      existingStatus: "pending",
    });
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("happy path: 200, Resend called, complaint recorded and marked sent", async () => {
    const mocks = setupHappyPathMocks();
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    fd.append("photos", new File([new Uint8Array(2 * 1024 * 1024)], "p.jpg", { type: "image/jpeg" }));
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ status: "sent" });
    const sendArg = mocks.send.mock.calls[0][0];
    expect(sendArg.to).toBe("hello@mandybubbletea.com");
    expect(sendArg.replyTo).toBe("stan@example.com");
    expect(sendArg.subject).toContain("OL999");
    expect(sendArg.attachments).toHaveLength(1);
  });
});
