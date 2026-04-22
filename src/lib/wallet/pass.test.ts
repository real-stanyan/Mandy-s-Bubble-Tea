import { describe, it, expect } from 'vitest'
import { buildPass } from './pass'
import AdmZip from 'adm-zip'

describe('buildPass', () => {
  const baseInput = {
    serialNumber: 'mb-4182-abcdef12',
    authToken: 'a'.repeat(32),
    memberNumber: 'MB-4182',
    memberName: 'Stan Yan',
    memberSince: 'May 2024',
    stars: 7,
    availableRewards: 0,
  }

  it('produces a .pkpass zip containing pass.json', async () => {
    const buf = await buildPass(baseInput)
    const zip = new AdmZip(buf)
    const entries = zip.getEntries().map((e) => e.entryName)
    expect(entries).toContain('pass.json')
    expect(entries).toContain('manifest.json')
    expect(entries).toContain('signature')
    expect(entries).toContain('strip.png')
    expect(entries).toContain('strip@2x.png')
    expect(entries).toContain('strip@3x.png')
    expect(entries).toContain('icon.png')
    expect(entries).toContain('logo.png')
  })

  it('embeds serial number and auth token in pass.json', async () => {
    const buf = await buildPass(baseInput)
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    expect(passJson.serialNumber).toBe('mb-4182-abcdef12')
    expect(passJson.authenticationToken).toBe(baseInput.authToken)
    expect(passJson.passTypeIdentifier).toBe(process.env.APPLE_PASS_TYPE_ID)
  })

  it('headerFields shows stars as "N/9"', async () => {
    const buf = await buildPass({ ...baseInput, stars: 3 })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    const starsField = passJson.storeCard.headerFields.find((f: any) => f.key === 'stars')
    expect(starsField.value).toBe('3/9')
  })

  it('secondaryFields reward says "Ready to redeem!" when availableRewards > 0', async () => {
    const buf = await buildPass({ ...baseInput, availableRewards: 1 })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    const reward = passJson.storeCard.secondaryFields.find((f: any) => f.key === 'reward')
    expect(reward.value).toBe('Ready to redeem!')
  })
})
