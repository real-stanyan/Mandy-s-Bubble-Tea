import { describe, it } from 'vitest'

describe.skip('POST /api/device-push-token [known-gap]', () => {
  it.skip('upserts iOS APNs token [TestBaseline:E1]', () => {})
  it.skip('upserts Android FCM token [TestBaseline:E3]', () => {})
  it.skip('rejects platform="web" [memory: handoff android port T6]', () => {})
})
