import { describe, it } from 'vitest'

describe.skip('POST /api/webhooks/square [known-gap]', () => {
  it.skip('verifies HMAC signature [TestBaseline:C7, E1-E4]', () => {})
  it.skip('idempotent on replay [TestBaseline:C7]', () => {})
  it.skip('triggers la_update push on order state change [TestBaseline:E2]', () => {})
})
