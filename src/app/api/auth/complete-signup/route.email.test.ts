import { describe, it, expect, vi, beforeEach } from "vitest";

// Verifies the email collected in the "Create account" form is wired
// through to the Square customer record (create path) and backfilled
// onto a linked legacy customer that has none (update path).

const mockGetAuthedUser = vi.fn();
const mockFindCustomerByPhone = vi.fn();
const mockEnsureReferenceId = vi.fn();
const mockCustomersCreate = vi.fn();
const mockCustomersUpdate = vi.fn();
const mockCustomersGet = vi.fn();
const mockGrantWelcome = vi.fn();
const mockPurgeAccount = vi.fn();
const mockFindOrCreateLoyalty = vi.fn();

// Supabase admin upsert chain → returns the persisted profile row.
const mockSingle = vi.fn();
const mockGetAdmin = vi.fn(() => ({
  from: () => ({
    upsert: () => ({
      select: () => ({ single: mockSingle }),
    }),
  }),
}));

vi.mock("@/lib/auth", () => ({
  getAuthedUser: (req: Request) => mockGetAuthedUser(req),
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: () => mockGetAdmin(),
}));
vi.mock("@/lib/square", () => ({
  squareClient: {
    customers: {
      create: (args: unknown) => mockCustomersCreate(args),
      update: (args: unknown) => mockCustomersUpdate(args),
      get: (args: unknown) => mockCustomersGet(args),
    },
  },
  ensureReferenceId: (...a: unknown[]) => mockEnsureReferenceId(...a),
  findCustomerByPhone: (e164: string) => mockFindCustomerByPhone(e164),
}));
vi.mock("@/lib/supabase", () => ({
  grantWelcomeDiscount: (...a: unknown[]) => mockGrantWelcome(...a),
  purgeAccount: (...a: unknown[]) => mockPurgeAccount(...a),
}));
vi.mock("@/lib/loyalty", () => ({
  findOrCreateLoyaltyAccount: (...a: unknown[]) => mockFindOrCreateLoyalty(...a),
}));

import { POST } from "./route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/auth/complete-signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthedUser.mockResolvedValue({
    userId: "u1",
    email: null, // phone-OTP session has no email
    phone: "+61404123456",
    profile: null,
  });
  mockSingle.mockResolvedValue({
    data: {
      user_id: "u1",
      square_customer_id: "cust_new",
      phone_e164: "+61404123456",
      first_name: "Mandy",
      last_name: "Zhang",
      square_verified_at: "2026-06-16T00:00:00Z",
      signup_channel: "web",
    },
    error: null,
  });
  mockGrantWelcome.mockResolvedValue(undefined);
  mockFindOrCreateLoyalty.mockResolvedValue(undefined);
});

describe("complete-signup email wiring", () => {
  it("passes the typed email to a newly created Square customer", async () => {
    mockFindCustomerByPhone.mockResolvedValue(null);
    mockCustomersCreate.mockResolvedValue({ customer: { id: "cust_new" } });

    const res = await POST(
      req({ firstName: "Mandy", lastName: "Zhang", email: "Mandy@Email.COM" }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
    expect(mockCustomersCreate.mock.calls[0][0]).toMatchObject({
      emailAddress: "mandy@email.com", // normalized
      phoneNumber: "+61404123456",
      givenName: "Mandy",
    });
  });

  it("backfills email onto a linked customer that has none", async () => {
    mockFindCustomerByPhone.mockResolvedValue({
      id: "cust_legacy",
      emailAddress: null,
      referenceId: "+61404123456",
    });
    mockCustomersUpdate.mockResolvedValue({});

    const res = await POST(
      req({ firstName: "Mandy", email: "new@example.com" }),
    );
    expect(res.status).toBe(200);
    expect(mockCustomersUpdate).toHaveBeenCalledWith({
      customerId: "cust_legacy",
      emailAddress: "new@example.com",
    });
    expect(mockCustomersCreate).not.toHaveBeenCalled();
  });

  it("does not clobber an existing customer email", async () => {
    mockFindCustomerByPhone.mockResolvedValue({
      id: "cust_has_email",
      emailAddress: "old@example.com",
      referenceId: "+61404123456",
    });

    await POST(req({ firstName: "Mandy", email: "new@example.com" }));
    expect(mockCustomersUpdate).not.toHaveBeenCalled();
  });

  it("ignores a malformed email (falls back to none on create)", async () => {
    mockFindCustomerByPhone.mockResolvedValue(null);
    mockCustomersCreate.mockResolvedValue({ customer: { id: "cust_new" } });

    await POST(req({ firstName: "Mandy", email: "not-an-email" }));
    expect(mockCustomersCreate.mock.calls[0][0].emailAddress).toBeUndefined();
  });
});
