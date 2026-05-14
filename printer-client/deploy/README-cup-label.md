# Cup-label consumer deployment (Zebra ZD410)

Runs as a **second** launchd job on the same Mac mini alongside the
existing ZD411 `print_jobs` consumer. The two pipelines share `.env.local`
and the Supabase client, but each owns its own CUPS queue, process,
log files, and crash-recovery — so one crashing or restarting never
disturbs the other.

## 0. Prerequisites on the host (MacBook for dev / Mac mini for prod)

- Node 20+ installed
- CUPS queue `Zebra_ZD410` exists and prints raw ZPL. One-shot install:
  ```bash
  sudo lpadmin -p Zebra_ZD410 -E \
    -v 'usb://Zebra%20Technologies/ZTC%20ZD410-300dpi%20ZPL?serial=<your-serial>' \
    -m raw \
    -o printer-is-shared=false
  ```
  Verify:
  ```bash
  printf '^XA^FO50,50^A0N,50,50^FDHello ZD410^FS^XZ' | lp -d Zebra_ZD410 -o raw
  ```
- 50×80mm direct-thermal label roll loaded on the ZD410
- `printer-client/.env.local` populated. Cup-label-specific keys
  (defaults shown — only `CUP_LABEL_DEVICE_ID` is mandatory):
  ```
  CUP_LABEL_PRINTER_NAME=Zebra_ZD410
  CUP_LABEL_DEVICE_ID=mac-mini-store-davenport-zd410
  # CUP_LABEL_LP_TIMEOUT_MS=15000
  # CUP_LABEL_POLL_FALLBACK_MS=15000
  # CUP_LABEL_STALE_WINDOW_MS=7200000
  # CUP_LABEL_STORAGE_BUCKET=doodles
  ```

## 1. Build + dev test

```bash
cd ~/Github/mandys_bubble_tea/printer-client
npm install
npm run build                                # produces dist/cup-label-index.js
CUP_LABEL_DEVICE_ID=dev-macbook npm run dev:cup-label
```

You should see:
```
[cup-label/main] starting cup-label consumer (printer=Zebra_ZD410, deviceId=dev-macbook)
[cup-label/queue] realtime status: SUBSCRIBED
```

Then trigger an end-to-end test by hitting the admin endpoint on the
deployed web app (or a Vercel preview):
```bash
curl -X POST 'https://mandybubbletea.com/api/admin/cup-label/test-print' \
  -H 'Authorization: Bearer <CRON_SECRET>'
```

This enqueues one fake `cup_label_jobs` row → Realtime push → this
consumer downloads the ZPL → ZD410 prints. Watch the log for
`[cup-label/queue] printed OLxxx cup 1 (DOODLE TEMPLATE)`.

## 2. Install the launchd plist (production / Mac mini)

```bash
sed "s|REPLACE_NODE|$(which node)|g; s|REPLACE_REPO|$HOME/Github/mandys_bubble_tea|g; s|REPLACE_HOME|$HOME|g" \
  ~/Github/mandys_bubble_tea/printer-client/deploy/com.mandysbubbletea.printer-client-cup-label.plist \
  > ~/Library/LaunchAgents/com.mandysbubbletea.printer-client-cup-label.plist

mkdir -p ~/Library/Logs
launchctl load -w ~/Library/LaunchAgents/com.mandysbubbletea.printer-client-cup-label.plist
```

Verify the job is running:
```bash
launchctl list | grep cup-label
tail -f ~/Library/Logs/mandy-printer-client-cup-label.out.log
```

You should see `[cup-label/queue] realtime status: SUBSCRIBED` within
seconds.

## 3. Verify restart behavior

```bash
pgrep -fl mandys_bubble_tea/printer-client/dist/cup-label-index.js
kill <pid>
sleep 12
launchctl list | grep cup-label    # PID should be new
```

## 4. Verify the ZD411 path is untouched

```bash
launchctl list | grep printer-client
# Expect TWO entries:
#   com.mandysbubbletea.printer-client            (ZD411 print_jobs)
#   com.mandysbubbletea.printer-client-cup-label  (ZD410 cup_label_jobs)
```

## Upgrading

```bash
cd ~/Github/mandys_bubble_tea
git pull
cd printer-client
npm install
npm run build
launchctl unload ~/Library/LaunchAgents/com.mandysbubbletea.printer-client-cup-label.plist
launchctl load -w ~/Library/LaunchAgents/com.mandysbubbletea.printer-client-cup-label.plist
```

## Uninstall (retire ZD410 path)

```bash
launchctl unload -w ~/Library/LaunchAgents/com.mandysbubbletea.printer-client-cup-label.plist
rm ~/Library/LaunchAgents/com.mandysbubbletea.printer-client-cup-label.plist
```

The ZD411 `print_jobs` consumer is on a different plist and stays
running.
