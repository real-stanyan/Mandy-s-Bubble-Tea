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
    phoneE164: '+61404978238',
    stars: 7,
    totalStars: 71,
    lifetimePoints: 71, // before any redemption, lifetime == balance
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

  it('headerFields shows the tier label', async () => {
    const buf = await buildPass({ ...baseInput, lifetimePoints: 30 })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    const tierField = passJson.storeCard.headerFields.find((f: any) => f.key === 'tier')
    expect(tierField.value).toBe('GOLD')
  })

  it('QR barcode encodes phoneE164 so POS lookup matches app/web', async () => {
    const buf = await buildPass({ ...baseInput, phoneE164: '+61400111222' })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    const barcode = passJson.barcodes[0]
    expect(barcode.format).toBe('PKBarcodeFormatQR')
    expect(barcode.message).toBe('+61400111222')
    expect(barcode.altText).toBe(baseInput.memberNumber)
  })

  it('auxiliary reward says "Ready to redeem!" when availableRewards > 0', async () => {
    const buf = await buildPass({ ...baseInput, availableRewards: 1 })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    const reward = passJson.storeCard.auxiliaryFields.find((f: any) => f.key === 'reward')
    expect(reward.value).toBe('Ready to redeem!')
  })

  it('auxiliary reward counts remaining stars when none ready', async () => {
    const buf = await buildPass({ ...baseInput })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    const reward = passJson.storeCard.auxiliaryFields.find((f: any) => f.key === 'reward')
    expect(reward.value).toBe('2 stars to go')
  })

  it('silver tier: background + label colors + NEXT TIER countdown', async () => {
    const buf = await buildPass({ ...baseInput, lifetimePoints: 5 })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    expect(passJson.backgroundColor).toBe('rgb(58, 64, 78)')
    expect(passJson.labelColor).toBe('rgb(205, 212, 224)')
    expect(passJson.storeCard.headerFields.find((f: any) => f.key === 'tier').value).toBe('SILVER')
    const status = passJson.storeCard.auxiliaryFields.find((f: any) => f.key === 'status')
    expect(status.label).toBe('NEXT TIER')
    expect(status.value).toBe('25 to Gold')
  })

  it('gold tier: 50 to Diamond', async () => {
    const buf = await buildPass({ ...baseInput, lifetimePoints: 30 })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    expect(passJson.backgroundColor).toBe('rgb(74, 56, 18)')
    const status = passJson.storeCard.auxiliaryFields.find((f: any) => f.key === 'status')
    expect(status.value).toBe('50 to Diamond')
  })

  it('diamond tier: static status + perks back field', async () => {
    const buf = await buildPass({ ...baseInput, lifetimePoints: 80 })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    expect(passJson.backgroundColor).toBe('rgb(10, 12, 22)')
    const status = passJson.storeCard.auxiliaryFields.find((f: any) => f.key === 'status')
    expect(status.label).toBe('STATUS')
    expect(status.value).toBe('Top tier member')
    const perks = passJson.storeCard.backFields.find((f: any) => f.key === 'perks')
    expect(perks.value).toBe('5% off all orders + free toppings each month')
  })

  it('non-diamond tiers have no perks back field', async () => {
    const buf = await buildPass({ ...baseInput, lifetimePoints: 5 })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    expect(passJson.storeCard.backFields.find((f: any) => f.key === 'perks')).toBeUndefined()
  })

  it('progress field shows current-cycle stars as currentStars/goal', async () => {
    const buf = await buildPass({ ...baseInput, stars: 4 })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    const progress = passJson.storeCard.secondaryFields.find((f: any) => f.key === 'progress')
    expect(progress.value).toBe('4/9')
  })
})
