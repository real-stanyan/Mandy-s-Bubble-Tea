import "server-only"

// Google Wallet issuer credentials. Unlike the Apple side, every var here is
// optional: the App hides its "Add to Google Wallet" row while this returns
// null, so the feature can ship before Stan finishes the console setup.
//
// Two ways to supply the service account, pick one:
//   GOOGLE_WALLET_SA_JSON     — the whole key file Google Cloud downloads
//   GOOGLE_WALLET_SA_EMAIL + GOOGLE_WALLET_SA_KEY_PEM — split out
// Vercel stores the PEM with literal "\n"; both forms are normalised here.

export interface GoogleWalletEnv {
  /** Issuer ID from Google Pay & Wallet Console → Google Wallet API. */
  issuerId: string
  /** Service account e-mail, also registered as a Developer user in the console. */
  saEmail: string
  /** PKCS#8 private key of that service account. */
  saKeyPem: string
  /** Origin the save link may be embedded on; also hosts the logo + hero images. */
  origin: string
}

function normalisePem(pem: string): string {
  return pem.replace(/\\n/g, "\n")
}

export function googleWalletEnv(): GoogleWalletEnv | null {
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID?.trim()
  if (!issuerId) return null

  let saEmail = process.env.GOOGLE_WALLET_SA_EMAIL?.trim() ?? ""
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

  return {
    issuerId,
    saEmail,
    saKeyPem: normalisePem(saKeyPem),
    origin: (process.env.GOOGLE_WALLET_ORIGIN ?? "https://mandybubbletea.com").replace(/\/$/, ""),
  }
}

export function isGoogleWalletConfigured(): boolean {
  return googleWalletEnv() !== null
}
