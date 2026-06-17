import "server-only"
import { squareClient } from "@/lib/square"
import { getActiveProgram } from "@/lib/loyalty"
import { normalizeAuPhone } from "@/lib/phone"

export interface CustomerPassData {
  customerId: string
  memberName: string
  memberSince: string       // "MMM YYYY"
  phoneE164: string         // drives QR — POS looks up Square customer by phone
  stars: number             // balance % starsPerReward, progress toward next reward (drives strip + "N/9")
  lifetimePoints: number    // cumulative earned stars — drives membership tier
  availableRewards: number  // floor(balance / starsPerReward)
}

// Apple Wallet's passd polls the pass GET endpoint and every cache-miss made
// two Square calls (customers.get + loyalty.accounts.search). A burst of polls
// tripped the merchant rate limit (RATE_LIMITED 429). A short per-customer TTL
// cache collapses repeated polls within the window into one Square round-trip.
// Module scope: lives for the lifetime of the serverless instance, which is
// exactly the burst we need to absorb. Loyalty balance changes are picked up
// within the TTL.
const PASS_DATA_TTL_MS = 60_000
const passDataCache = new Map<string, { data: CustomerPassData; expires: number }>()

/** Clear the per-customer pass-data cache (test seam + manual invalidation). */
export function clearPassDataCache(): void {
  passDataCache.clear()
}

export async function fetchCustomerPassData(
  customerId: string,
): Promise<CustomerPassData> {
  const cached = passDataCache.get(customerId)
  if (cached && cached.expires > Date.now()) {
    return cached.data
  }

  const data = await fetchCustomerPassDataUncached(customerId)
  passDataCache.set(customerId, { data, expires: Date.now() + PASS_DATA_TTL_MS })
  return data
}

async function fetchCustomerPassDataUncached(
  customerId: string,
): Promise<CustomerPassData> {
  const customerRes = await squareClient.customers.get({ customerId })
  const customer = customerRes.customer
  if (!customer) throw new Error(`Square customer not found: ${customerId}`)

  const given = customer.givenName?.trim() ?? ""
  const family = customer.familyName?.trim() ?? ""
  // Square may store the phone in local AU format (04xx xxx xxx). The pass QR
  // payload must be E.164 to match the loyalty reference_id the POS looks up,
  // exactly like the web member QR (which uses the E.164 phone_e164). Normalize.
  const phone = normalizeAuPhone(customer.phoneNumber ?? "") ?? ""
  const memberName =
    [given, family].filter(Boolean).join(" ") ||
    (phone ? `·${phone.slice(-4)}` : "Member")

  const memberSince = customer.createdAt
    ? new Date(customer.createdAt).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      })
    : "Recently"

  const accountSearch = await squareClient.loyalty.accounts.search({
    query: { customerIds: [customerId] },
    limit: 1,
  })
  const account = accountSearch.loyaltyAccounts?.[0]
  const balance = Number(account?.balance ?? 0)
  const lifetimePoints = Number(account?.lifetimePoints ?? balance)

  const { starsPerReward } = await getActiveProgram()
  const stars = balance % starsPerReward
  const availableRewards = Math.floor(balance / starsPerReward)

  return {
    customerId,
    memberName,
    memberSince,
    phoneE164: phone,
    stars,
    lifetimePoints,
    availableRewards,
  }
}
