# Mac mini deployment (Phase 5)

One-time setup to run the printer client as a managed launchd job
that survives crashes, reboots, and terminal closures.

## 0. Prerequisites on the Mac mini

- Node 20+ installed (`node -v`)
- Printer set up in CUPS as `Zebra_ZD411` (or whatever `PRINTER_NAME`
  you use in `.env.local`). Test with `printer-client/scripts/test-print.ts`.
- `~/Github/mandys_bubble_tea` cloned and up to date.
- `printer-client/.env.local` populated with:
  ```
  SUPABASE_URL=...
  SUPABASE_SERVICE_ROLE_KEY=...
  PRINTER_NAME=Zebra_ZD411
  DEVICE_ID=mac-mini-store-davenport   # MUST be unique per machine
  ADMIN_ALERT_ENDPOINT=https://mandybubbletea.com/api/admin/print-alert
  PRINTER_ALERT_TOKEN=...               # matches Vercel env
  ```

## 1. Build

```bash
cd ~/Github/mandys_bubble_tea/printer-client
npm install
npm run build      # produces dist/
npm start          # smoke-test; Ctrl+C after you see "realtime status: SUBSCRIBED"
```

## 2. Install the launchd plist

```bash
# Replace "stan" below with the actual Mac mini username (check with `whoami`).
USER_NAME=$(whoami)
sed "s|REPLACE_ME|$USER_NAME|g" \
  ~/Github/mandys_bubble_tea/printer-client/deploy/com.mandysbubbletea.printer-client.plist \
  > ~/Library/LaunchAgents/com.mandysbubbletea.printer-client.plist

mkdir -p ~/Library/Logs
launchctl load -w ~/Library/LaunchAgents/com.mandysbubbletea.printer-client.plist
```

Verify it's running:
```bash
launchctl list | grep mandysbubbletea
tail -f ~/Library/Logs/mandy-printer-client.out.log
```

You should see `[queue] realtime status: SUBSCRIBED` within a few
seconds.

## 3. Verify restart behavior

```bash
# Find the pid and kill it; launchd should respawn within 10s.
pgrep -fl mandys_bubble_tea/printer-client
kill <pid>
sleep 12
launchctl list | grep mandysbubbletea    # PID column should be new
```

## 4. Verify reboot behavior

```bash
sudo reboot
# After login, tail the log and confirm subscribe happens:
tail -f ~/Library/Logs/mandy-printer-client.out.log
```

## Upgrading the code

```bash
cd ~/Github/mandys_bubble_tea
git pull
cd printer-client
npm install
npm run build
launchctl unload ~/Library/LaunchAgents/com.mandysbubbletea.printer-client.plist
launchctl load -w ~/Library/LaunchAgents/com.mandysbubbletea.printer-client.plist
```

## Uninstall

```bash
launchctl unload -w ~/Library/LaunchAgents/com.mandysbubbletea.printer-client.plist
rm ~/Library/LaunchAgents/com.mandysbubbletea.printer-client.plist
```
