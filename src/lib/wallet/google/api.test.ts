import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { generateKeyPair, exportPKCS8, exportSPKI, importSPKI, jwtVerify, decodeJwt } from "jose"
import {
  ensureLoyaltyClass,
  getAccessToken,
  getLoyaltyObjectStatus,
  resetGoogleWalletTokenCache,
  saveUrl,
  signSaveJwt,
  upsertLoyaltyObject,
  WALLET_API,
} from "./api"
import { buildLoyaltyClass, buildLoyaltyObject } from "./pass"
import type { GoogleWalletEnv } from "./env"

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: async () => "vercel-oidc-from-runtime",
}))

let keyEnv: GoogleWalletEnv
let publicPem: string

const WIF_AUDIENCE = "//iam.googleapis.com/projects/744591425203/locations/global/workloadIdentityPools/vercel/providers/vercel"
const SA = "mandys-wallet-issuer@mandy-bubble-tea.iam.gserviceaccount.com"
const wifEnv: GoogleWalletEnv = {
  issuerId: "3388000000023193709",
  saEmail: SA,
  origin: "https://mandybubbletea.com",
  auth: { kind: "wif", audience: WIF_AUDIENCE },
}

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true })
  keyEnv = {
    issuerId: "3388000000023193709",
    saEmail: SA,
    origin: "https://mandybubbletea.com",
    auth: { kind: "key", saKeyPem: await exportPKCS8(privateKey) },
  }
  publicPem = await exportSPKI(publicKey)
})

beforeEach(() => resetGoogleWalletTokenCache())

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

type Call = { method: string; url: string; path: string; body: unknown; auth?: string }

/**
 * Scripted Google. Token endpoints (OAuth, STS, IAM Credentials) are answered
 * here; Wallet Objects calls go to `routes`. Every call is recorded.
 */
function fakeGoogle(routes: (method: string, path: string, body: unknown) => Response) {
  const calls: Call[] = []
  const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const headers = (init?.headers ?? {}) as Record<string, string>
    const rawBody = init?.body
    let body: unknown
    if (rawBody instanceof URLSearchParams) body = Object.fromEntries(rawBody.entries())
    else if (typeof rawBody === "string") body = JSON.parse(rawBody)
    const path = url.startsWith(`${WALLET_API}/`) ? url.slice(WALLET_API.length + 1) : url
    calls.push({ method, url, path, body, auth: headers.Authorization })

    if (url === "https://oauth2.googleapis.com/token") {
      return jsonResponse(200, { access_token: "sa-token-from-key", expires_in: 3600 })
    }
    if (url === "https://sts.googleapis.com/v1/token") {
      return jsonResponse(200, { access_token: "federated-token", expires_in: 3600, token_type: "Bearer" })
    }
    if (url.endsWith(":generateAccessToken")) {
      return jsonResponse(200, { accessToken: "sa-token-from-wif", expireTime: new Date(Date.now() + 3600_000).toISOString() })
    }
    if (url.endsWith(":signJwt")) {
      return jsonResponse(200, { keyId: "k1", signedJwt: "header.payload.google-signature" })
    }
    return routes(method, path, body)
  })
  return { f: f as unknown as typeof fetch, calls }
}

describe("key mode", () => {
  it("exchanges an RS256 assertion for a bearer and caches it", async () => {
    const { f, calls } = fakeGoogle(() => jsonResponse(200, {}))
    const t1 = await getAccessToken(keyEnv, { fetchImpl: f })
    const t2 = await getAccessToken(keyEnv, { fetchImpl: f })
    expect(t1).toBe("sa-token-from-key")
    expect(t2).toBe("sa-token-from-key")
    expect(calls).toHaveLength(1)

    const assertion = (calls[0].body as { assertion: string }).assertion
    const { payload } = await jwtVerify(assertion, await importSPKI(publicPem, "RS256"))
    expect(payload.iss).toBe(SA)
    expect(payload.aud).toBe("https://oauth2.googleapis.com/token")
    expect(payload.scope).toBe("https://www.googleapis.com/auth/wallet_object.issuer")
  })

  it("signs the savetowallet JWT locally with the key", async () => {
    const jwt = await signSaveJwt(keyEnv, { loyaltyObjects: [{ id: "1.mb-1-a" }] })
    const { payload, protectedHeader } = await jwtVerify(jwt, await importSPKI(publicPem, "RS256"))
    expect(protectedHeader.alg).toBe("RS256")
    expect(payload.iss).toBe(SA)
    expect(payload.aud).toBe("google")
    expect(payload.typ).toBe("savetowallet")
    expect(payload.origins).toEqual(["https://mandybubbletea.com"])
    expect((payload.payload as { loyaltyObjects: unknown[] }).loyaltyObjects).toEqual([{ id: "1.mb-1-a" }])
    expect(typeof decodeJwt(jwt).iat).toBe("number")
    expect(saveUrl(jwt)).toBe(`https://pay.google.com/gp/v/save/${jwt}`)
  })
})

