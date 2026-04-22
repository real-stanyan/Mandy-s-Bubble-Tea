import crypto from "node:crypto"
import { getPassBySerial } from "./db"

export async function verifyApplePassAuth(
  authHeader: string | null,
  serialNumber: string,
): Promise<boolean> {
  if (!authHeader) return false
  const m = /^ApplePass\s+(\S+)$/i.exec(authHeader)
  if (!m) return false
  const providedToken = m[1]
  const pass = await getPassBySerial(serialNumber)
  if (!pass) return false
  const a = Buffer.from(providedToken)
  const b = Buffer.from(pass.auth_token)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
