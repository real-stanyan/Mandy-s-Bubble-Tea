import "server-only"
import { SignJWT, importPKCS8 } from "jose"
import { getVercelOidcToken } from "@vercel/oidc"
import type { GoogleWalletEnv } from "./env"
import type { LoyaltyClass, LoyaltyObject } from "./pass"

// Thin client for the Google Wallet Objects REST API plus the two JWTs the
// integration needs: the OAuth bearer for REST calls and the "save to wallet"
// JWT the Android SDK / save link consume.
//
// Two auth modes (see env.ts). In keyless mode nothing here ever holds a
// private key: the Vercel OIDC token is exchanged at Google's STS for a
// federated token, which (a) impersonates the service account for REST
// calls and (b) asks IAM Credentials to sign the save JWT with the service
// account's own key, server-side.
//
// `fetch` and the OIDC supplier are injectable so tests can script every
// Google reply without a network or a Vercel runtime.

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const STS_URL = "https://sts.googleapis.com/v1/token"
const IAM_CREDENTIALS = "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts"
const SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer"
export const WALLET_API = "https://walletobjects.googleapis.com/walletobjects/v1"
export const SAVE_URL_PREFIX = "https://pay.google.com/gp/v/save/"

type Fetch = typeof fetch
export type OidcSupplier = () => Promise<string>

export interface ApiDeps {
  fetchImpl?: Fetch
  oidc?: OidcSupplier
}

const defaultOidc: OidcSupplier = () => getVercelOidcToken()

export class GoogleWalletApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
  ) {
    super(`Google Wallet ${status} on ${path}: ${body.slice(0, 300)}`)
  }
}

interface CachedToken {
  token: string
  expiresAt: number
}
const cache = new Map<string, CachedToken>()

/** Test seam: forget every cached bearer. */
export function resetGoogleWalletTokenCache(): void {
  cache.clear()
}

function cached(key: string): string | null {
  const hit = cache.get(key)
  return hit && hit.expiresAt > Date.now() + 60_000 ? hit.token : null
}

async function postJson<T>(url: string, body: unknown, bearer: string | undefined, fetchImpl: Fetch, label: string): Promise<T> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new GoogleWalletApiError(res.status, label, await res.text())
  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// Key mode: the classic signed-assertion grant
// ---------------------------------------------------------------------------

async function keyModeAccessToken(env: GoogleWalletEnv, saKeyPem: string, fetchImpl: Fetch): Promise<string> {
  const key = `key:${env.saEmail}`
  const hit = cached(key)
  if (hit) return hit

  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(env.saEmail)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(await importPKCS8(saKeyPem, "RS256"))

  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  })
  if (!res.ok) throw new GoogleWalletApiError(res.status, "oauth2/token", await res.text())
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cache.set(key, { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 })
  return json.access_token
}

// ---------------------------------------------------------------------------
// Keyless mode: Vercel OIDC → STS federated token → service account
// ---------------------------------------------------------------------------

/** Federated token for the workload identity pool; short-lived, cached. */
async function federatedToken(env: GoogleWalletEnv, audience: string, deps: Required<ApiDeps>): Promise<string> {
  const key = `sts:${audience}`
  const hit = cached(key)
  if (hit) return hit

  const subjectToken = await deps.oidc()
  const res = await deps.fetchImpl(STS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      subject_token: subjectToken,
    }),
  })
  if (!res.ok) throw new GoogleWalletApiError(res.status, "sts/token", await res.text())
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cache.set(key, { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 })
  return json.access_token
}

async function wifModeAccessToken(env: GoogleWalletEnv, audience: string, deps: Required<ApiDeps>): Promise<string> {
  const key = `wif:${env.saEmail}`
  const hit = cached(key)
  if (hit) return hit

  const federated = await federatedToken(env, audience, deps)
  const json = await postJson<{ accessToken: string; expireTime: string }>(
    `${IAM_CREDENTIALS}/${encodeURIComponent(env.saEmail)}:generateAccessToken`,
    { scope: [SCOPE], lifetime: "3600s" },
    federated,
    deps.fetchImpl,
    "iamcredentials:generateAccessToken",
  )
  cache.set(key, { token: json.accessToken, expiresAt: Date.parse(json.expireTime) })
  return json.accessToken
}

function withDefaults(deps: ApiDeps): Required<ApiDeps> {
  return { fetchImpl: deps.fetchImpl ?? fetch, oidc: deps.oidc ?? defaultOidc }
}

