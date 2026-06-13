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

export async function fetchCustomerPassData(
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
