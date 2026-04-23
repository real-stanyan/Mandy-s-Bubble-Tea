import "server-only"
import { squareClient } from "@/lib/square"
import { getActiveProgram } from "@/lib/loyalty"

export interface CustomerPassData {
  customerId: string
  memberName: string
  memberSince: string       // "MMM YYYY"
  stars: number             // balance % starsPerReward, progress toward next reward (drives strip)
  totalStars: number        // lifetime balance, drives header "N/9"
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
  const phone = customer.phoneNumber ?? ""
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

  const { starsPerReward } = await getActiveProgram()
  const stars = balance % starsPerReward
  const availableRewards = Math.floor(balance / starsPerReward)

  return { customerId, memberName, memberSince, stars, totalStars: balance, availableRewards }
}
