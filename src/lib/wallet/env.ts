import "server-only"

function req(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`[wallet] missing env var: ${name}`)
  return v
}

export function walletEnv() {
  return {
    certPem: req('APPLE_PASS_CERT_PEM'),
    keyPem: req('APPLE_PASS_KEY_PEM'),
    wwdrPem: req('APPLE_PASS_WWDR_PEM'),
    keyPassphrase: req('APPLE_PASS_KEY_PASSPHRASE'),
    teamId: req('APPLE_TEAM_ID'),
    passTypeId: req('APPLE_PASS_TYPE_ID'),
    apnsAuthKey: req('APNS_AUTH_KEY_P8'),
    apnsKeyId: req('APNS_KEY_ID'),
    apnsHost: process.env.APNS_HOST ?? 'api.push.apple.com',
    webServiceUrl: req('WALLET_WEBSERVICE_URL'),
    qstashUrl: req('QSTASH_URL'),
    qstashToken: req('QSTASH_TOKEN'),
    qstashCurrentSigningKey: req('QSTASH_CURRENT_SIGNING_KEY'),
    qstashNextSigningKey: req('QSTASH_NEXT_SIGNING_KEY'),
  }
}
