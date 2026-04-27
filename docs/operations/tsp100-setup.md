# Star TSP100IV SK Setup (CloudPRNT mode)

## One-time procedure

### 1. Unbox & paper
- Remove tape, plug power.
- Load the 50×80mm three-proof die-cut roll.
- Hold FEED ~3s on power-on → printer auto-calibrates the gap sensor.
  Verify: it should advance exactly to the next gap, not run continuously.

### 2. Network
- Connect via USB to a laptop **OR** join temporary AP `Star_PRNT-XXXX`.
- Open `http://<printer-ip>` in a browser.
- WiFi → join store WiFi (5 GHz preferred).
- Note the IP that the printer takes.

### 3. CloudPRNT
- Open the printer admin page → CloudPRNT.
- Server URL: `https://mandybubbletea.com/api/cloudprnt/poll`
- Polling interval: 5 seconds
- Encryption: TLS on
- Save → reboot.

### 4. Verify
- POST a test job:
  ```bash
  curl -X POST https://mandybubbletea.com/api/admin/cup-label/test-print \
       -H 'Cookie: <owner cookie>' \
       -H 'Content-Type: application/json' \
       -d '{}'
  ```
- A label should print within 10 seconds (poll interval + render).
- Ack should land — verify in Supabase:
  ```sql
  select id, status, printed_at from cup_label_jobs order by created_at desc limit 1;
  ```
  Status should be `printed`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Continuous paper feed | Gap sensor not seeing die-cut | Re-calibrate (hold FEED on power-on) |
| Polls but never prints | TLS/HTTPS rejected | Confirm cert valid; printer firmware up to date |
| Prints but `status` stays `printing` | Ack not reaching us | Check printer logs; URL for ack is set |
| Label shifted up/down | Gap calibration drift | Re-feed and recalibrate |
