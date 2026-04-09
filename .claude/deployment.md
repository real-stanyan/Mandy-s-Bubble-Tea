# Deployment

## Platform: Vercel

Connect GitHub repo → Vercel auto-deploys on every push to `main`.

## Environment Variables (set in Vercel dashboard)

| Key | Note |
|-----|------|
| `SQUARE_ACCESS_TOKEN` | Production token — server only |
| `SQUARE_LOCATION_ID` | From Square Dashboard → Locations |
| `NEXT_PUBLIC_SQUARE_APP_ID` | From Square Developer Console |
| `NEXT_PUBLIC_SQUARE_LOCATION_ID` | Same as SQUARE_LOCATION_ID |
| `NEXT_PUBLIC_SQUARE_ENVIRONMENT` | `production` |
| `NEXT_PUBLIC_SITE_URL` | `https://mandybubbletea.com` |

## Domain

- Domain: `mandybubbletea.com`
- Add in Vercel → Project → Domains
- Update DNS at registrar: CNAME → `cname.vercel-dns.com`

## Square Developer Setup (required for Apple Pay)

1. Go to [developer.squareup.com](https://developer.squareup.com)
2. Open your app → Web Payments SDK
3. Add `https://mandybubbletea.com` to allowed domains
4. This is required for Apple Pay to work on the domain

## Local Dev

```bash
npm run dev
# Uses .env.local with sandbox credentials for safe testing
```

Sandbox test card: `4111 1111 1111 1111` / CVV `111` / any future date

## Caching Strategy

- Catalog data: `revalidate: 300` (5 min) — menu doesn't change often
- Loyalty/account data: no cache — always fresh
- Order confirmation: no cache

## Pre-launch Checklist

- [ ] `SQUARE_ACCESS_TOKEN` is Production (not Sandbox)
- [ ] `NEXT_PUBLIC_SQUARE_ENVIRONMENT=production`
- [ ] Domain registered in Square Developer Dashboard
- [ ] Apple Pay tested on real iPhone
- [ ] Square Loyalty subscription active (not expired trial)
- [ ] All 7 category earning rules confirmed in Square Dashboard
- [ ] 9-star reward confirmed in Square Dashboard
- [ ] HTTPS working (Vercel auto)
- [ ] Mobile layout tested
- [ ] Full checkout flow tested with real card
