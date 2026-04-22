# Mandy's Bubble Tea — Printer Client

Local Node service that runs on the in-store Mac mini. Subscribes to the
Supabase `print_jobs` table via Realtime and prints cup stickers on a
USB-connected Zebra ZD411 via CUPS.

## Setup

1. Plug the Zebra ZD411 into the Mac mini via USB.
2. **System Settings → Printers & Scanners → Add Printer** → select the
   Zebra from the USB tab → pick the "Generic Thermal" or "Zebra ZPL"
   driver. Name the printer `Zebra_ZD411` (match `PRINTER_NAME` env).
3. Copy `.env.local.example` to `.env.local` and fill in values. Get the
   Supabase service-role key from the project's Supabase dashboard. Get
   `PRINTER_ALERT_TOKEN` from the Vercel env (must match).
4. `npm install`
5. `npm run test-print` to verify CUPS → Zebra works.
6. `npm run dev` to start the service in watch mode.

## Production (launchd)

See `launchd/com.mandysbubbletea.printer.plist`. Copy to
`~/Library/LaunchAgents/` and `launchctl load` to enable on boot.

## Updating modifier list IDs

Cup stickers rely on `src/lib/modifier-buckets.ts` in the main project
(not this package) to classify modifiers. When adding a new modifier list
to Square Dashboard, update that file, redeploy the Vercel webhook, then
restart this service.

## Troubleshooting

- **Printer shows offline in local UI**: `lpstat -p Zebra_ZD411`; if
  `disabled`, run `cupsenable Zebra_ZD411`. If that fails, re-add in
  System Settings.
- **Jobs stuck in `pending`**: check that Realtime publication includes
  `print_jobs` (see migration). Restart service; `replayOnStart` will
  pick them up if within the 10-minute window.
- **Alerts not firing**: verify `ADMIN_ALERT_ENDPOINT` is reachable from
  the Mac mini; check `PRINTER_ALERT_TOKEN` matches Vercel env.
