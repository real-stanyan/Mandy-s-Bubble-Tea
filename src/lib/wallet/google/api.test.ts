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

let env: GoogleWalletEnv
let publicPem: string

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true })
  env = {
    issuerId: "3388000000023193709",
    saEmail: "wallet@mandys.iam.gserviceaccount.com",
    saKeyPem: await exportPKCS8(privateKey),
    origin: "https://mandybubbletea.com",
  }
  publicPem = await exportSPKI(publicKey)
})

beforeEach(() => resetGoogleWalletTokenCache())

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

/** Scripted Google: token endpoint always succeeds; other calls answered by `routes`. */
function fakeFetch(routes: (method: string, path: string, body: unknown) => Response) {
  const calls: { method: string; path: string; body: unknown }[] = []
  const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === "https://oauth2.googleapis.com/token") {
      return jsonResponse(200, { access_token: "tok-1", expires_in: 3600 })
    }
    const method = init?.method ?? "GET"
    const path = url.replace(`${WALLET_API}/`, "")
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path, body })
    return routes(method, path, body)
  })
  return { f: f as unknown as typeof fetch, calls }
}

describe("getAccessToken", () => {
  it("exchanges an RS256 assertion for a bearer and caches it", async () => {
    const { f } = fakeFetch(() => jsonResponse(200, {}))
    const t1 = await getAccessToken(env, f)
    const t2 = await getAccessToken(env, f)
    expect(t1).toBe("tok-1")
    expect(t2).toBe("tok-1")
    expect(f).toHaveBeenCalledTimes(1)

    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    const assertion = new URLSearchParams(init.body as string).get("assertion")!
    const { payload } = await jwtVerify(assertion, await importSPKI(publicPem, "RS256"))
    expect(payload.iss).toBe(env.saEmail)
    expect(payload.aud).toBe("https://oauth2.googleapis.com/token")
    expect(payload.scope).toBe("https://www.googleapis.com/auth/wallet_object.issuer")
  })
})

describe("ensureLoyaltyClass", () => {
  it("inserts when Google has no class by that id", async () => {
    const cls = buildLoyaltyClass(env.issuerId, env.origin)
    const { f, calls } = fakeFetch((method) =>
      method === "GET" ? new Response("nope", { status: 404 }) : jsonResponse(200, cls),
    )
    expect(await ensureLoyaltyClass(env, cls, f)).toBe("created")
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"])
    expect(calls[1].path).toBe("loyaltyClass")
  })

  it("updates in place and never demotes an approved class", async () => {
    const cls = buildLoyaltyClass(env.issuerId, env.origin)
    const { f, calls } = fakeFetch((method) =>
      method === "GET" ? jsonResponse(200, { ...cls, reviewStatus: "APPROVED" }) : jsonResponse(200, cls),
    )
    expect(await ensureLoyaltyClass(env, cls, f)).toBe("updated")
    expect(calls[1].method).toBe("PUT")
    expect((calls[1].body as { reviewStatus: string }).reviewStatus).toBe("APPROVED")
  })
})

describe("upsertLoyaltyObject / getLoyaltyObjectStatus", () => {
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

  it("POSTs a new object, PUTs an existing one", async () => {
    const obj = buildLoyaltyObject(env.issuerId, env.origin, input)
    let exists = false
    const { f, calls } = fakeFetch((method) => {
      if (method === "GET") return exists ? jsonResponse(200, obj) : new Response("", { status: 404 })
      exists = true
      return jsonResponse(200, obj)
    })
    expect(await upsertLoyaltyObject(env, obj, f)).toBe("created")
    expect(await upsertLoyaltyObject(env, obj, f)).toBe("updated")
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "GET", "PUT"])
    expect(calls[3].path).toBe(`loyaltyObject/${encodeURIComponent(obj.id)}`)
  })

  it("reports hasUsers from Google, and exists=false on 404", async () => {
    const { f } = fakeFetch((_m, path) =>
      path.endsWith("saved") ? jsonResponse(200, { hasUsers: true }) : new Response("", { status: 404 }),
    )
    expect(await getLoyaltyObjectStatus(env, "1.saved", f)).toEqual({ exists: true, hasUsers: true })
    expect(await getLoyaltyObjectStatus(env, "1.missing", f)).toEqual({ exists: false, hasUsers: false })
  })

  it("surfaces non-404 failures with status and path", async () => {
    const { f } = fakeFetch(() => new Response("forbidden", { status: 403 }))
    await expect(getLoyaltyObjectStatus(env, "1.x", f)).rejects.toThrow(/403 on loyaltyObject\/1\.x/)
  })
})

describe("signSaveJwt", () => {
  it("mints the savetowallet JWT Google's SDK expects", async () => {
    const jwt = await signSaveJwt(env, { loyaltyObjects: [{ id: "1.mb-1-a" }] })
    const { payload, protectedHeader } = await jwtVerify(jwt, await importSPKI(publicPem, "RS256"))
    expect(protectedHeader.alg).toBe("RS256")
    expect(payload.iss).toBe(env.saEmail)
    expect(payload.aud).toBe("google")
    expect(payload.typ).toBe("savetowallet")
    expect(payload.origins).toEqual(["https://mandybubbletea.com"])
    expect((payload.payload as { loyaltyObjects: unknown[] }).loyaltyObjects).toEqual([{ id: "1.mb-1-a" }])
    expect(typeof decodeJwt(jwt).iat).toBe("number")
    expect(saveUrl(jwt)).toBe(`https://pay.google.com/gp/v/save/${jwt}`)
  })
})
