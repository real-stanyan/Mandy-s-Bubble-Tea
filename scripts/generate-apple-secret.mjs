// Generate the Apple "Sign in with Apple" client_secret JWT for Supabase.
// Apple caps the lifetime at 6 months, so this needs to be re-run every 6
// months and the output pasted into Supabase Dashboard → Auth → Providers
// → Apple → Secret Key (for OAuth).
//
// Usage:
//   node scripts/generate-apple-secret.mjs

import fs from "node:fs";
import crypto from "node:crypto";

const TEAM_ID = "HV982TTRNP";
const KEY_ID = "BR3LV3BT7Y";
const SERVICES_ID = "com.mandysbubbletea.web.auth";
const PRIVATE_KEY_PATH = "/Users/stanyan/Downloads/AuthKey_BR3LV3BT7Y.p8";

const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");

const now = Math.floor(Date.now() / 1000);
const header = { alg: "ES256", kid: KEY_ID, typ: "JWT" };
const payload = {
  iss: TEAM_ID,
  iat: now,
  exp: now + 180 * 24 * 60 * 60,
  aud: "https://appleid.apple.com",
  sub: SERVICES_ID,
};

const b64url = (input) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const headerEncoded = b64url(JSON.stringify(header));
const payloadEncoded = b64url(JSON.stringify(payload));
const signingInput = `${headerEncoded}.${payloadEncoded}`;

const signature = crypto.sign("SHA256", Buffer.from(signingInput), {
  key: privateKey,
  dsaEncoding: "ieee-p1363",
});
const signatureEncoded = b64url(signature);

const token = `${signingInput}.${signatureEncoded}`;

const expiresAt = new Date((now + 180 * 24 * 60 * 60) * 1000);
console.log(`\nApple client_secret JWT (expires ${expiresAt.toISOString()}):\n`);
console.log(token);
console.log("");