describe("keyless mode (Vercel OIDC → WIF)", () => {
  it("exchanges the OIDC token at STS, then impersonates the service account", async () => {
    const { f, calls } = fakeGoogle(() => jsonResponse(200, {}))
    const oidc = vi.fn(async () => "vercel-oidc")

    const token = await getAccessToken(wifEnv, { fetchImpl: f, oidc })
    expect(token).toBe("sa-token-from-wif")
    expect(oidc).toHaveBeenCalledTimes(1)

    const [sts, impersonate] = calls
    expect(sts.url).toBe("https://sts.googleapis.com/v1/token")
    expect(sts.body).toMatchObject({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: WIF_AUDIENCE,
      subject_token: "vercel-oidc",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    })
    expect(impersonate.url).toBe(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(SA)}:generateAccessToken`,
    )
    expect(impersonate.auth).toBe("Bearer federated-token")
    expect(impersonate.body).toEqual({ scope: ["https://www.googleapis.com/auth/wallet_object.issuer"], lifetime: "3600s" })

    // Second call is served from cache: no new OIDC, STS or impersonation.
    await getAccessToken(wifEnv, { fetchImpl: f, oidc })
    expect(calls).toHaveLength(2)
    expect(oidc).toHaveBeenCalledTimes(1)
  })

  it("has Google sign the savetowallet JWT with the service account's key", async () => {
    const { f, calls } = fakeGoogle(() => jsonResponse(200, {}))
    const jwt = await signSaveJwt(wifEnv, { loyaltyObjects: [{ id: "1.mb-1-a" }] }, { fetchImpl: f, oidc: async () => "vercel-oidc" })
    expect(jwt).toBe("header.payload.google-signature")

    const sign = calls.find((c) => c.url.endsWith(":signJwt"))!
    expect(sign.auth).toBe("Bearer federated-token")
    const claims = JSON.parse((sign.body as { payload: string }).payload)
    expect(claims).toMatchObject({
      iss: SA,
      aud: "google",
      typ: "savetowallet",
      origins: ["https://mandybubbletea.com"],
      payload: { loyaltyObjects: [{ id: "1.mb-1-a" }] },
    })
    expect(typeof claims.iat).toBe("number")
  })

  it("falls back to the Vercel runtime supplier when none is injected", async () => {
    const { f, calls } = fakeGoogle(() => jsonResponse(200, {}))
    await getAccessToken(wifEnv, { fetchImpl: f })
    expect((calls[0].body as { subject_token: string }).subject_token).toBe("vercel-oidc-from-runtime")
  })

  it("uses the impersonated token for Wallet Objects calls", async () => {
    const cls = buildLoyaltyClass(wifEnv.issuerId, wifEnv.origin)
    const { f, calls } = fakeGoogle((method) =>
      method === "GET" ? new Response("nope", { status: 404 }) : jsonResponse(200, cls),
    )
    await ensureLoyaltyClass(wifEnv, cls, { fetchImpl: f, oidc: async () => "vercel-oidc" })
    const wallet = calls.filter((c) => c.url.startsWith(WALLET_API))
    expect(wallet.map((c) => c.method)).toEqual(["GET", "POST"])
    expect(wallet.every((c) => c.auth === "Bearer sa-token-from-wif")).toBe(true)
  })
})

describe("Wallet Objects REST", () => {
  const input = {
    serialNumber: "mb-4182-abcdef12",
    memberNumber: "MB-4182",
    memberName: "Stan Yan",
    memberSince: "May 2024",
    phoneE164: "+61404978238",
    stars: 3,
    lifetimePoints: 12,
    availableRewards: 0,
  }

  it("inserts a class when Google has none, updates in place otherwise (never demoting APPROVED)", async () => {
    const cls = buildLoyaltyClass(keyEnv.issuerId, keyEnv.origin)
    let exists = false
    const { f, calls } = fakeGoogle((method) => {
      if (method === "GET") return exists ? jsonResponse(200, { ...cls, reviewStatus: "APPROVED" }) : new Response("", { status: 404 })
      exists = true
      return jsonResponse(200, cls)
    })
    expect(await ensureLoyaltyClass(keyEnv, cls, { fetchImpl: f })).toBe("created")
    expect(await ensureLoyaltyClass(keyEnv, cls, { fetchImpl: f })).toBe("updated")
    const wallet = calls.filter((c) => c.url.startsWith(WALLET_API))
    expect(wallet.map((c) => c.method)).toEqual(["GET", "POST", "GET", "PUT"])
    expect((wallet[3].body as { reviewStatus: string }).reviewStatus).toBe("APPROVED")
  })

  it("POSTs a new object, PUTs an existing one", async () => {
    const obj = buildLoyaltyObject(keyEnv.issuerId, keyEnv.origin, input)
    let exists = false
    const { f, calls } = fakeGoogle((method) => {
      if (method === "GET") return exists ? jsonResponse(200, obj) : new Response("", { status: 404 })
      exists = true
      return jsonResponse(200, obj)
    })
    expect(await upsertLoyaltyObject(keyEnv, obj, { fetchImpl: f })).toBe("created")
    expect(await upsertLoyaltyObject(keyEnv, obj, { fetchImpl: f })).toBe("updated")
    const wallet = calls.filter((c) => c.url.startsWith(WALLET_API))
    expect(wallet.map((c) => c.method)).toEqual(["GET", "POST", "GET", "PUT"])
    expect(wallet[3].path).toBe(`loyaltyObject/${encodeURIComponent(obj.id)}`)
  })

  it("reports hasUsers from Google, and exists=false on 404", async () => {
    const { f } = fakeGoogle((_m, path) =>
      path.endsWith("saved") ? jsonResponse(200, { hasUsers: true }) : new Response("", { status: 404 }),
    )
    expect(await getLoyaltyObjectStatus(keyEnv, "1.saved", { fetchImpl: f })).toEqual({ exists: true, hasUsers: true })
    expect(await getLoyaltyObjectStatus(keyEnv, "1.missing", { fetchImpl: f })).toEqual({ exists: false, hasUsers: false })
  })

  it("surfaces non-404 failures with status and path", async () => {
    const { f } = fakeGoogle(() => new Response("forbidden", { status: 403 }))
    await expect(getLoyaltyObjectStatus(keyEnv, "1.x", { fetchImpl: f })).rejects.toThrow(/403 on loyaltyObject\/1\.x/)
  })
})
