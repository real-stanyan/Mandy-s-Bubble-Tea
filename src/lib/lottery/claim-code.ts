import { randomInt } from "node:crypto";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateClaimCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += CROCKFORD_ALPHABET[randomInt(0, CROCKFORD_ALPHABET.length)];
  }
  return out;
}

export async function generateUniqueClaimCode(
  checkExists: (code: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateClaimCode();
    const exists = await checkExists(code);
    if (!exists) return code;
  }
  throw new Error("generateUniqueClaimCode: failed after 5 attempts");
}
