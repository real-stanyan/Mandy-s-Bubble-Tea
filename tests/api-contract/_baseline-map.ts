export interface BaselineMapping {
  testFile: string
  testName: string
  baselineId: string
  notes?: string
}

export const BASELINE_MAP: BaselineMapping[] = [
  { testFile: 'public/api-get-catalog.test.ts', testName: 'returns Square catalog shape', baselineId: 'A4' },
  { testFile: 'public/api-get-catalog.test.ts', testName: 'BigInt serialized', baselineId: 'A4' },
  { testFile: 'public/api-get-locations.test.ts', testName: 'returns location list', baselineId: 'A1' },
  { testFile: 'public/api-get-catalog-id.test.ts', testName: 'returns single item', baselineId: 'A4' },

  { testFile: 'auth/api-get-me-unauth.test.ts', testName: 'returns 401 without session', baselineId: 'B5' },
  { testFile: 'auth/api-get-orders-history-unauth.test.ts', testName: '401 without session', baselineId: 'B5' },
  { testFile: 'auth/api-get-loyalty-account-unauth.test.ts', testName: '401 without session', baselineId: 'B5' },
  { testFile: 'auth/api-get-welcome-discount-unauth.test.ts', testName: '401 without session', baselineId: 'F1' },
  { testFile: 'auth/api-get-ig-follow-status-unauth.test.ts', testName: '401 without session', baselineId: 'F2' },
  { testFile: 'auth/api-get-loyalty-events-unauth.test.ts', testName: '401 without session', baselineId: 'D1' },
  { testFile: 'auth/api-get-orders-orderid-status.test.ts', testName: 'returns status shape', baselineId: 'C7' },

  { testFile: 'mutation/api-post-orders.test.ts', testName: 'create order happy path', baselineId: 'C1' },
  { testFile: 'mutation/api-post-payment.test.ts', testName: 'charge sandbox card', baselineId: 'C1' },
  { testFile: 'mutation/api-post-loyalty-redeem.test.ts', testName: 'redeem 9 stars', baselineId: 'D1' },
  { testFile: 'mutation/api-post-ig-follow-claim.test.ts', testName: 'claim once 200, twice 409', baselineId: 'F2' },
  { testFile: 'mutation/api-post-orders-complaint.test.ts', testName: '7d window enforced', baselineId: 'H1' },
  { testFile: 'mutation/api-post-doodle-upload.test.ts', testName: 'upload image', baselineId: 'G2' },
  { testFile: 'mutation/api-post-cup-label-ai-submit.test.ts', testName: 'Doubao returns URL', baselineId: 'G1' },
  { testFile: 'mutation/api-post-cup-label-upload-image.test.ts', testName: 'upload custom cup image', baselineId: 'G2' },
  { testFile: 'mutation/api-post-wallet-pass.test.ts', testName: 'sign pkpass', baselineId: 'D3' },
  { testFile: 'mutation/api-post-wallet-pass-exchange.test.ts', testName: 'exchange token', baselineId: 'D3' },
  { testFile: 'mutation/api-post-device-push-token.test.ts', testName: 'upsert iOS token', baselineId: 'E1' },
  { testFile: 'mutation/api-delete-account.test.ts', testName: 'soft delete user', baselineId: 'J1' },
  { testFile: 'mutation/api-post-auth-complete-signup.test.ts', testName: 'create profile + Square customer', baselineId: 'B1' },
  { testFile: 'mutation/api-post-webhooks-square.test.ts', testName: 'HMAC verified + idempotent', baselineId: 'C7' },
]

export function findBaselineId(file: string, testName: string): string | undefined {
  return BASELINE_MAP.find(m =>
    file.endsWith(m.testFile) && testName.includes(m.testName.split(' ').slice(0, 3).join(' ')),
  )?.baselineId
}
