import "server-only"

// Google Wallet issuer credentials. Unlike the Apple side, every var here is
// optional: the App hides its "Add to Google Wallet" row while this returns
// null, so the feature can ship before the console setup is finished.
//
// Two ways to authenticate as the issuer service account:
//
//   Keyless (production — Vercel OIDC → Google Workload Identity Federation)
//     GOOGLE_WALLET_ISSUER_ID     issuer id from Google Pay & Wallet Console
//     GOOGLE_WALLET_SA_EMAIL      mandys-wallet-issuer@…iam.gserviceaccount.com
//     GOOGLE_WALLET_WIF_AUDIENCE  //iam.googleapis.com/projects/<n>/locations/
//                                 global/workloadIdentityPools/vercel/providers/vercel
//     No private key anywhere: Vercel mints an OIDC token per invocation,
//     Google's STS trusts it, and the service account signs on Google's side.
//     Stan's Workspace org forbids service-account key creation (2026-09-06),
//     so this is the only mode that can run in production.
//
//   Key (local dev / tests only)
//     GOOGLE_WALLET_ISSUER_ID + GOOGLE_WALLET_SA_JSON (the key file), or
//     GOOGLE_WALLET_SA_EMAIL + GOOGLE_WALLET_SA_KEY_PEM. Vercel-style
//     literal "\n" in the PEM is normalised.
//
// Keyless wins when both are configured.

export type GoogleWalletAuth =
  | { kind: "wif"; audience: string }
  | { kind: "key"; saKeyPem: string }

export interface GoogleWalletEnv {
  issuerId: string
  /** Service account e-mail, also registered as a Developer user in the console. */
  saEmail: string
  /** Origin the save link may be embedded on; also hosts the logo + hero images. */
  origin: string
  auth: GoogleWalletAuth
}

function normalisePem(pem: string): string {
  return pem.replace(/\\n/g, "\n")
}

export function googleWalletEnv(): GoogleWalletEnv | null {
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID?.trim()
  if (!issuerId) return null

  const origin = (process.env.GOOGLE_WALLET_ORIGIN ?? "https://mandybubbletea.com").replace(/\/$/, "")
  let saEmail = process.env.GOOGLE_WALLET_SA_EMAIL?.trim() ?? ""

  const wifAudience = process.env.GOOGLE_WALLET_WIF_AUDIENCE?.trim()
  if (wifAudience) {
    if (!saEmail) {
      console.warn("[wallet/google] GOOGLE_WALLET_WIF_AUDIENCE set but GOOGLE_WALLET_SA_EMAIL missing")
      return null
    }
    return { issuerId, saEmail, origin, auth: { kind: "wif", audience: wifAudience } }
  }

  let saKeyPem = process.env.GOOGLE_WALLET_SA_KEY_PEM ?? ""
  const json = process.env.GOOGLE_WALLET_SA_JSON
  if (json) {
    try {
      const parsed = JSON.parse(json) as { client_email?: string; private_key?: string }
      saEmail ||= parsed.client_email ?? ""
      saKeyPem ||= parsed.private_key ?? ""
    } catch {
      console.warn("[wallet/google] GOOGLE_WALLET_SA_JSON is not valid JSON")
      return null
    }
  }
  if (!saEmail || !saKeyPem) return null

  return { issuerId, saEmail, origin, auth: { kind: "key", saKeyPem: normalisePem(saKeyPem) } }
}

export function isGoogleWalletConfigured(): boolean {
  return googleWalletEnv() !== null
}
