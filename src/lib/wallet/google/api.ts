import "server-only"
import { SignJWT, importPKCS8 } from "jose"
import type { GoogleWalletEnv } from "./env"
import type { LoyaltyClass, LoyaltyObject } from "./pass"

// Thin client for the Google Wallet Objects REST API plus the two JWTs the
// integration needs: the OAuth bearer for REST calls and the "save to wallet"
// JWT the Android SDK / save link consume.
//
// `fetch` is injectable so tests can script Google's replies without a network.

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer"
export const WALLET_API = "https://walletobjects.googleapis.com/walletobjects/v1"
export const SAVE_URL_PREFIX = "https://pay.google.com/gp/v/save/"

type Fetch = typeof fetch

export class GoogleWalletApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
  ) {
    super(`Google Wallet ${status} on ${path}: ${body.slice(0, 300)}`)
  }
}

let tokenCache: { token: string; expiresAt: number; key: string } | null = null

/** Test seam: forget the cached bearer. */
export function resetGoogleWalletTokenCache(): void {
  tokenCache = null
}

async function signerKey(env: GoogleWalletEnv) {
  return importPKCS8(env.saKeyPem, "RS256")
}

export async function getAccessToken(env: GoogleWalletEnv, fetchImpl: Fetch = fetch): Promise<string> {
  const cacheKey = env.saEmail
  if (tokenCache && tokenCache.key === cacheKey && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token
  }

  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(env.saEmail)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(await signerKey(env))

  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  })
  if (!res.ok) throw new GoogleWalletApiError(res.status, "oauth2/token", await res.text())
  const json = (await res.json()) as { access_token: string; expires_in: number }
  tokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    key: cacheKey,
  }
  return json.access_token
}

async function call<T>(
  env: GoogleWalletEnv,
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  body: unknown,
  fetchImpl: Fetch,
): Promise<{ status: number; json: T | null }> {
  const token = await getAccessToken(env, fetchImpl)
  const res = await fetchImpl(`${WALLET_API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 404) return { status: 404, json: null }
  if (!res.ok) throw new GoogleWalletApiError(res.status, path, await res.text())
  return { status: res.status, json: (await res.json()) as T }
}

/** Insert the class, or overwrite it if Google already has one by that id. */
export async function ensureLoyaltyClass(
  env: GoogleWalletEnv,
  cls: LoyaltyClass,
  fetchImpl: Fetch = fetch,
): Promise<"created" | "updated"> {
  const existing = await call<LoyaltyClass>(env, "GET", `loyaltyClass/${encodeURIComponent(cls.id)}`, undefined, fetchImpl)
  if (existing.status === 404) {
    await call(env, "POST", "loyaltyClass", cls, fetchImpl)
    return "created"
  }
  // Never demote an approved class back to UNDER_REVIEW.
  const reviewStatus = existing.json?.reviewStatus === "APPROVED" ? "APPROVED" : cls.reviewStatus
  await call(env, "PUT", `loyaltyClass/${encodeURIComponent(cls.id)}`, { ...cls, reviewStatus }, fetchImpl)
  return "updated"
}

/** Insert the object, or replace it wholesale so every field tracks the card. */
export async function upsertLoyaltyObject(
  env: GoogleWalletEnv,
  obj: LoyaltyObject,
  fetchImpl: Fetch = fetch,
): Promise<"created" | "updated"> {
  const existing = await call<LoyaltyObject>(env, "GET", `loyaltyObject/${encodeURIComponent(obj.id)}`, undefined, fetchImpl)
  if (existing.status === 404) {
    await call(env, "POST", "loyaltyObject", obj, fetchImpl)
    return "created"
  }
  await call(env, "PUT", `loyaltyObject/${encodeURIComponent(obj.id)}`, obj, fetchImpl)
  return "updated"
}

export interface LoyaltyObjectStatus {
  exists: boolean
  /** Set by Google once at least one user has saved the pass. */
  hasUsers: boolean
}

export async function getLoyaltyObjectStatus(
  env: GoogleWalletEnv,
  objectId: string,
  fetchImpl: Fetch = fetch,
): Promise<LoyaltyObjectStatus> {
  const res = await call<{ hasUsers?: boolean }>(env, "GET", `loyaltyObject/${encodeURIComponent(objectId)}`, undefined, fetchImpl)
  if (res.status === 404) return { exists: false, hasUsers: false }
  return { exists: true, hasUsers: Boolean(res.json?.hasUsers) }
}

export interface SavePayload {
  loyaltyClasses?: (LoyaltyClass | { id: string })[]
  loyaltyObjects: (LoyaltyObject | { id: string })[]
}

/**
 * The JWT Google's SDK (`PayClient.savePassesJwt`) and the save link both
 * take. Objects may be given in full (Google creates them on save) or by id
 * alone when they already exist server-side.
 */
export async function signSaveJwt(env: GoogleWalletEnv, payload: SavePayload): Promise<string> {
  return new SignJWT({
    aud: "google",
    typ: "savetowallet",
    origins: [env.origin],
    payload,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(env.saEmail)
    .setIssuedAt()
    .sign(await signerKey(env))
}

export function saveUrl(jwt: string): string {
  return `${SAVE_URL_PREFIX}${jwt}`
}
