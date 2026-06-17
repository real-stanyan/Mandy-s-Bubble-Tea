import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCustomerGet = vi.fn();
const mockAccountsSearch = vi.fn();

vi.mock("@/lib/square", () => ({
  squareClient: {
    customers: { get: (...a: unknown[]) => mockCustomerGet(...a) },
    loyalty: { accounts: { search: (...a: unknown[]) => mockAccountsSearch(...a) } },
  },
}));

vi.mock("@/lib/loyalty", () => ({
  getActiveProgram: vi.fn().mockResolvedValue({ starsPerReward: 9 }),
}));

import { fetchCustomerPassData, clearPassDataCache } from "./customer";

describe("fetchCustomerPassData phoneE164 normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPassDataCache();
    mockAccountsSearch.mockResolvedValue({ loyaltyAccounts: [{ balance: 3 }] });
  });

  it("normalizes a local AU phone (04xx) to E.164 so the Wallet QR matches the POS reference", async () => {
    // Square sometimes stores phone in local format — the un-normalized value
    // would make the Wallet QR (phone payload) miss the E.164 reference_id at POS.
    mockCustomerGet.mockResolvedValue({
      customer: {
        givenName: "Alyssa",
        phoneNumber: "0466563606",
        createdAt: "2026-01-01T00:00:00Z",
      },
    });

    const data = await fetchCustomerPassData("CUST1");
    expect(data.phoneE164).toBe("+61466563606");
  });

  it("leaves an already-E.164 phone unchanged", async () => {
    mockCustomerGet.mockResolvedValue({
      customer: { phoneNumber: "+61404513516", createdAt: "2026-01-01T00:00:00Z" },
    });

    const data = await fetchCustomerPassData("CUST2");
    expect(data.phoneE164).toBe("+61404513516");
  });

  it("falls back to empty string when Square has no phone", async () => {
    mockCustomerGet.mockResolvedValue({
      customer: { phoneNumber: undefined, createdAt: "2026-01-01T00:00:00Z" },
    });

    const data = await fetchCustomerPassData("CUST3");
    expect(data.phoneE164).toBe("");
  });
});

describe("fetchCustomerPassData lifetimePoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPassDataCache();
    mockCustomerGet.mockResolvedValue({
      customer: { givenName: "Stan", phoneNumber: "+61404978238", createdAt: "2026-01-01T00:00:00Z" },
    });
  });

  it("maps lifetimePoints from the loyalty account", async () => {
    mockAccountsSearch.mockResolvedValue({ loyaltyAccounts: [{ balance: 3, lifetimePoints: 71 }] });
    const data = await fetchCustomerPassData("CUST1");
    expect(data.lifetimePoints).toBe(71);
  });

  it("falls back to balance when lifetimePoints is missing", async () => {
    mockAccountsSearch.mockResolvedValue({ loyaltyAccounts: [{ balance: 5 }] });
    const data = await fetchCustomerPassData("CUST2");
    expect(data.lifetimePoints).toBe(5);
  });
});

// Apple Wallet's passd polls the pass endpoint and each miss hit two Square
// APIs (customers.get + loyalty.accounts.search). A poll burst tripped the
// merchant rate limit (RATE_LIMITED 429). A short per-customer TTL cache
// collapses repeated polls into a single Square round-trip.
describe("fetchCustomerPassData TTL cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPassDataCache();
    vi.useFakeTimers();
    mockCustomerGet.mockResolvedValue({
      customer: { givenName: "Stan", phoneNumber: "+61404978238", createdAt: "2026-01-01T00:00:00Z" },
    });
    mockAccountsSearch.mockResolvedValue({ loyaltyAccounts: [{ balance: 3, lifetimePoints: 9 }] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves repeated calls for the same customer from cache (one Square round-trip)", async () => {
    const a = await fetchCustomerPassData("CUST_CACHE");
    const b = await fetchCustomerPassData("CUST_CACHE");
    expect(mockCustomerGet).toHaveBeenCalledTimes(1);
    expect(mockAccountsSearch).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });

  it("re-fetches after the TTL expires", async () => {
    await fetchCustomerPassData("CUST_CACHE");
    vi.advanceTimersByTime(61_000);
    await fetchCustomerPassData("CUST_CACHE");
    expect(mockCustomerGet).toHaveBeenCalledTimes(2);
  });

  it("does not share cache across different customers", async () => {
    await fetchCustomerPassData("CUST_A");
    await fetchCustomerPassData("CUST_B");
    expect(mockCustomerGet).toHaveBeenCalledTimes(2);
  });
});