/** Bearer for the Wallet Objects REST API, whichever way the issuer authenticates. */
export async function getAccessToken(env: GoogleWalletEnv, deps: ApiDeps = {}): Promise<string> {
  const d = withDefaults(deps)
  return env.auth.kind === "wif"
    ? wifModeAccessToken(env, env.auth.audience, d)
    : keyModeAccessToken(env, env.auth.saKeyPem, d.fetchImpl)
}

// ---------------------------------------------------------------------------
// Wallet Objects REST
// ---------------------------------------------------------------------------

async function call<T>(
  env: GoogleWalletEnv,
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  body: unknown,
  deps: ApiDeps,
): Promise<{ status: number; json: T | null }> {
  const d = withDefaults(deps)
  const token = await getAccessToken(env, d)
  const res = await d.fetchImpl(`${WALLET_API}/${path}`, {
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
  deps: ApiDeps = {},
): Promise<"created" | "updated"> {
  const existing = await call<LoyaltyClass>(env, "GET", `loyaltyClass/${encodeURIComponent(cls.id)}`, undefined, deps)
  if (existing.status === 404) {
    await call(env, "POST", "loyaltyClass", cls, deps)
    return "created"
  }
  // Never demote an approved class back to UNDER_REVIEW.
  const reviewStatus = existing.json?.reviewStatus === "APPROVED" ? "APPROVED" : cls.reviewStatus
  await call(env, "PUT", `loyaltyClass/${encodeURIComponent(cls.id)}`, { ...cls, reviewStatus }, deps)
  return "updated"
}

/** Insert the object, or replace it wholesale so every field tracks the card. */
export async function upsertLoyaltyObject(
  env: GoogleWalletEnv,
  obj: LoyaltyObject,
  deps: ApiDeps = {},
): Promise<"created" | "updated"> {
  const existing = await call<LoyaltyObject>(env, "GET", `loyaltyObject/${encodeURIComponent(obj.id)}`, undefined, deps)
  if (existing.status === 404) {
    await call(env, "POST", "loyaltyObject", obj, deps)
    return "created"
  }
  await call(env, "PUT", `loyaltyObject/${encodeURIComponent(obj.id)}`, obj, deps)
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
  deps: ApiDeps = {},
): Promise<LoyaltyObjectStatus> {
  const res = await call<{ hasUsers?: boolean }>(env, "GET", `loyaltyObject/${encodeURIComponent(objectId)}`, undefined, deps)
  if (res.status === 404) return { exists: false, hasUsers: false }
  return { exists: true, hasUsers: Boolean(res.json?.hasUsers) }
}

// ---------------------------------------------------------------------------
// The "save to wallet" JWT
// ---------------------------------------------------------------------------

export interface SavePayload {
  loyaltyClasses?: (LoyaltyClass | { id: string })[]
  loyaltyObjects: (LoyaltyObject | { id: string })[]
}

function saveClaims(env: GoogleWalletEnv, payload: SavePayload) {
  return {
    iss: env.saEmail,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    origins: [env.origin],
    payload,
  }
}

/**
 * The JWT Google's SDK (`PayClient.savePassesJwt`) and the save link both
 * take. Objects may be given in full (Google creates them on save) or by id
 * alone when they already exist server-side. Signed locally in key mode;
 * by IAM Credentials `signJwt` in keyless mode, so the private key stays
 * inside Google.
 */
export async function signSaveJwt(env: GoogleWalletEnv, payload: SavePayload, deps: ApiDeps = {}): Promise<string> {
  const claims = saveClaims(env, payload)
  if (env.auth.kind === "key") {
    const { iss, iat, ...rest } = claims
    return new SignJWT(rest)
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(iss)
      .setIssuedAt(iat)
      .sign(await importPKCS8(env.auth.saKeyPem, "RS256"))
  }

  const d = withDefaults(deps)
  const federated = await federatedToken(env, env.auth.audience, d)
  const json = await postJson<{ signedJwt: string }>(
    `${IAM_CREDENTIALS}/${encodeURIComponent(env.saEmail)}:signJwt`,
    { payload: JSON.stringify(claims) },
    federated,
    d.fetchImpl,
    "iamcredentials:signJwt",
  )
  return json.signedJwt
}

export function saveUrl(jwt: string): string {
  return `${SAVE_URL_PREFIX}${jwt}`
}
